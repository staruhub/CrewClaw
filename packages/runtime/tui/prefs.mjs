// prefs.mjs — engine-side reader for the TUI SETTINGS the Rust front-end persists to
// .crewclaw/prefs.json (workbench/config.rs Prefs::save). v0.18 C4: the approval-policy row was
// "存而不用" (stored but ignored) — this makes the engine actually honor it. Missing/corrupt file →
// defaults, so behavior is unchanged unless the user explicitly changed a setting.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors overlay_settings.rs APPROVAL_OPTS = ["所有交付", "仅产出物", "信任后自动"] by index.
export const APPROVAL_ALL_DELIVERIES = 0;
export const APPROVAL_ARTIFACTS_ONLY = 1;
export const APPROVAL_TRUST_AUTO = 2;

// After this many cumulative accepted tasks, "信任后自动" stops asking and auto-accepts. Uses the
// same real accepted count the KPI panel shows — trust is earned by a track record, not assumed.
export const TRUST_AUTO_THRESHOLD = 3;

export function readPrefs(root) {
  try {
    return JSON.parse(readFileSync(join(root, ".crewclaw", "prefs.json"), "utf8")) ?? {};
  } catch {
    return {};
  }
}

/** The approval policy index (0/1/2). Default 0 = current "every delivery needs approval". */
export function readApprovalPolicy(root) {
  const p = readPrefs(root);
  const v = Number(p.approval);
  return v === APPROVAL_ARTIFACTS_ONLY || v === APPROVAL_TRUST_AUTO ? v : APPROVAL_ALL_DELIVERIES;
}
