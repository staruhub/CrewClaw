// prefs.mjs — engine-side reader for the TUI SETTINGS the Rust front-end persists to
// .crewclaw/prefs.json (workbench/config.rs Prefs::save). v0.18 C4: the approval-policy row was
// "存而不用" (stored but ignored) — this makes the engine actually honor it. Missing/corrupt file →
// defaults, so behavior is unchanged unless the user explicitly changed a setting.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readStateFileGuarded, resolveStatePath } from "../state-lock.mjs";

// Mirrors overlay_settings.rs APPROVAL_OPTS = ["所有交付", "信任后自动"] by index (v0.18 收束:
// dropped the no-op "仅产出物" middle tier that behaved identically to "所有交付").
export const APPROVAL_ALL_DELIVERIES = 0;
export const APPROVAL_TRUST_AUTO = 1;

// After this many cumulative accepted tasks, "信任后自动" stops asking and auto-accepts. Uses the
// same real accepted count the KPI panel shows — trust is earned by a track record, not assumed.
export const TRUST_AUTO_THRESHOLD = 3;

export function readPrefs(root) {
  try {
    const path = resolveStatePath(join(root, ".crewclaw", "prefs.json"), root);
    if (!existsSync(path)) return {};
    return (
      JSON.parse(readStateFileGuarded(path, { root }).toString("utf8")) ?? {}
    );
  } catch {
    return {};
  }
}

/**
 * The approval policy: 0 = 所有交付 (manual gate), 1 = 信任后自动. Default 0.
 * Any stored value ≥1 is treated as trust — this also absorbs a legacy "2" from the pre-collapse
 * 3-tier scheme (old 信任后自动=2 → still trust), so no separate migration table is needed.
 */
export function readApprovalPolicy(root) {
  return Number(readPrefs(root).approval) >= 1
    ? APPROVAL_TRUST_AUTO
    : APPROVAL_ALL_DELIVERIES;
}

/** The monthly-budget option index (0..3 → $20/$50/$100/$200). Default 0. */
export function readBudgetIndex(root) {
  const v = Number(readPrefs(root).budget);
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * M1 (conditional Dream) — the legacy learning rollback switch. Default ON (=生产当前行为:
 * accept → 即时写活跃记忆). `CREW_LEGACY_LEARNING` env overrides prefs: "0" forces off, "1" forces
 * on, unset falls through to prefs.legacy_learning (default true). M4 flips the prefs default to
 * false; this env + prefs pair stays as the auditable rollback channel until M5 removes legacy.
 */
export function legacyLearningEnabled(root, env = process.env) {
  const flag = env?.CREW_LEGACY_LEARNING;
  if (flag === "0") return false;
  if (flag === "1") return true;
  const stored = readPrefs(root).legacy_learning;
  return stored !== false; // default ON until M4 flips it
}

/**
 * M4 SETTINGS row7 becomes "Dream 推荐：开启/关闭" (was the unsupported "Dream 时间"). Reuses the
 * existing Prefs.dream index; 0 = 开启, anything else = 关闭. Default 开启. Consumed by the
 * DreamController to decide whether to surface recommendations (mode gate, not a hard block).
 */
export function readDreamRecommendation(root) {
  const v = readPrefs(root).dream;
  return v === undefined || Number(v) === 0; // default 开启
}
