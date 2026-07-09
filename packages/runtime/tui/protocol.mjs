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
  // approval.required = mid-task L2 tool confirm; approval.requested = the task-end
  // acceptance gate (§5.4/§11): a deliverable-producing task enters Approval before Done.
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_RESOLVED: "approval.resolved",
  APPROVAL_ACCEPTED: "approval.accepted",
  APPROVAL_REJECTED: "approval.rejected",
  ASSISTANT_MESSAGE: "assistant.message",
  // v0.8 M2 — the fully-assembled assistant turn, pre-rendered to ANSI lines so every
  // front-end shares one markdown renderer (ui-markdown.mjs). token.delta still streams the
  // raw text live; assistant.rendered "sets" the typeset version once the turn completes.
  ASSISTANT_RENDERED: "assistant.rendered",
  TOKEN_DELTA: "token.delta",
  // v0.11 M4：模型推理增量（真·思考，来自 delta.reasoning_content）。前端收进可折叠「思考」块。
  THINKING_DELTA: "thinking.delta",
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
  // v0.18 C3 — monthly budget crossed a threshold. level:"warn" at ≥80% (one-shot), level:"block"
  // when a new task is refused at ≥100%. The notification center's first budget-sourced entry.
  BUDGET_WARNING: "budget.warning",
  MEMORY_STATE: "memory.state",
  MEMORY_REQUESTED: "memory.requested",
  MEMORY_SAVED: "memory.saved",
  WORKSPACE_REVEALED: "workspace.revealed",
  OUTCOME_CHECKED: "outcome.checked", // completion verdict (§5.8 No-Chat-only-Done): did the task leave a real deliverable?
  // v0.8 M3 — a slash command's result. The engine executes commands (they depend on engine
  // state: registry/history/model); the front-end only shows output. `clear:true` also tells
  // the front-end to reset its transcript so /clear stays a single source of truth.
  COMMAND_OUTPUT: "command.output",
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
