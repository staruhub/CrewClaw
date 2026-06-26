// tui/event-bridge.mjs — the wire between the engine (agentLoop) and the Workbench core.
// agentLoop only knows its sink callbacks (onDelta/onInvocation/onUsage); this bridge
// TRANSLATES them into TaskEvents and folds them into a live AppState via the reducer. The
// engine stays ignorant of AppState; renderers read state slices, never the model's raw text.
//
// (Until agentLoop gains a pre-execution callback, onInvocation — which fires AFTER a tool
// runs — is expanded into a request→result pair so the tool still lands as one timeline line.)
import { EVENTS, makeEvent } from "./protocol.mjs";
import { reduce, initialAppState } from "./app-state.mjs";

export function createTaskRun(meta = {}, onChange = () => {}) {
  let state = initialAppState(meta);
  let seq = 0, toolSeq = 0, turnSeq = 0;
  const apply = (type, data) => { state = reduce(state, makeEvent(type, data, ++seq)); onChange(state); };

  return {
    get: () => state,
    start: (title = "", mode) => apply(EVENTS.TASK_STARTED, { id: "turn" + ++turnSeq, title, mode }),
    complete: () => apply(EVENTS.TASK_COMPLETED, {}),
    reject: (reason) => apply(EVENTS.TASK_REJECTED, { reason }),

    // pass `.sink` as agentLoop's { onDelta, onInvocation, onUsage }
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
    },
  };
}
