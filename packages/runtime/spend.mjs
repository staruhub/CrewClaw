// spend.mjs — v0.18 C3: monthly spend tracking + budget enforcement. The SETTINGS 月度预算 row was
// stored-but-ignored; this makes it real. Cumulative estimated cost per calendar month is persisted
// to .crewclaw/spend/<YYYY-MM>.json; at ≥80% of the cap the engine emits a one-shot budget.warning
// (the notification center's first budget-sourced entry), and at ≥100% route refuses new tasks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors overlay_settings.rs BUDGET_OPTS = ["$20", "$50", "$100", "$200"] by index. Default $20.
export const BUDGET_CAPS = [20, 50, 100, 200];
export const WARN_RATIO = 0.8;

export function capForBudgetIndex(index) {
  const i = Number(index);
  return BUDGET_CAPS[i] ?? BUDGET_CAPS[0];
}

/** Calendar month key "YYYY-MM" for the spend ledger filename. */
export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function spendPath(root, month) {
  return join(root, ".crewclaw", "spend", `${month}.json`);
}

export function readSpend(root, month = monthKey()) {
  try {
    const s = JSON.parse(readFileSync(spendPath(root, month), "utf8"));
    return { total: Number(s.total) || 0, warned_80: Boolean(s.warned_80) };
  } catch {
    return { total: 0, warned_80: false };
  }
}

function writeSpend(root, month, ledger) {
  const dir = join(root, ".crewclaw", "spend");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(spendPath(root, month), JSON.stringify(ledger, null, 2));
  } catch {
    /* best effort — a spend-write failure must not crash the session */
  }
}

/**
 * Add `cost` to this month's ledger. Returns { total, cap, ratio, crossedWarn } where crossedWarn
 * is true exactly once — the task that pushes cumulative spend across the 80% line (the ledger's
 * warned_80 flag makes the warning one-shot, not once-per-task).
 */
export function recordSpend(root, budgetIndex, cost, month = monthKey()) {
  const cap = capForBudgetIndex(budgetIndex);
  const prior = readSpend(root, month);
  const total = Math.round((prior.total + (Number(cost) || 0)) * 1e6) / 1e6;
  const ratio = cap > 0 ? total / cap : 0;
  const crossedWarn = !prior.warned_80 && ratio >= WARN_RATIO;
  writeSpend(root, month, { total, warned_80: prior.warned_80 || crossedWarn });
  return { total, cap, ratio, crossedWarn };
}

/** True when this month's spend has reached the cap — route should refuse new tasks. */
export function isOverBudget(root, budgetIndex, month = monthKey()) {
  const cap = capForBudgetIndex(budgetIndex);
  return cap > 0 && readSpend(root, month).total >= cap;
}
