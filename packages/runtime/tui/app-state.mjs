// tui/app-state.mjs — the AppState reducer. RENDERER-AGNOSTIC core of the Crew Workbench
// Framework: reduce(state, taskEvent) folds the event stream into the workbench state every
// renderer draws. Components read AppState SLICES (timeline / tools / artifacts / evidence /
// approval), never the model's raw text. Pure + deterministic → unit-testable with no TTY.
// Event payloads live under ev.data (namespaced — see protocol.makeEvent).
import { EVENTS } from "./protocol.mjs";

// status symbols — don't rely on color alone (vision UI standard)
export const SYM = { running: "→", ok: "✓", fail: "✗", warn: "!", wait: "?" };

export function initialAppState(meta = {}) {
  return {
    employee: meta.employee || null, // { name, role, model }
    mode: meta.mode || "Chat", // Chat | Run | Trial | Doctor | ...
    task: null, // { id, title, status }
    taskStreamTerminal: false, // true after any accepted task.* terminal event
    taskArtifactStart: 0, // artifact index captured at task.started (old artifacts never satisfy Done)
    plan: null, // { steps:[], status }
    timeline: [], // [{ id, status: SYM.*, label, detail }]
    tools: {}, // Tool Truth State: { [id]: { tool, status, summary, args } }
    artifacts: [], // [{ id, name, type, status, checks }]
    evidence: [], // [{ id, fact, source, confidence }]
    approval: null, // { id, kind, taskRunId, tool, reason, scope }
    settledApprovals: {}, // approval id -> accepted|rejected|resolved (replay de-dupe)
    acceptedCount: 0, // deliverable acceptance KPI, de-duplicated by approval id
    answer: "", // current assistant deliverable text (later → semantic blocks)
    renderedAnswer: null, // { turnId, ansiLines } — finalized renderer-ready answer
    renderedParts: [], // stable assistant parts; tool rows never cause an earlier part to move
    thinking: "", // reasoning stream, deliberately separate from deliverable answer
    generation: null, // { id, turnId, taskRunId, status, reason }
    queuedInputs: [], // busy-turn input acknowledgements, FIFO
    lastEventSeq: null, // monotonic correlated stream sequence for the active turn
    commandOutput: null, // latest structured slash-command output
    usage: { promptTok: 0, completionTok: 0 },
    status: "idle", // idle | running | awaiting_approval | done | needs_artifact | rejected
    debug: [], // raw log lines (debug drawer)
    pendingActions: [], // [{ key, label, action_type, payload }] (§5.6) — digit input matches here FIRST
    memory: {
      session: "available",
      persistent: "unavailable",
      workspace: "unavailable",
    }, // Memory Truth (§9.8)
    quickUtility: null, // QuickUtilityRun result card (§5.3) — NOT a TaskRun
    proof: null, // completion verdict { valid, deliverable, gaps } (§5.8 No-Chat-only-Done)
    selectedArtifact: null,
    caps: {},
    commands: [],
    budgetWarning: null,
    protocol: { eventFamilies: [] },
    dream: null,
    dreamMorningReport: null,
  };
}

const idFor = (state, d) =>
  d.id != null ? d.id : "ln" + state.timeline.length;
const push = (timeline, id, status, label, detail) => [
  ...timeline,
  { id, status, label: label || "", detail: detail || "" },
];
function mark(timeline, id, status, detail) {
  let idx = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const l = timeline[i];
    if (
      id != null
        ? l.id === id
        : l.status === SYM.running || l.status === SYM.wait
    ) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return timeline;
  const copy = timeline.slice();
  copy[idx] = { ...copy[idx], status, detail: detail || copy[idx].detail };
  return copy;
}
const setTool = (tools, id, patch) => ({
  ...tools,
  [id]: { ...(tools[id] || {}), ...patch },
});
const isChatMode = mode => String(mode || "").toLowerCase() === "chat";
const isNonEmptyString = value =>
  typeof value === "string" && value.trim().length > 0;
const TERMINAL_STATUSES = new Set(["done", "rejected", "blocked", "failed"]);
const TOOL_TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);
const GENERATION_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);
const TOOL_STATUS_RANK = {
  requested: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  blocked: 2,
  cancelled: 2,
};

function ignored(state, message) {
  return { ...state, debug: [...state.debug, message] };
}

function isFormalTask(state) {
  return Boolean(state.task) && !isChatMode(state.mode);
}

function taskCorrelationMatches(state, data, field = "id") {
  const currentTaskId = state.task?.id;
  if (!isNonEmptyString(currentTaskId)) return false;
  const eventTaskId = data?.[field];
  if (!isNonEmptyString(eventTaskId)) return !isFormalTask(state);
  return eventTaskId === currentTaskId;
}

function terminalTaskReference(data) {
  if (
    (data?.taskRunId !== undefined && !isNonEmptyString(data.taskRunId)) ||
    (data?.id !== undefined && !isNonEmptyString(data.id))
  ) {
    return { ok: false, id: null, reason: "invalid task reference" };
  }
  if (
    isNonEmptyString(data?.taskRunId) &&
    isNonEmptyString(data?.id) &&
    data.taskRunId !== data.id
  ) {
    return {
      ok: false,
      id: data.taskRunId,
      reason: `conflicting id ${data.id} and taskRunId ${data.taskRunId}`,
    };
  }
  const id = data?.taskRunId || data?.id || null;
  return {
    ok: isNonEmptyString(id),
    id,
    reason: isNonEmptyString(id) ? "" : "missing task reference",
  };
}

function terminalGuard(state, data, nextStatus, eventType) {
  const reference = terminalTaskReference(data);
  if (!reference.ok) {
    return ignored(state, `ignored ${eventType} with ${reference.reason}`);
  }
  const eventTaskId = reference.id;
  if (!taskCorrelationMatches(state, { ...data, id: eventTaskId }, "id")) {
    return ignored(
      state,
      `ignored stale or uncorrelated ${eventType} for ${eventTaskId || "<missing>"}`
    );
  }
  const currentStatus = state.task?.status;
  const currentTerminal =
    state.task?.terminalType ||
    (TERMINAL_STATUSES.has(currentStatus) ? `legacy:${currentStatus}` : null);
  if (!currentTerminal) return null;
  if (currentStatus === nextStatus) return state;
  return ignored(
    state,
    `ignored conflicting ${eventType}; task ${state.task.id} is already ${currentStatus}`
  );
}

function taskIsTerminal(task) {
  return Boolean(task?.terminalType) || TERMINAL_STATUSES.has(task?.status);
}

function liveEventGuard(state, data, eventType) {
  if (state.taskStreamTerminal === true || taskIsTerminal(state.task)) {
    return ignored(
      state,
      `ignored ${eventType} after terminal ${state.task.status}`
    );
  }
  if (
    isNonEmptyString(data?.taskRunId) &&
    !taskCorrelationMatches(state, data, "taskRunId")
  ) {
    return ignored(
      state,
      `ignored stale or uncorrelated ${eventType} for ${data.taskRunId}`
    );
  }
  if (
    isNonEmptyString(state.generation?.turnId) &&
    isNonEmptyString(data?.turn_id) &&
    data.turn_id !== state.generation.turnId
  ) {
    return ignored(
      state,
      `ignored stale ${eventType} for turn ${data.turn_id}; active turn is ${state.generation.turnId}`
    );
  }
  if (
    Number.isSafeInteger(data?.seq) &&
    Number.isSafeInteger(state.lastEventSeq) &&
    data.seq <= state.lastEventSeq
  ) {
    return ignored(
      state,
      `ignored out-of-order ${eventType} seq=${data.seq} after ${state.lastEventSeq}`
    );
  }
  return null;
}

function streamEventGuard(state, data, eventType) {
  const guarded = liveEventGuard(state, data, eventType);
  if (guarded !== null) return guarded;
  if (GENERATION_TERMINAL_STATUSES.has(state.generation?.status)) {
    return ignored(
      state,
      `ignored ${eventType} after generation ${state.generation.status}`
    );
  }
  return null;
}

function toolTransitionGuard(state, data, nextStatus, eventType) {
  const current = state.tools[data?.id]?.status;
  if (!current) return null;
  if (current === nextStatus) return withEventSeq(state, data);
  const currentRank = TOOL_STATUS_RANK[current] ?? -1;
  const nextRank = TOOL_STATUS_RANK[nextStatus] ?? -1;
  if (
    TOOL_TERMINAL_STATUSES.has(current) ||
    (currentRank >= 0 && nextRank >= 0 && nextRank < currentRank)
  ) {
    return ignored(
      withEventSeq(state, data),
      `ignored non-monotonic ${eventType}; tool ${data?.id || "<missing>"} is already ${current}`
    );
  }
  return null;
}

const withEventSeq = (state, data) =>
  Number.isSafeInteger(data?.seq)
    ? { ...state, lastEventSeq: data.seq }
    : state;

function artifactId(data) {
  return data?.artifact_id || data?.artifactId || data?.id;
}

function artifactCorrelationMatches(state, data, id = artifactId(data)) {
  if (!isNonEmptyString(id)) return false;
  const artifact = state.artifacts.find(candidate => candidate.id === id);
  if (!artifact) return false;
  if (isFormalTask(state) && !taskCorrelationMatches(state, data, "taskRunId"))
    return false;
  if (
    isNonEmptyString(data?.taskRunId) &&
    isNonEmptyString(artifact.taskId) &&
    data.taskRunId !== artifact.taskId
  ) {
    return false;
  }
  return true;
}

function approvalEventCorrelationMatches(state, data, expectedKind) {
  if (!isNonEmptyString(data?.id)) return false;
  if (isFormalTask(state)) {
    return (
      data.kind === expectedKind &&
      taskCorrelationMatches(state, data, "taskRunId")
    );
  }
  if (isNonEmptyString(data?.kind) && data.kind !== expectedKind) return false;
  if (
    isNonEmptyString(data?.taskRunId) &&
    !taskCorrelationMatches(state, data, "taskRunId")
  ) {
    return false;
  }
  return true;
}

function pendingApprovalMatches(state, data, expectedKind) {
  const pending = state.approval;
  if (!pending || pending.kind !== expectedKind) return false;
  const eventId = isNonEmptyString(data?.id)
    ? data.id
    : isFormalTask(state)
      ? null
      : pending.id;
  const eventKind = isNonEmptyString(data?.kind)
    ? data.kind
    : isFormalTask(state)
      ? null
      : pending.kind;
  const eventTaskId = isNonEmptyString(data?.taskRunId)
    ? data.taskRunId
    : isFormalTask(state)
      ? null
      : pending.taskRunId;
  return (
    eventId === pending.id &&
    eventKind === pending.kind &&
    eventTaskId === pending.taskRunId
  );
}

function currentTaskHasArtifact(state) {
  const start = Number.isInteger(state.taskArtifactStart)
    ? state.taskArtifactStart
    : state.artifacts.length;
  return state.artifacts
    .slice(start)
    .some(
      artifact =>
        artifact.status !== "deleted" &&
        typeof artifact.path === "string" &&
        artifact.path.length > 0 &&
        artifact.taskId === state.task?.id
    );
}

export function reduce(state, ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case EVENTS.PROTOCOL_READY:
      return {
        ...state,
        protocol: {
          eventFamilies: Array.isArray(d.event_families)
            ? d.event_families
            : [],
        },
      };
    case EVENTS.SESSION_READY: {
      const employee =
        d.employee && typeof d.employee === "object"
          ? d.employee
          : state.employee;
      const caps = d.caps && typeof d.caps === "object" ? d.caps : {};
      return {
        ...state,
        employee,
        mode: employee?.mode || state.mode,
        caps,
        commands: Array.isArray(caps.commands) ? caps.commands : [],
        status: state.task ? state.status : "idle",
      };
    }
    case EVENTS.TASK_STARTED: {
      if (!isNonEmptyString(d.id)) {
        return ignored(state, "ignored task.started without canonical id");
      }
      if (state.task?.id === d.id) return state;
      if (state.task && state.taskStreamTerminal !== true) {
        return ignored(
          state,
          `ignored overlapping task.started ${d.id}; task ${state.task.id} has no explicit terminal event`
        );
      }
      return {
        ...state,
        task: {
          id: d.id,
          title: d.title || "",
          status: "running",
          terminalType: null,
        },
        taskArtifactStart: state.artifacts.length,
        taskStreamTerminal: false,
        mode: d.mode || "Task",
        status: "running",
        answer: "",
        renderedAnswer: null,
        renderedParts: [],
        thinking: "",
        generation: null,
        queuedInputs:
          d.queued === true ? state.queuedInputs.slice(1) : state.queuedInputs,
        lastEventSeq: Number.isSafeInteger(d.seq) ? d.seq : null,
        proof: null,
        approval: null,
        pendingActions: [],
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.running,
          `任务：${d.title || ""}`
        ),
      };
    }
    case EVENTS.GENERATION_STARTED: {
      const guarded = liveEventGuard(state, d, EVENTS.GENERATION_STARTED);
      if (guarded !== null) return guarded;
      return withEventSeq(
        {
          ...state,
          generation: {
            id: d.id,
            turnId: d.turn_id || null,
            taskRunId: d.taskRunId || state.task?.id || null,
            status: "running",
            reason: null,
          },
          status: "running",
        },
        d
      );
    }
    case EVENTS.GENERATION_COMPLETED:
    case EVENTS.GENERATION_FAILED:
    case EVENTS.GENERATION_CANCELLED: {
      const guarded = liveEventGuard(state, d, ev.type);
      if (guarded !== null) return guarded;
      if (state.generation?.id && d.id && state.generation.id !== d.id) {
        return ignored(
          state,
          `ignored mismatched ${ev.type} ${d.id}; active generation is ${state.generation.id}`
        );
      }
      const status =
        ev.type === EVENTS.GENERATION_COMPLETED
          ? "completed"
          : ev.type === EVENTS.GENERATION_FAILED
            ? "failed"
            : "cancelled";
      return withEventSeq(
        {
          ...state,
          generation: {
            ...(state.generation || {}),
            id: d.id || state.generation?.id || null,
            turnId: d.turn_id || state.generation?.turnId || null,
            taskRunId: d.taskRunId || state.task?.id || null,
            status,
            reason: d.reason || null,
          },
        },
        d
      );
    }
    case EVENTS.INPUT_QUEUED: {
      const guarded = liveEventGuard(state, d, EVENTS.INPUT_QUEUED);
      if (guarded !== null) return guarded;
      if (state.queuedInputs.some(input => input.id === d.id)) return state;
      return withEventSeq(
        {
          ...state,
          queuedInputs: [
            ...state.queuedInputs,
            {
              id: d.id,
              position: d.position,
              text: d.text || "",
            },
          ],
        },
        d
      );
    }
    case EVENTS.TASK_MODE_CHANGED:
      if (!state.task || !taskCorrelationMatches(state, d, "taskRunId")) {
        return ignored(
          state,
          `ignored stale or uncorrelated task.mode_changed for ${d.taskRunId || "<missing>"}`
        );
      }
      if (!isNonEmptyString(d.mode)) {
        return ignored(
          state,
          "ignored task.mode_changed without canonical mode"
        );
      }
      return {
        ...state,
        mode: d.mode,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          `模式：${d.mode}`
        ),
      };
    case EVENTS.PLAN_CREATED:
      return {
        ...state,
        plan: { steps: d.steps || [], status: "proposed" },
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          "生成计划",
          (d.steps || []).join(" · ")
        ),
      };
    case EVENTS.PLAN_APPROVED:
      return {
        ...state,
        plan: state.plan ? { ...state.plan, status: "approved" } : state.plan,
      };
    case EVENTS.TODO_UPDATED: {
      const todos = Array.isArray(d.todos) ? d.todos : [];
      return {
        ...state,
        plan: {
          steps: todos.map(todo => String(todo?.content || "")),
          statuses: todos.map(todo => String(todo?.status || "pending")),
          status:
            d.phase === "proposed"
              ? "proposed"
              : state.plan?.status === "proposed"
                ? "proposed"
                : "approved",
        },
      };
    }
    case EVENTS.STEP_STARTED:
      return {
        ...state,
        timeline: push(state.timeline, idFor(state, d), SYM.running, d.label),
      };
    case EVENTS.STEP_COMPLETED:
      return {
        ...state,
        timeline: mark(state.timeline, d.id, SYM.ok, d.summary),
      };
    case EVENTS.TOOL_REQUESTED:
    case EVENTS.TOOL_CALLED: {
      const guarded = streamEventGuard(state, d, ev.type);
      if (guarded !== null) return guarded;
      const requested = ev.type === EVENTS.TOOL_REQUESTED;
      const nextStatus = requested ? "requested" : "running";
      const transition = toolTransitionGuard(state, d, nextStatus, ev.type);
      if (transition !== null) return transition;
      const exists = state.timeline.some(line => line.id === d.id);
      return withEventSeq(
        {
          ...state,
          tools: setTool(state.tools, d.id, {
            tool: d.tool,
            name: d.name || d.tool,
            status: nextStatus,
            args: d.args,
            argsSummary: d.args_summary,
          }),
          approval: d.needsApproval
            ? {
                id: d.id,
                kind: "tool_authorization",
                taskRunId: state.task?.id || null,
                tool: d.tool,
                reason: d.reason,
                scope: d.scope,
              }
            : state.approval,
          status: d.needsApproval ? "awaiting_approval" : state.status,
          timeline: exists
            ? state.timeline
            : push(
                state.timeline,
                idFor(state, d),
                d.needsApproval ? SYM.wait : SYM.running,
                d.label ||
                  [d.name, d.args_summary].filter(Boolean).join(" · ") ||
                  d.tool,
                d.reason
              ),
        },
        d
      );
    }
    case EVENTS.TOOL_RUNNING: {
      const guarded = streamEventGuard(state, d, EVENTS.TOOL_RUNNING);
      if (guarded !== null) return guarded;
      const transition = toolTransitionGuard(
        state,
        d,
        "running",
        EVENTS.TOOL_RUNNING
      );
      if (transition !== null) return transition;
      const exists = state.timeline.some(line => line.id === d.id);
      return withEventSeq(
        {
          ...state,
          tools: setTool(state.tools, d.id, {
            tool: d.tool || state.tools[d.id]?.tool,
            name: d.name || state.tools[d.id]?.name || d.tool,
            status: "running",
            args: d.args || state.tools[d.id]?.args,
            argsSummary: d.args_summary || state.tools[d.id]?.argsSummary,
          }),
          timeline: exists
            ? mark(state.timeline, d.id, SYM.running, d.detail)
            : push(
                state.timeline,
                d.id,
                SYM.running,
                d.label ||
                  [d.name, d.args_summary].filter(Boolean).join(" · ") ||
                  d.tool,
                d.detail
              ),
        },
        d
      );
    }
    case EVENTS.TOOL_SUCCEEDED: {
      const guarded = streamEventGuard(state, d, EVENTS.TOOL_SUCCEEDED);
      if (guarded !== null) return guarded;
      const transition = toolTransitionGuard(
        state,
        d,
        "succeeded",
        EVENTS.TOOL_SUCCEEDED
      );
      if (transition !== null) return transition;
      const summary = d.result_summary || d.summary;
      return withEventSeq(
        {
          ...state,
          tools: setTool(state.tools, d.id, {
            status: "succeeded",
            summary,
            resultSummary: d.result_summary,
          }),
          timeline: mark(state.timeline, d.id, SYM.ok, summary),
        },
        d
      );
    }
    case EVENTS.TOOL_FAILED:
    case EVENTS.TOOL_BLOCKED: {
      const guarded = streamEventGuard(state, d, ev.type);
      if (guarded !== null) return guarded;
      const status = ev.type === EVENTS.TOOL_BLOCKED ? "blocked" : "failed";
      const transition = toolTransitionGuard(state, d, status, ev.type);
      if (transition !== null) return transition;
      const summary = d.result_summary || d.code || d.error || d.reason;
      return withEventSeq(
        {
          ...state,
          tools: setTool(state.tools, d.id, {
            status,
            summary,
            resultSummary: d.result_summary,
          }),
          timeline: mark(
            state.timeline,
            d.id,
            ev.type === EVENTS.TOOL_BLOCKED ? SYM.warn : SYM.fail,
            summary
          ),
        },
        d
      );
    }
    case EVENTS.TOOL_CANCELLED: {
      const guarded = streamEventGuard(state, d, EVENTS.TOOL_CANCELLED);
      if (guarded !== null) return guarded;
      const transition = toolTransitionGuard(
        state,
        d,
        "cancelled",
        EVENTS.TOOL_CANCELLED
      );
      if (transition !== null) return transition;
      const summary = d.result_summary || d.code || d.reason || "cancelled";
      return withEventSeq(
        {
          ...state,
          tools: setTool(state.tools, d.id, {
            status: "cancelled",
            summary,
            resultSummary: d.result_summary,
          }),
          timeline: mark(state.timeline, d.id, SYM.warn, summary),
        },
        d
      );
    }
    case EVENTS.ARTIFACT_CREATED: {
      if (!state.task || !taskCorrelationMatches(state, d, "taskRunId")) {
        return ignored(
          state,
          `ignored uncorrelated artifact.created ${d.id || "<missing>"}`
        );
      }
      if (
        !isNonEmptyString(d.id) ||
        (isFormalTask(state) && !isNonEmptyString(d.path))
      ) {
        return ignored(
          state,
          "ignored artifact.created with invalid canonical payload"
        );
      }
      if (state.artifacts.some(artifact => artifact.id === d.id)) return state;
      const artifact = {
        id: d.id,
        taskId: state.task.id,
        name: d.name,
        kind: d.kind || d.type,
        type: d.type || d.kind,
        path: d.path,
        status: d.status || "draft",
        checks: d.checks || [],
      };
      return {
        ...state,
        artifacts: [...state.artifacts, artifact],
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          `交付物：${d.name || ""}`,
          d.path
        ),
      };
    }
    case EVENTS.ARTIFACT_UPDATED:
      if (!artifactCorrelationMatches(state, d, d.id)) {
        return ignored(
          state,
          `ignored uncorrelated artifact.updated ${d.id || "<missing>"}`
        );
      }
      return {
        ...state,
        artifacts: state.artifacts.map(artifact =>
          artifact.id === d.id ? { ...artifact, ...(d.patch || {}) } : artifact
        ),
      };
    case EVENTS.ARTIFACT_SELECTED: {
      const id = artifactId(d);
      if (!artifactCorrelationMatches(state, d, id)) {
        return ignored(
          state,
          `ignored uncorrelated artifact.selected ${id || "<missing>"}`
        );
      }
      return { ...state, selectedArtifact: id };
    }
    case EVENTS.ARTIFACT_DELETED: {
      const id = artifactId(d);
      if (!artifactCorrelationMatches(state, d, id)) {
        return ignored(
          state,
          `ignored uncorrelated artifact.deleted ${id || "<missing>"}`
        );
      }
      if (d.ok !== true) {
        return {
          ...state,
          selectedArtifact: id,
          timeline: push(
            state.timeline,
            idFor(state, d),
            SYM.warn,
            "删除产物失败",
            d.reason || d.error || d.code
          ),
        };
      }
      return {
        ...state,
        artifacts: state.artifacts.map(artifact =>
          artifact.id === id ? { ...artifact, status: "deleted" } : artifact
        ),
        selectedArtifact: id,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.warn,
          "删除产物",
          id
        ),
      };
    }
    case EVENTS.ARTIFACT_REVEALED: {
      const id = artifactId(d);
      if (!artifactCorrelationMatches(state, d, id)) {
        return ignored(
          state,
          `ignored uncorrelated artifact.revealed ${id || "<missing>"}`
        );
      }
      const opened = d.ok === true;
      return {
        ...state,
        selectedArtifact: id,
        timeline: push(
          state.timeline,
          idFor(state, d),
          opened ? SYM.ok : SYM.warn,
          opened ? "打开位置" : "无法打开,路径已给",
          d.path || id
        ),
      };
    }
    case EVENTS.ARTIFACT_EXPORTED: {
      const id = artifactId(d);
      if (!artifactCorrelationMatches(state, d, id)) {
        return ignored(
          state,
          `ignored uncorrelated artifact.exported ${id || "<missing>"}`
        );
      }
      if (d.ok !== true || !isNonEmptyString(d.path)) {
        return {
          ...state,
          selectedArtifact: id,
          timeline: push(
            state.timeline,
            idFor(state, d),
            SYM.warn,
            "导出产物失败",
            d.reason || d.error || d.code
          ),
        };
      }
      return {
        ...state,
        artifacts: state.artifacts.map(artifact =>
          artifact.id === id
            ? { ...artifact, status: "exported", exportPath: d.path }
            : artifact
        ),
        selectedArtifact: id,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          "导出产物",
          d.path
        ),
      };
    }
    case EVENTS.EVIDENCE_CREATED:
      return {
        ...state,
        evidence: [
          ...state.evidence,
          {
            id: d.id,
            fact: d.fact,
            source: d.source,
            confidence: d.confidence,
          },
        ],
      };
    case EVENTS.APPROVAL_REQUIRED:
    case EVENTS.APPROVAL_REQUESTED: {
      if (taskIsTerminal(state.task)) {
        return ignored(
          state,
          `ignored ${ev.type} after terminal ${state.task.status}`
        );
      }
      const kind =
        ev.type === EVENTS.APPROVAL_REQUIRED
          ? "tool_authorization"
          : "deliverable_acceptance";
      if (!approvalEventCorrelationMatches(state, d, kind)) {
        return ignored(
          state,
          `ignored uncorrelated ${ev.type} ${d.id || "<missing>"}`
        );
      }
      const taskRunId = d.taskRunId || state.task?.id || null;
      if (state.approval) {
        if (
          state.approval.id === d.id &&
          state.approval.kind === kind &&
          state.approval.taskRunId === taskRunId
        ) {
          return state;
        }
        return ignored(
          state,
          `ignored ${ev.type}; approval ${state.approval.id} is already pending`
        );
      }
      if (
        ev.type === EVENTS.APPROVAL_REQUIRED &&
        d.auto === true &&
        d.decision_source === "session_permission_lease"
      ) {
        // A cached session lease is already the authorization source. Keep the event pair for
        // audit consumers, but do not flash a modal or pause the renderer between adjacent lines.
        return state;
      }
      return {
        ...state,
        approval: {
          id: d.id,
          kind,
          taskRunId,
          tool: d.tool,
          reason: d.reason,
          scope: d.scope,
          sessionLease: d.session_lease,
          artifacts: Array.isArray(d.artifacts) ? d.artifacts : [],
        },
        status: "awaiting_approval",
      };
    }
    case EVENTS.APPROVAL_RESOLVED: {
      if (taskIsTerminal(state.task)) {
        return ignored(
          state,
          `ignored approval.resolved after terminal ${state.task.status}`
        );
      }
      const validDecision = new Set(["allow", "allow_session", "deny"]).has(
        d.decision
      );
      const pendingMatches = pendingApprovalMatches(
        state,
        d,
        "tool_authorization"
      );
      const trustedAuto =
        d.auto === true &&
        d.decision_source === "session_permission_lease" &&
        !state.approval &&
        approvalEventCorrelationMatches(state, d, "tool_authorization");
      if ((!pendingMatches && !trustedAuto) || !validDecision) {
        return ignored(
          state,
          `ignored mismatched approval.resolved ${d.id || "<missing>"}`
        );
      }
      const id = trustedAuto ? d.id : state.approval.id;
      if (state.settledApprovals?.[id]) return state;
      return {
        ...state,
        approval: trustedAuto ? state.approval : null,
        settledApprovals: {
          ...(state.settledApprovals || {}),
          [id]: "resolved",
        },
        status: trustedAuto ? state.status : state.task ? "running" : "idle",
      };
    }
    case EVENTS.APPROVAL_ACCEPTED:
    case EVENTS.APPROVAL_REJECTED: {
      if (taskIsTerminal(state.task)) {
        return ignored(
          state,
          `ignored ${ev.type} after terminal ${state.task.status}`
        );
      }
      const accepted = ev.type === EVENTS.APPROVAL_ACCEPTED;
      const pendingMatches = pendingApprovalMatches(
        state,
        d,
        "deliverable_acceptance"
      );
      const trustedAuto =
        accepted &&
        d.auto === true &&
        !state.approval &&
        approvalEventCorrelationMatches(state, d, "deliverable_acceptance");
      if (!pendingMatches && !trustedAuto) {
        return ignored(
          state,
          `ignored mismatched ${ev.type} ${d.id || "<missing>"}`
        );
      }
      const id = d.id || state.approval?.id;
      if (state.settledApprovals?.[id]) return state;
      return {
        ...state,
        approval: null,
        settledApprovals: {
          ...(state.settledApprovals || {}),
          [id]: accepted ? "accepted" : "rejected",
        },
        acceptedCount: (state.acceptedCount || 0) + (accepted ? 1 : 0),
        status: state.task ? "running" : "idle",
        timeline: push(
          state.timeline,
          idFor(state, d),
          accepted ? SYM.ok : SYM.warn,
          accepted ? "交付已验收" : "交付已拒绝",
          id
        ),
      };
    }
    case EVENTS.ASSISTANT_MESSAGE: {
      const guarded = streamEventGuard(state, d, EVENTS.ASSISTANT_MESSAGE);
      if (guarded !== null) return guarded;
      return withEventSeq(
        {
          ...state,
          answer: state.answer + (typeof d.text === "string" ? d.text : ""),
        },
        d
      );
    }
    case EVENTS.ASSISTANT_RENDERING_PREVIEW:
    case EVENTS.ASSISTANT_RENDERED: {
      const guarded = streamEventGuard(state, d, ev.type);
      if (guarded !== null) return guarded;
      const rendered = {
        partId: d.part_id || null,
        turnId: d.turn_id || null,
        ansiLines: Array.isArray(d.ansi_lines) ? d.ansi_lines : [],
      };
      const renderedParts = d.part_id
        ? state.renderedParts.some(part => part.partId === d.part_id)
          ? state.renderedParts.map(part =>
              part.partId === d.part_id ? rendered : part
            )
          : [...state.renderedParts, rendered]
        : state.renderedParts;
      return withEventSeq(
        {
          ...state,
          renderedAnswer: {
            turnId: d.turn_id || null,
            ansiLines: Array.isArray(d.ansi_lines) ? d.ansi_lines : [],
          },
          renderedParts,
        },
        d
      );
    }
    case EVENTS.COMMAND_OUTPUT: {
      const base =
        d.clear === true
          ? {
              ...state,
              task: null,
              taskStreamTerminal: false,
              plan: null,
              timeline: [],
              answer: "",
              renderedAnswer: null,
              thinking: "",
              pendingActions: [],
              status: "idle",
            }
          : state;
      return {
        ...base,
        commandOutput: {
          command: d.command || "",
          text: d.text || "",
          ansiLines: Array.isArray(d.ansi_lines) ? d.ansi_lines : [],
          clear: d.clear === true,
        },
      };
    }
    case EVENTS.TOKEN_DELTA: {
      const guarded = streamEventGuard(state, d, EVENTS.TOKEN_DELTA);
      if (guarded !== null) return guarded;
      return withEventSeq(
        {
          ...state,
          answer: state.answer + (d.text || ""),
          status: state.status === "idle" ? "running" : state.status,
        },
        d
      );
    }
    case EVENTS.THINKING_DELTA: {
      const guarded = streamEventGuard(state, d, EVENTS.THINKING_DELTA);
      if (guarded !== null) return guarded;
      return withEventSeq(
        {
          ...state,
          thinking: state.thinking + (typeof d.text === "string" ? d.text : ""),
          status: state.status === "idle" ? "running" : state.status,
        },
        d
      );
    }
    case EVENTS.TOKEN_USAGE:
      return {
        ...state,
        usage: {
          promptTok: state.usage.promptTok + (d.prompt || 0),
          completionTok: state.usage.completionTok + (d.completion || 0),
        },
      };
    case EVENTS.TASK_COMPLETED: {
      const guarded = terminalGuard(state, d, "done", EVENTS.TASK_COMPLETED);
      if (guarded !== null) return guarded;
      if (isChatMode(state.mode)) {
        // Chat response is the result itself. Match Ratatui: settle to idle without an extra
        // formal-task completion row or an artifact gate.
        return {
          ...state,
          task: {
            ...state.task,
            status: "done",
            terminalType: EVENTS.TASK_COMPLETED,
          },
          taskStreamTerminal: true,
          approval: null,
          status: "idle",
        };
      }
      if (!currentTaskHasArtifact(state)) {
        if (state.task.status === "needs_artifact") return state;
        return {
          ...state,
          task: {
            ...state.task,
            status: "needs_artifact",
          },
          taskStreamTerminal: true,
          approval: null,
          status: "needs_artifact",
          timeline: push(
            state.timeline,
            idFor(state, d),
            SYM.warn,
            "缺少交付物",
            "正式任务不能在没有当前任务 artifact 的情况下 Done"
          ),
        };
      }
      if (!state.proof || state.proof.valid !== true) {
        const unknown = !state.proof || state.proof.valid === null;
        const nextStatus = unknown ? "outcome_unknown" : "needs_revision";
        if (state.task.status === nextStatus) return state;
        return {
          ...state,
          task: {
            ...state.task,
            status: nextStatus,
          },
          taskStreamTerminal: true,
          approval: null,
          status: nextStatus,
          timeline: push(
            state.timeline,
            idFor(state, d),
            SYM.warn,
            unknown ? "验收结果未知" : "验收未通过",
            "正式任务只有 outcome.checked valid=true 才能 Done"
          ),
        };
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: "done",
          terminalType: EVENTS.TASK_COMPLETED,
        },
        taskStreamTerminal: true,
        approval: null,
        status: "done",
        timeline: push(state.timeline, idFor(state, d), SYM.ok, "完成"),
      };
    }
    case EVENTS.TASK_REJECTED: {
      const guarded = terminalGuard(state, d, "rejected", EVENTS.TASK_REJECTED);
      if (guarded !== null) return guarded;
      if (isFormalTask(state) && !isNonEmptyString(d.reason)) {
        return ignored(state, "ignored task.rejected without canonical reason");
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: "rejected",
          terminalType: EVENTS.TASK_REJECTED,
        },
        taskStreamTerminal: true,
        approval: null,
        status: "rejected",
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.fail,
          `打回：${d.reason || ""}`
        ),
      };
    }
    case EVENTS.TASK_BLOCKED: {
      const guarded = terminalGuard(state, d, "blocked", EVENTS.TASK_BLOCKED);
      if (guarded !== null) return guarded;
      if (isFormalTask(state) && !isNonEmptyString(d.reason)) {
        return ignored(state, "ignored task.blocked without canonical reason");
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: "blocked",
          terminalType: EVENTS.TASK_BLOCKED,
        },
        taskStreamTerminal: true,
        approval: null,
        status: "blocked",
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.warn,
          "任务阻塞",
          d.reason
        ),
      };
    }
    case EVENTS.TASK_FAILED: {
      const guarded = terminalGuard(state, d, "failed", EVENTS.TASK_FAILED);
      if (guarded !== null) return guarded;
      if (isFormalTask(state) && !isNonEmptyString(d.reason)) {
        return ignored(state, "ignored task.failed without canonical reason");
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: "failed",
          terminalType: EVENTS.TASK_FAILED,
        },
        taskStreamTerminal: true,
        approval: null,
        status: "failed",
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.fail,
          "任务失败",
          d.reason
        ),
      };
    }
    case EVENTS.TASK_REVISION_NEEDED: {
      const guarded = terminalGuard(
        state,
        d,
        "needs_revision",
        EVENTS.TASK_REVISION_NEEDED
      );
      if (guarded !== null) return guarded;
      if (isFormalTask(state) && !isNonEmptyString(d.reason)) {
        return ignored(
          state,
          "ignored task.revision_needed without canonical reason"
        );
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: "needs_revision",
          terminalType: EVENTS.TASK_REVISION_NEEDED,
        },
        taskStreamTerminal: true,
        approval: null,
        status: "needs_revision",
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.warn,
          "需要修订",
          d.reason
        ),
      };
    }
    // v0.6 — chat-to-workbench hardening
    case EVENTS.TASK_UPGRADED_FROM_CHAT:
      if (!state.task || !taskCorrelationMatches(state, d, "taskRunId")) {
        return ignored(
          state,
          `ignored stale or uncorrelated task.upgraded_from_chat for ${d.taskRunId || "<missing>"}`
        );
      }
      return {
        ...state,
        mode: "chat-upgraded",
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          "↑ 从对话升级为 TaskRun",
          d.reason
        ),
      };
    case EVENTS.SKILL_LAUNCHED:
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.running,
          `启动技能：${d.skill || d.name || ""}`
        ),
      };
    case EVENTS.TOOL_PREFLIGHT_CHECKED:
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          d.ok === false ? SYM.warn : SYM.ok,
          `预检：${d.label || ""}`,
          d.detail
        ),
      };
    case EVENTS.SOURCE_CHECKED:
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          d.ok === false ? SYM.warn : SYM.ok,
          `核对来源：${d.source || ""}`,
          d.detail
        ),
      };
    case EVENTS.BUDGET_WARNING:
      return {
        ...state,
        budgetWarning: {
          level: d.level,
          spent: d.spent,
          cap: d.cap,
          month: d.month,
        },
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.warn,
          d.level === "block" ? "预算已达上限" : "预算告警",
          `${d.spent ?? "?"}/${d.cap ?? "?"}`
        ),
      };
    case EVENTS.PENDING_ACTIONS:
      return { ...state, pendingActions: d.actions || [] };
    case EVENTS.QUICK_UTILITY:
      return {
        ...state,
        quickUtility: {
          intent: d.intent,
          result: d.result,
          source: d.source,
          status: d.status,
        },
      };
    case EVENTS.MEMORY_STATE:
      return { ...state, memory: { ...state.memory, ...(d.memory || {}) } };
    case EVENTS.MEMORY_REQUESTED:
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.wait,
          `记忆请求：${d.summary || ""}`
        ),
      };
    case EVENTS.MEMORY_SAVED:
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          SYM.ok,
          `记忆已存：${d.summary || ""}`,
          d.scope
        ),
      };
    case EVENTS.WORKSPACE_REVEALED: {
      const opened =
        d.ok === true || (d.ok === undefined && d.available === true);
      return {
        ...state,
        timeline: push(
          state.timeline,
          idFor(state, d),
          opened ? SYM.ok : SYM.warn,
          opened ? "打开位置" : "无法打开,路径已给",
          d.path
        ),
      };
    }
    case EVENTS.OUTCOME_CHECKED: {
      if (!state.task || !taskCorrelationMatches(state, d, "taskRunId")) {
        return ignored(
          state,
          `ignored uncorrelated outcome.checked for ${d.taskRunId || "<missing>"}`
        );
      }
      if (taskIsTerminal(state.task)) {
        return ignored(
          state,
          `ignored outcome.checked after terminal ${state.task.status}`
        );
      }
      if (
        d.valid === true &&
        !state.artifacts.some(
          artifact =>
            artifact.taskId === state.task.id &&
            artifact.status !== "deleted" &&
            artifact.path === d.deliverable
        )
      ) {
        return ignored(
          state,
          "ignored valid outcome.checked without a matching current-task artifact"
        );
      }
      // Tri-state by design: a missing `valid` key is protocol drift, never an
      // implicit success.  Keep both the nullable boolean and named status so
      // existing consumers remain compatible while new consumers can be explicit.
      const verdict =
        d.valid === true ? "valid" : d.valid === false ? "invalid" : "unknown";
      const valid =
        verdict === "valid" ? true : verdict === "invalid" ? false : null;
      const label =
        verdict === "valid"
          ? "验收：可交付"
          : verdict === "invalid"
            ? "验收：未达标"
            : "验收：结果未知（事件缺 valid 字段）";
      return {
        ...state,
        proof: {
          status: verdict,
          valid,
          deliverable: d.deliverable || null,
          gaps: d.gaps || d.missing || [],
          reason: d.reason || "",
        },
        timeline: push(
          state.timeline,
          idFor(state, d),
          verdict === "valid" ? SYM.ok : SYM.warn,
          label,
          d.reason || d.deliverable
        ),
      };
    }
    case EVENTS.DREAM_MORNING_REPORT:
      return { ...state, dreamMorningReport: { ...d } };
    case EVENTS.DREAM_RECOMMENDED:
    case EVENTS.DREAM_STARTED:
    case EVENTS.DREAM_CANDIDATE_READY:
    case EVENTS.DREAM_VALIDATION_FAILED:
    case EVENTS.DREAM_BLOCKED:
    case EVENTS.DREAM_APPROVED:
    case EVENTS.DREAM_REJECTED:
    case EVENTS.DREAM_ACTIVATED:
    case EVENTS.DREAM_ROLLED_BACK:
      return {
        ...state,
        dream: { type: ev.type, ...d },
        timeline: push(
          state.timeline,
          d.dream_id || idFor(state, d),
          new Set([
            EVENTS.DREAM_VALIDATION_FAILED,
            EVENTS.DREAM_BLOCKED,
            EVENTS.DREAM_REJECTED,
          ]).has(ev.type)
            ? SYM.warn
            : SYM.ok,
          ev.type,
          d.reason ||
            (Array.isArray(d.trigger_reasons)
              ? d.trigger_reasons.join(", ")
              : "")
        ),
      };
    case EVENTS.DEBUG_LINE:
      return typeof d.line === "string" || typeof d.message === "string"
        ? { ...state, debug: [...state.debug, d.line || d.message] }
        : state;
    default:
      // Unknown same-version events are additive by contract. Older consumers intentionally
      // preserve their current state; every known EVENTS member has an explicit case above.
      return state;
  }
}

// Fold a whole event list (e.g. a replayed run.jsonl) — handy for tests + session restore.
export function reduceAll(events, meta = {}) {
  return (events || []).reduce(reduce, initialAppState(meta));
}
