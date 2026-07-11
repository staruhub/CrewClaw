// spend.mjs — v0.18 C3: monthly spend tracking + budget enforcement. The SETTINGS 月度预算 row was
// stored-but-ignored; this makes it real. Cumulative estimated cost per calendar month is persisted
// to .crewclaw/spend/<YYYY-MM>.json; at ≥80% of the cap the engine emits a one-shot budget.warning
// (the notification center's first budget-sourced entry), and at ≥100% route refuses new tasks.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

// Mirrors overlay_settings.rs BUDGET_OPTS = ["$20", "$50", "$100", "$200"] by index. Default $20.
export const BUDGET_CAPS = [20, 50, 100, 200];
export const WARN_RATIO = 0.8;
export const SPEND_STATE_AVAILABLE = "available";
export const SPEND_STATE_MISSING = "missing";
export const SPEND_STATE_INVALID = "invalid";

export function capForBudgetIndex(index) {
  const i = Number(index);
  return BUDGET_CAPS[i] ?? BUDGET_CAPS[0];
}

/** Calendar month key "YYYY-MM" for the spend ledger filename. */
export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function spendPath(root, month) {
  return resolveStatePath(
    join(root, ".crewclaw", "spend", `${month}.json`),
    root
  );
}

export function readSpend(root, month = monthKey()) {
  const result = readSpendDocument(root, month);
  const { applied_settlement_ids: _ignored, ...publicSpend } = result.document;
  return {
    ...publicSpend,
    state: result.state,
    ...(result.state === SPEND_STATE_INVALID
      ? { error: "budget ledger is unavailable" }
      : {}),
  };
}

function readSpendDocument(root, month = monthKey()) {
  try {
    const file = spendPath(root, month);
    if (!existsSync(file)) {
      return {
        state: SPEND_STATE_MISSING,
        document: {
          total: 0,
          warned_80: false,
          applied_settlement_ids: [],
        },
      };
    }
    const s = JSON.parse(readStateFileGuarded(file, { root }).toString("utf8"));
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      !Number.isFinite(s.total) ||
      s.total < 0 ||
      typeof s.warned_80 !== "boolean" ||
      (s.applied_settlement_ids !== undefined &&
        (!Array.isArray(s.applied_settlement_ids) ||
          s.applied_settlement_ids.some(id => typeof id !== "string")))
    ) {
      throw new Error("invalid budget ledger shape");
    }
    return {
      state: SPEND_STATE_AVAILABLE,
      document: {
        total: s.total,
        warned_80: s.warned_80,
        applied_settlement_ids: s.applied_settlement_ids || [],
      },
    };
  } catch {
    return {
      state: SPEND_STATE_INVALID,
      document: {
        total: 0,
        warned_80: false,
        applied_settlement_ids: [],
      },
    };
  }
}

/**
 * Add `cost` to this month's ledger. Returns { total, cap, ratio, crossedWarn } where crossedWarn
 * is true exactly once — the task that pushes cumulative spend across the 80% line (the ledger's
 * warned_80 flag makes the warning one-shot, not once-per-task).
 */
export function recordSpend(
  root,
  budgetIndex,
  cost,
  month = monthKey(),
  { settlementId } = {}
) {
  const cap = capForBudgetIndex(budgetIndex);
  try {
    const file = spendPath(root, month);
    return withStateLock(
      `${file}.lock`,
      () => {
        const priorResult = readSpendDocument(root, month);
        if (priorResult.state === SPEND_STATE_INVALID) {
          throw new Error("budget ledger is unavailable");
        }
        const prior = priorResult.document;
        if (
          settlementId &&
          prior.applied_settlement_ids.includes(settlementId)
        ) {
          return {
            total: prior.total,
            cap,
            ratio: cap > 0 ? prior.total / cap : 0,
            crossedWarn: false,
            persisted: true,
            duplicate: true,
          };
        }
        const total =
          Math.round((prior.total + (Number(cost) || 0)) * 1e6) / 1e6;
        const ratio = cap > 0 ? total / cap : 0;
        const crossedWarn = !prior.warned_80 && ratio >= WARN_RATIO;
        writeJsonAtomic(
          file,
          {
            total,
            warned_80: prior.warned_80 || crossedWarn,
            applied_settlement_ids: settlementId
              ? [...prior.applied_settlement_ids, settlementId]
              : prior.applied_settlement_ids,
          },
          { root }
        );
        return { total, cap, ratio, crossedWarn, persisted: true };
      },
      { root }
    );
  } catch (error) {
    // Budget persistence is best effort, but callers receive the durable prior value instead of
    // an invented increment when locking/writing failed.
    const prior = readSpend(root, month);
    return {
      total: prior.total,
      cap,
      ratio: cap > 0 ? prior.total / cap : 0,
      crossedWarn: false,
      persisted: false,
      error: error?.message || String(error),
    };
  }
}

/** True when this month's spend has reached the cap — route should refuse new tasks. */
export function isOverBudget(root, budgetIndex, month = monthKey()) {
  const cap = capForBudgetIndex(budgetIndex);
  const spend = readSpend(root, month);
  return spend.state === SPEND_STATE_INVALID || (cap > 0 && spend.total >= cap);
}
