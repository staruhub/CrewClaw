// tui/jsonl-bridge.mjs — headless event mode: the engine (this Node process) emits TaskEvents
// as JSONL to stdout and reads user input lines from stdin. A Rust/Ratatui (or any) front-end
// reduces the JSONL into AppState and renders. This is the "RatatuiRenderer" backend — the
// renderer-agnostic protocol carried over a process boundary (exactly what the protocol's
// serializable { type, ts, data } shape was built for).
//
// Wire format: one JSON object per line, e.g.
//   {"type":"task.started","ts":1719,"data":{"id":"turn1","title":"...","mode":"Chat"}}
//   {"type":"token.delta","ts":1719,"data":{"text":"…"}}
//   {"type":"tool.succeeded","ts":1719,"data":{"id":"tool1","summary":"🌐 wttr.in (412 字)"}}
import { createInterface } from "node:readline";
import { makeEvent, EVENTS } from "./protocol.mjs";
import { buildRunTurn } from "./repl.mjs";

export async function startJsonlBridge({ agentLoop, agentLoopDeps, agentName = "鲸", meta = {}, history = [], saveSession }) {
  const emit = (type, data) => process.stdout.write(JSON.stringify(makeEvent(type, data, Date.now())) + "\n");

  // a header event so the front-end can paint the badge + tool/memory truth immediately
  emit("session.ready", { employee: { name: agentName, role: meta.role, mode: meta.mode, model: meta.model } });

  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession });
  let turnSeq = 0, toolSeq = 0;
  const sink = {
    onDelta: (text) => emit(EVENTS.TOKEN_DELTA, { text }),
    onInvocation: (inv = {}) => {
      const id = "tool" + ++toolSeq;
      emit(EVENTS.TOOL_REQUESTED, { id, tool: inv.toolName, label: inv.line || inv.action || inv.toolName });
      const failed = inv.status === "blocked" || inv.status === "error";
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, { id, summary: inv.action, code: failed ? (inv.code || inv.action) : undefined });
    },
    onUsage: (u) => { if (u) emit(EVENTS.TOKEN_USAGE, { prompt: u.prompt_tokens, completion: u.completion_tokens }); },
  };

  const rl = createInterface({ input: process.stdin });
  for await (const raw of rl) {
    const text = String(raw).trim();
    if (!text) continue;
    if (text === "/exit" || text === ":q") break;
    emit(EVENTS.TASK_STARTED, { id: "turn" + ++turnSeq, title: text, mode: meta.mode });
    try {
      await runTurn(text, sink);
      emit(EVENTS.TASK_COMPLETED, {});
    } catch (e) {
      emit(EVENTS.TASK_REJECTED, { reason: String((e && e.message) || e) });
    }
  }
  rl.close();
}
