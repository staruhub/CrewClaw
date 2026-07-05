// tui/protocol.mjs — the TaskEvent protocol. RENDERER-AGNOSTIC + serializable: the engine
// (today: agentLoop in this same node process; tomorrow: a Node/Rust subprocess emitting
// JSONL over stdout) produces these events; ANY renderer (Ink now, Ratatui later) folds
// them into AppState. The iron law: the TUI consumes TaskEvents, never the model's raw text.
//
// Not bound to Ink. Pure data. makeEvent() leaves `ts` to the emitter (Date.now lives in the
// runtime, not here) so this module stays pure and unit-testable.
export const EVENTS = {
  TASK_STARTED: "task.started",
  TASK_MODE_CHANGED: "task.mode_changed",
  PLAN_CREATED: "plan.created",
  PLAN_APPROVED: "plan.approved",
  STEP_STARTED: "step.started",
  STEP_COMPLETED: "step.completed",
  TOOL_REQUESTED: "tool.requested",
  TOOL_SUCCEEDED: "tool.succeeded",
  TOOL_FAILED: "tool.failed",
  ARTIFACT_CREATED: "artifact.created",
  ARTIFACT_UPDATED: "artifact.updated",
  ARTIFACT_SELECTED: "artifact.selected",
  ARTIFACT_DELETED: "artifact.deleted",
  ARTIFACT_REVEALED: "artifact.revealed",
  ARTIFACT_EXPORTED: "artifact.exported",
  EVIDENCE_CREATED: "evidence.created",
  APPROVAL_REQUIRED: "approval.required",
  APPROVAL_RESOLVED: "approval.resolved",
  APPROVAL_ACCEPTED: "approval.accepted",
  APPROVAL_REJECTED: "approval.rejected",
  ASSISTANT_MESSAGE: "assistant.message",
  TOKEN_DELTA: "token.delta",
  TOKEN_USAGE: "token.usage",
  TASK_COMPLETED: "task.completed",
  TASK_REJECTED: "task.rejected",
  TASK_BLOCKED: "task.blocked",
  // v0.6 — chat-to-workbench hardening (§5.4)
  TASK_UPGRADED_FROM_CHAT: "task.upgraded_from_chat",
  SKILL_LAUNCHED: "skill.launched",
  TOOL_PREFLIGHT_CHECKED: "tool.preflight_checked",
  SOURCE_CHECKED: "source.checked",
  PENDING_ACTIONS: "pending.actions",
  QUICK_UTILITY: "quick.utility",
  MEMORY_STATE: "memory.state",
  MEMORY_REQUESTED: "memory.requested",
  MEMORY_SAVED: "memory.saved",
  WORKSPACE_REVEALED: "workspace.revealed",
  OUTCOME_CHECKED: "outcome.checked", // completion verdict (§5.8 No-Chat-only-Done): did the task leave a real deliverable?
  DEBUG_LINE: "debug.line",
};

const KNOWN = new Set(Object.values(EVENTS));
export function isTaskEvent(type) { return KNOWN.has(type); }

// A plain, JSONL-ready event: { type, ts, data }. The payload is NAMESPACED under `data` so
// payload fields (e.g. an artifact's own `type`) can never clobber the envelope `type`/`ts`.
// `ts` is injected by the emitter (0 if unstamped).
export function makeEvent(type, data = {}, ts = 0) {
  return { type, ts, data };
}
