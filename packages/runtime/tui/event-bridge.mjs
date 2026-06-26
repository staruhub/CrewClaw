// tui/event-bridge.mjs — the wire between the engine (agentLoop) and the Workbench core.
// agentLoop only knows its sink callbacks (onDelta/onInvocation/onUsage/confirm); this bridge
// TRANSLATES them into TaskEvents and folds them into a live AppState via the reducer. The
// engine stays ignorant of AppState; renderers read state slices, never the model's raw text.
//
// (Until agentLoop gains a pre-execution callback, onInvocation — which fires AFTER a tool
// runs — is expanded into a request→result pair so the tool still lands as one timeline line.)
import { EVENTS, makeEvent } from "./protocol.mjs";
import { reduce, initialAppState } from "./app-state.mjs";

export function createTaskRun(meta = {}, onChange = () => {}) {
  let state = initialAppState(meta);
  let seq = 0, toolSeq = 0, turnSeq = 0, apprSeq = 0;
  let pendingApproval = null; // { resolve } — set while agentLoop awaits a confirm() decision
  const apply = (type, data) => { state = reduce(state, makeEvent(type, data, ++seq)); onChange(state); };

  // L2 approval (§14.3): agentLoop calls confirm(msg) before a sensitive tool and AWAITS a
  // boolean. We surface it as an APPROVAL_REQUIRED event (the renderer shows a modal) and
  // resolve the promise when the user picks allow/deny — a real human gate, not auto-yes.
  const requestApproval = (msg, info = {}) => {
    apply(EVENTS.APPROVAL_REQUIRED, {
      id: "appr" + ++apprSeq,
      tool: info.tool || info.toolName,
      reason: typeof msg === "string" ? msg : info.reason,
      scope: info.scope,
    });
    return new Promise((resolve) => { pendingApproval = { resolve }; });
  };
  const resolveApproval = (decision) => {
    if (!pendingApproval) return false;
    const allow = decision === true || decision === "allow" || decision === "a" || decision === "y";
    const p = pendingApproval; pendingApproval = null;
    apply(EVENTS.APPROVAL_RESOLVED, { decision: allow ? "allow" : "deny" });
    p.resolve(allow);
    return true;
  };

  return {
    get: () => state,
    emit: (type, data) => apply(type, data), // raw event (plan/evidence/artifact the sink doesn't cover)
    start: (title = "", mode) => apply(EVENTS.TASK_STARTED, { id: "turn" + ++turnSeq, title, mode }),
    complete: () => apply(EVENTS.TASK_COMPLETED, {}),
    reject: (reason) => apply(EVENTS.TASK_REJECTED, { reason }),
    requestApproval,
    resolveApproval,
    awaitingApproval: () => !!pendingApproval,

    // pass `.sink` as agentLoop's { onDelta, onInvocation, onUsage, confirm }
    sink: {
      onDelta: (text) => apply(EVENTS.TOKEN_DELTA, { text }),
      onInvocation: (inv = {}) => {
        const id = "tool" + ++toolSeq;
        apply(EVENTS.TOOL_REQUESTED, { id, tool: inv.toolName, label: inv.line || inv.action || inv.toolName });
        const failed = inv.status === "blocked" || inv.status === "error";
        if (failed) apply(EVENTS.TOOL_FAILED, { id, code: inv.code || inv.action });
        else apply(EVENTS.TOOL_SUCCEEDED, { id, summary: inv.action });
      },
      onUsage: (u) => { if (u) apply(EVENTS.TOKEN_USAGE, { prompt: u.prompt_tokens, completion: u.completion_tokens }); },
      confirm: (msg, info) => requestApproval(msg, info), // agentLoop's human gate → APPROVAL_REQUIRED
    },
  };
}
