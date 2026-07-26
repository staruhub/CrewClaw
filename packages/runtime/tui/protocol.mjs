// tui/protocol.mjs — the TaskEvent protocol. RENDERER-AGNOSTIC + serializable: the engine
// (today: agentLoop in this same node process; tomorrow: a Node/Rust subprocess emitting
// JSONL over stdout) produces these events; ANY renderer (Ink now, Ratatui later) folds
// them into AppState. The iron law: the TUI consumes TaskEvents, never the model's raw text.
//
// Not bound to Ink. Pure data. makeEvent() leaves `ts` to the emitter (Date.now lives in the
// runtime, not here) so this module stays pure and unit-testable.
export const TASK_EVENT_PROTOCOL_VERSION = 1;

export const EVENTS = {
  PROTOCOL_READY: "protocol.ready",
  SESSION_READY: "session.ready",
  TASK_STARTED: "task.started",
  GENERATION_STARTED: "generation.started",
  GENERATION_COMPLETED: "generation.completed",
  GENERATION_FAILED: "generation.failed",
  GENERATION_CANCELLED: "generation.cancelled",
  INPUT_QUEUED: "input.queued",
  TASK_MODE_CHANGED: "task.mode_changed",
  PLAN_CREATED: "plan.created",
  PLAN_APPROVED: "plan.approved",
  TODO_UPDATED: "todo.updated",
  STEP_STARTED: "step.started",
  STEP_COMPLETED: "step.completed",
  TOOL_REQUESTED: "tool.requested",
  TOOL_RUNNING: "tool.running",
  TOOL_CALLED: "tool.called",
  TOOL_SUCCEEDED: "tool.succeeded",
  TOOL_FAILED: "tool.failed",
  TOOL_BLOCKED: "tool.blocked",
  TOOL_CANCELLED: "tool.cancelled",
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
  // Progressive mid-stream markdown snapshot (full reparse, throttled). Same payload shape
  // as assistant.rendered; front-ends may treat it as a provisional typeset of the active part.
  ASSISTANT_RENDERING_PREVIEW: "assistant.rendering_preview",
  TOKEN_DELTA: "token.delta",
  // v0.11 M4：模型推理增量（真·思考，来自 delta.reasoning_content）。前端收进可折叠「思考」块。
  THINKING_DELTA: "thinking.delta",
  TOKEN_USAGE: "token.usage",
  TASK_COMPLETED: "task.completed",
  TASK_REJECTED: "task.rejected",
  TASK_BLOCKED: "task.blocked",
  TASK_FAILED: "task.failed",
  TASK_REVISION_NEEDED: "task.revision_needed",
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
  // Conditional Dream event family (dream/v1). Node and Rust land these together; the engine
  // emits them only after client.ready advertises support for dream/v1.
  DREAM_RECOMMENDED: "dream.recommended",
  DREAM_MORNING_REPORT: "dream.morning_report",
  DREAM_STARTED: "dream.started",
  DREAM_CANDIDATE_READY: "dream.candidate_ready",
  DREAM_VALIDATION_FAILED: "dream.validation_failed",
  DREAM_BLOCKED: "dream.blocked",
  DREAM_APPROVED: "dream.approved",
  DREAM_REJECTED: "dream.rejected",
  DREAM_ACTIVATED: "dream.activated",
  DREAM_ROLLED_BACK: "dream.rolled_back",
  // v0.8 M3 — a slash command's result. The engine executes commands (they depend on engine
  // state: registry/history/model); the front-end only shows output. `clear:true` also tells
  // the front-end to reset its transcript so /clear stays a single source of truth.
  COMMAND_OUTPUT: "command.output",
  DEBUG_LINE: "debug.line",
};

const KNOWN = new Set(Object.values(EVENTS));
const TOOL_EVENTS = new Set([
  EVENTS.TOOL_REQUESTED,
  EVENTS.TOOL_RUNNING,
  EVENTS.TOOL_CALLED,
  EVENTS.TOOL_SUCCEEDED,
  EVENTS.TOOL_FAILED,
  EVENTS.TOOL_BLOCKED,
  EVENTS.TOOL_CANCELLED,
]);
export function isTaskEvent(type) {
  return KNOWN.has(type);
}

const NON_EMPTY = "must be a non-empty string";

function requireString(data, key, errors) {
  if (typeof data?.[key] !== "string" || data[key].trim().length === 0) {
    errors.push(`data.${key} ${NON_EMPTY}`);
  }
}

function requireBoolean(data, key, errors) {
  if (typeof data?.[key] !== "boolean")
    errors.push(`data.${key} must be a boolean`);
}

function requireObject(data, key, errors) {
  const value = data?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`data.${key} must be an object`);
  }
}

function optionalString(data, key, errors, { nonEmpty = false } = {}) {
  if (data?.[key] === undefined) return;
  if (
    typeof data[key] !== "string" ||
    (nonEmpty && data[key].trim().length === 0)
  ) {
    errors.push(
      `data.${key} must be ${nonEmpty ? "a non-empty string" : "a string"}`
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireTaskReference(data, errors) {
  const hasId = data?.id !== undefined;
  const hasTaskRunId = data?.taskRunId !== undefined;
  if (hasId && !isNonEmptyString(data.id)) {
    errors.push(`data.id ${NON_EMPTY}`);
  }
  if (hasTaskRunId && !isNonEmptyString(data.taskRunId)) {
    errors.push(`data.taskRunId ${NON_EMPTY}`);
  }
  if (!hasId && !hasTaskRunId) {
    errors.push(`data.id or data.taskRunId ${NON_EMPTY}`);
  }
  if (
    isNonEmptyString(data?.id) &&
    isNonEmptyString(data?.taskRunId) &&
    data.id !== data.taskRunId
  ) {
    errors.push("data.id must equal data.taskRunId when both are present");
  }
}

function requireApprovalKind(data, expected, errors) {
  requireString(data, "kind", errors);
  // Additive: task-plan review ("plan_approval", from todo_write) rides the same
  // approval events as tool grants; a tool_authorization slot accepts either kind.
  const matches =
    data?.kind === expected ||
    (expected === "tool_authorization" && data?.kind === "plan_approval");
  if (typeof data?.kind === "string" && !matches) {
    errors.push(`data.kind must be ${expected} or plan_approval`);
  }
}

/**
 * Validate the canonical payload of a known TaskEvent.
 *
 * This deliberately covers the state-changing/correlated protocol surface first. Events that
 * are not listed remain additive and valid; consumers may give them presentation semantics
 * without coupling protocol evolution to this validator.
 */
export function validateTaskEventPayload(type, data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["data must be an object"] };
  }

  if (TOOL_EVENTS.has(type)) {
    optionalString(data, "name", errors, { nonEmpty: true });
    optionalString(data, "args_summary", errors);
    optionalString(data, "result_summary", errors);
    optionalString(data, "debug_ref", errors, { nonEmpty: true });
    if (data.truncated !== undefined && typeof data.truncated !== "boolean") {
      errors.push("data.truncated must be a boolean");
    }
  }

  switch (type) {
    case EVENTS.PROTOCOL_READY:
      requireString(data, "protocol", errors);
      if (!Array.isArray(data.event_families))
        errors.push("data.event_families must be an array");
      break;
    case EVENTS.TASK_STARTED:
      requireString(data, "id", errors);
      break;
    case EVENTS.GENERATION_STARTED:
    case EVENTS.GENERATION_COMPLETED:
    case EVENTS.GENERATION_FAILED:
    case EVENTS.GENERATION_CANCELLED:
      requireString(data, "id", errors);
      requireString(data, "turn_id", errors);
      requireString(data, "taskRunId", errors);
      if (!Number.isSafeInteger(data.seq) || data.seq < 0)
        errors.push("data.seq must be a non-negative safe integer");
      if (
        [EVENTS.GENERATION_FAILED, EVENTS.GENERATION_CANCELLED].includes(type)
      )
        requireString(data, "reason", errors);
      break;
    case EVENTS.INPUT_QUEUED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      if (!Number.isSafeInteger(data.position) || data.position < 1)
        errors.push("data.position must be a positive safe integer");
      break;
    case EVENTS.TOOL_RUNNING:
    case EVENTS.TOOL_CANCELLED:
      requireString(data, "id", errors);
      requireString(data, "turn_id", errors);
      requireString(data, "taskRunId", errors);
      requireString(data, "tool", errors);
      if (!Number.isSafeInteger(data.seq) || data.seq < 0)
        errors.push("data.seq must be a non-negative safe integer");
      break;
    case EVENTS.TASK_MODE_CHANGED:
      requireString(data, "taskRunId", errors);
      requireString(data, "mode", errors);
      break;
    case EVENTS.TASK_UPGRADED_FROM_CHAT:
      requireString(data, "taskRunId", errors);
      break;
    case EVENTS.TASK_COMPLETED:
      requireTaskReference(data, errors);
      break;
    case EVENTS.TASK_REJECTED:
    case EVENTS.TASK_BLOCKED:
    case EVENTS.TASK_FAILED:
    case EVENTS.TASK_REVISION_NEEDED:
      requireTaskReference(data, errors);
      requireString(data, "reason", errors);
      break;
    case EVENTS.OUTCOME_CHECKED:
      requireString(data, "taskRunId", errors);
      requireBoolean(data, "valid", errors);
      if (data.valid === true) requireString(data, "deliverable", errors);
      break;
    case EVENTS.ARTIFACT_CREATED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireString(data, "path", errors);
      break;
    case EVENTS.ARTIFACT_UPDATED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireObject(data, "patch", errors);
      break;
    case EVENTS.ARTIFACT_SELECTED:
      requireString(data, "artifact_id", errors);
      requireString(data, "taskRunId", errors);
      break;
    case EVENTS.ARTIFACT_DELETED:
      requireString(data, "artifact_id", errors);
      requireString(data, "taskRunId", errors);
      requireBoolean(data, "ok", errors);
      break;
    case EVENTS.ARTIFACT_REVEALED:
      requireString(data, "artifact_id", errors);
      requireString(data, "taskRunId", errors);
      requireBoolean(data, "ok", errors);
      break;
    case EVENTS.ARTIFACT_EXPORTED:
      requireString(data, "artifact_id", errors);
      requireString(data, "taskRunId", errors);
      requireBoolean(data, "ok", errors);
      if (data.ok === true) requireString(data, "path", errors);
      break;
    case EVENTS.APPROVAL_REQUIRED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireApprovalKind(data, "tool_authorization", errors);
      break;
    case EVENTS.APPROVAL_RESOLVED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireApprovalKind(data, "tool_authorization", errors);
      if (!new Set(["allow", "allow_session", "deny"]).has(data.decision)) {
        errors.push("data.decision must be allow, allow_session, or deny");
      }
      break;
    case EVENTS.APPROVAL_REQUESTED:
    case EVENTS.APPROVAL_ACCEPTED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireApprovalKind(data, "deliverable_acceptance", errors);
      break;
    case EVENTS.APPROVAL_REJECTED:
      requireString(data, "id", errors);
      requireString(data, "taskRunId", errors);
      requireApprovalKind(data, "deliverable_acceptance", errors);
      if (data.decision !== undefined && data.decision !== "reject") {
        errors.push("data.decision must be reject when present");
      }
      break;
    case EVENTS.DREAM_RECOMMENDED:
    case EVENTS.DREAM_MORNING_REPORT:
    case EVENTS.DREAM_STARTED:
    case EVENTS.DREAM_CANDIDATE_READY:
    case EVENTS.DREAM_VALIDATION_FAILED:
    case EVENTS.DREAM_BLOCKED:
    case EVENTS.DREAM_APPROVED:
    case EVENTS.DREAM_REJECTED:
    case EVENTS.DREAM_ACTIVATED:
    case EVENTS.DREAM_ROLLED_BACK:
      requireString(data, "dream_id", errors);
      requireString(data, "employee_id", errors);
      break;
  }

  return { ok: errors.length === 0, errors };
}

/** Validate a complete TaskEvent envelope without rejecting additive, same-version event types. */
export function validateTaskEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, known: false, errors: ["event must be an object"] };
  }
  if (
    event.protocol_version !== undefined &&
    event.protocol_version !== TASK_EVENT_PROTOCOL_VERSION
  ) {
    errors.push(
      `protocol_version must be ${TASK_EVENT_PROTOCOL_VERSION} when present`
    );
  }
  if (typeof event.type !== "string" || event.type.length === 0) {
    errors.push(`type ${NON_EMPTY}`);
  }
  if (!Number.isSafeInteger(event.ts) || event.ts < 0) {
    errors.push("ts must be a non-negative safe integer");
  }
  const known = isTaskEvent(event.type);
  if (known) {
    errors.push(...validateTaskEventPayload(event.type, event.data).errors);
  } else if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    errors.push("data must be an object");
  }
  return { ok: errors.length === 0, known, errors };
}

// A plain, JSONL-ready event: { protocol_version, type, ts, data }. Missing version is accepted
// as legacy v1 by Rust; explicit future versions are rejected rather than silently mis-reduced.
export function makeEvent(type, data = {}, ts = 0) {
  return { protocol_version: TASK_EVENT_PROTOCOL_VERSION, type, ts, data };
}
