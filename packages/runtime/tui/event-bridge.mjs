// tui/event-bridge.mjs — the wire between the engine (agentLoop) and the Workbench core.
// agentLoop only knows its sink callbacks (onDelta/onInvocation/onUsage/confirm); this bridge
// TRANSLATES them into TaskEvents and folds them into a live AppState via the reducer. The
// engine stays ignorant of AppState; renderers read state slices, never the model's raw text.
//
// (Until agentLoop gains a pre-execution callback, onInvocation — which fires AFTER a tool
// runs — is expanded into a request→result pair so the tool still lands as one timeline line.)
import { EVENTS, makeEvent } from "./protocol.mjs";
import { reduce, initialAppState } from "./app-state.mjs";
import { randomUUID } from "node:crypto";

export function createTaskRun(meta = {}, onChange = () => {}) {
  let state = initialAppState(meta);
  let seq = 0,
    toolSeq = 0,
    turnSeq = 0,
    apprSeq = 0;
  let currentTaskRunId = null;
  let currentTurnId = null;
  let currentGenerationId = null;
  let generationActive = false;
  let pendingApproval = null; // { id, taskRunId, resolve } while agentLoop awaits confirmation
  const abortController = new AbortController();
  const activeToolLifecycles = new Map();
  const terminalToolLifecycles = new Set();
  const seenToolLifecycles = new Set();
  const apply = (type, data = {}) => {
    const eventSeq = ++seq;
    const correlated =
      currentTaskRunId && type !== EVENTS.SESSION_READY
        ? {
            ...data,
            taskRunId: data.taskRunId || currentTaskRunId,
            ...(currentTurnId
              ? { turn_id: data.turn_id || currentTurnId }
              : {}),
            seq: Number.isSafeInteger(data.seq) ? data.seq : eventSeq,
          }
        : data;
    state = reduce(state, makeEvent(type, correlated, Date.now()));
    onChange(state);
  };

  const cancelActiveToolLifecycles = reason => {
    for (const [id, common] of activeToolLifecycles) {
      if (terminalToolLifecycles.has(id)) continue;
      terminalToolLifecycles.add(id);
      apply(EVENTS.TOOL_CANCELLED, {
        ...common,
        id,
        summary: "工具已取消",
        code: "generation_cancelled",
        detail: String(reason || "generation cancelled"),
      });
    }
    activeToolLifecycles.clear();
  };

  const finishGeneration = (type, extra = {}) => {
    if (!generationActive) return false;
    if (activeToolLifecycles.size)
      cancelActiveToolLifecycles(extra.reason || "generation closed");
    apply(type, { id: currentGenerationId, ...extra });
    generationActive = false;
    return true;
  };

  // L2 approval (§14.3): agentLoop calls confirm(msg) before a sensitive tool and AWAITS a
  // boolean. We surface it as an APPROVAL_REQUIRED event (the renderer shows a modal) and
  // resolve the promise when the user picks allow/deny — a real human gate, not auto-yes.
  const requestApproval = (msg, info = {}) => {
    if (!generationActive || abortController.signal.aborted) {
      return Promise.resolve(false);
    }
    const id = "appr" + ++apprSeq;
    apply(EVENTS.APPROVAL_REQUIRED, {
      id,
      kind: "tool_authorization",
      tool: info.tool || info.toolName,
      reason: typeof msg === "string" ? msg : info.reason,
      scope: info.scope,
    });
    return new Promise(resolve => {
      pendingApproval = { id, taskRunId: currentTaskRunId, resolve };
    });
  };
  const resolveApproval = decision => {
    if (!pendingApproval) return false;
    const allow =
      decision === true ||
      decision === "allow" ||
      decision === "a" ||
      decision === "y";
    const p = pendingApproval;
    pendingApproval = null;
    apply(EVENTS.APPROVAL_RESOLVED, {
      id: p.id,
      taskRunId: p.taskRunId,
      kind: "tool_authorization",
      decision: allow ? "allow" : "deny",
    });
    p.resolve(allow);
    return true;
  };

  const onToolEvent = (toolEvent = {}) => {
    if (!generationActive) return;
    const id = toolEvent.id || `tool${++toolSeq}`;
    const tool = toolEvent.toolName || toolEvent.tool || "unknown";
    const phase = toolEvent.phase;
    const common = {
      id,
      tool,
      args: toolEvent.args || {},
      label: toolEvent.action || toolEvent.summary || tool,
      decision: toolEvent.decision?.decision,
      decision_source: toolEvent.decision?.decision_source,
      permission_level: toolEvent.decision?.level,
    };
    if (phase === "requested" || phase === "running") {
      if (terminalToolLifecycles.has(id)) return;
      const current = activeToolLifecycles.get(id)?.phase;
      if (current === "running" || current === phase) return;
      seenToolLifecycles.add(id);
      activeToolLifecycles.set(id, { phase, ...common });
      apply(
        phase === "requested" ? EVENTS.TOOL_REQUESTED : EVENTS.TOOL_RUNNING,
        common
      );
      return;
    }
    const terminalType = {
      succeeded: EVENTS.TOOL_SUCCEEDED,
      failed: EVENTS.TOOL_FAILED,
      blocked: EVENTS.TOOL_BLOCKED,
      cancelled: EVENTS.TOOL_CANCELLED,
    }[phase];
    if (!terminalType || terminalToolLifecycles.has(id)) return;
    terminalToolLifecycles.add(id);
    activeToolLifecycles.delete(id);
    seenToolLifecycles.add(id);
    apply(terminalType, {
      ...common,
      summary: toolEvent.summary || toolEvent.action || tool,
      code: toolEvent.code,
      detail: String(
        toolEvent.detail ?? toolEvent.output ?? toolEvent.error ?? ""
      ).slice(0, 4096),
    });
  };

  const taskTerminalEvents = new Set([
    EVENTS.TASK_COMPLETED,
    EVENTS.TASK_REJECTED,
    EVENTS.TASK_BLOCKED,
    EVENTS.TASK_FAILED,
    EVENTS.TASK_REVISION_NEEDED,
  ]);
  const emitRaw = (type, data = {}) => {
    const eventTaskId = data.taskRunId || data.id;
    if (
      taskTerminalEvents.has(type) &&
      (!eventTaskId || eventTaskId === currentTaskRunId)
    ) {
      const failed =
        type === EVENTS.TASK_FAILED ||
        (type === EVENTS.TASK_REJECTED && data.status === "failed");
      finishGeneration(
        failed ? EVENTS.GENERATION_FAILED : EVENTS.GENERATION_COMPLETED,
        failed ? { reason: data.reason || "task failed" } : {}
      );
    }
    apply(type, data);
  };

  return {
    get: () => state,
    get signal() {
      return abortController.signal;
    },
    isCancelled: () => abortController.signal.aborted,
    emit: emitRaw, // raw event (plan/evidence/artifact the sink doesn't cover)
    start: (title = "", mode) => {
      turnSeq += 1;
      currentTaskRunId = `task-${randomUUID()}`;
      currentTurnId = `turn-${turnSeq}-${randomUUID()}`;
      currentGenerationId = `${currentTurnId}-generation`;
      generationActive = true;
      apply(EVENTS.TASK_STARTED, {
        id: currentTaskRunId,
        taskRunId: currentTaskRunId,
        title,
        mode,
      });
      apply(EVENTS.GENERATION_STARTED, { id: currentGenerationId });
    },
    finishGeneration: (type = EVENTS.GENERATION_COMPLETED, extra = {}) =>
      finishGeneration(type, extra),
    settle: ({ awaitingAcceptance = false, artifact = null } = {}) => {
      finishGeneration(EVENTS.GENERATION_COMPLETED);
      if (state.taskStreamTerminal) return false;
      if (awaitingAcceptance) {
        apply(EVENTS.APPROVAL_REQUESTED, {
          id: `delivery-${currentTaskRunId}`,
          kind: "deliverable_acceptance",
          artifacts: artifact?.artifact_id ? [artifact.artifact_id] : [],
        });
      } else {
        apply(EVENTS.TASK_COMPLETED, { id: currentTaskRunId });
      }
      return true;
    },
    complete: () => {
      finishGeneration(EVENTS.GENERATION_COMPLETED);
      apply(EVENTS.TASK_COMPLETED, { id: currentTaskRunId });
    },
    fail: reason => {
      finishGeneration(EVENTS.GENERATION_FAILED, { reason });
      apply(EVENTS.TASK_FAILED, { id: currentTaskRunId, reason });
    },
    reject: reason => {
      finishGeneration(EVENTS.GENERATION_COMPLETED);
      apply(EVENTS.TASK_REJECTED, { id: currentTaskRunId, reason });
    },
    cancel: (reason = "用户取消生成") => {
      if (!generationActive && abortController.signal.aborted) return false;
      if (!abortController.signal.aborted) abortController.abort(reason);
      if (pendingApproval) resolveApproval("deny");
      finishGeneration(EVENTS.GENERATION_CANCELLED, { reason });
      apply(EVENTS.TASK_BLOCKED, { id: currentTaskRunId, reason });
      return true;
    },
    requestApproval,
    resolveApproval,
    awaitingApproval: () => !!pendingApproval,

    // pass `.sink` as agentLoop's { onDelta, onInvocation, onUsage, confirm }
    sink: {
      get signal() {
        return abortController.signal;
      },
      onDelta: text => {
        if (generationActive && text) apply(EVENTS.TOKEN_DELTA, { text });
      },
      onThinking: text => {
        if (generationActive && text) apply(EVENTS.THINKING_DELTA, { text });
      },
      onToolEvent,
      onInvocation: (inv = {}) => {
        const knownId = inv.call_id || inv.id;
        if (knownId && seenToolLifecycles.has(knownId)) return;
        const id = knownId || `tool${++toolSeq}`;
        const requested = {
          id,
          toolName: inv.toolName || inv.tool_name || "unknown",
          args: inv.args || {},
          phase: "requested",
          action: inv.line || inv.action || inv.toolName,
        };
        onToolEvent(requested);
        onToolEvent({
          ...requested,
          phase:
            inv.status === "blocked"
              ? "blocked"
              : inv.status === "error"
                ? "failed"
                : inv.status === "cancelled"
                  ? "cancelled"
                  : "succeeded",
          action: inv.action,
          code: inv.code,
        });
      },
      onUsage: u => {
        if (u && generationActive)
          apply(EVENTS.TOKEN_USAGE, {
            prompt: u.prompt_tokens,
            completion: u.completion_tokens,
          });
      },
      confirm: (msg, info) => requestApproval(msg, info), // agentLoop's human gate → APPROVAL_REQUIRED
    },
  };
}
