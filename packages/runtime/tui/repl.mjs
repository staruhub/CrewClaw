// tui/repl.mjs — bridges the Ink chat UI to the raw runtime's agentLoop WITHOUT importing
// run.mjs (run.mjs injects agentLoop + its deps). This turns one user turn into an
// agentLoop call that streams into the store via a sink, instead of agentLoop writing to
// stdout. Kept out of run.mjs so the integration logic is unit-testable with a fake loop.
//
// CONTRACT agentLoop must honor in Ink mode: accept onDelta(text), onInvocation(inv),
// onUsage(u) and, when given them (renderMd:false), NOT draw to stdout itself.
import { mountChat } from "./chat.mjs";

// Map the model `history` to display TURNS for the initial scrollback when resuming a saved
// session. A resumed assistant turn has no event history, so it's a minimal AppState with
// just the answer (TurnView renders it).
export function historyToTurns(history) {
  const out = [];
  for (const m of history || []) {
    if (m.role === "user") {
      out.push({ role: "user", text: typeof m.content === "string" ? m.content : "（含附件）" });
    } else if (m.role === "assistant" && m.content && !m.tool_calls) {
      out.push({ role: "assistant", app: { timeline: [], answer: m.content, tools: {}, evidence: [], artifacts: [], usage: { promptTok: 0, completionTok: 0 }, status: "done" } });
    }
  }
  return out;
}

// Build the per-turn runner. Pushes the user message to history, runs agentLoop streaming
// into the sink, persists. Pure (no Ink) → unit-testable.
export function buildRunTurn({ agentLoop, agentLoopDeps = {}, history, saveSession }) {
  return async function runTurn(text, sink) {
    history.push({ role: "user", content: text });
    const output = await agentLoop({
      ...agentLoopDeps,
      messages: history,
      renderMd: false,            // Ink owns the screen — agentLoop must not write stdout
      onDelta: sink.onDelta,      // stream text to the store, not the internal md printer
      onInvocation: sink.onInvocation,
      onUsage: sink.onUsage,
    });
    if (saveSession) saveSession();
    return output;                // the final answer — the Router persists it as an artifact
  };
}

// Mount the Ink chat and return a promise that resolves when the user exits.
export function startInkChat({ agentLoop, agentLoopDeps, history = [], agentName, renderLines, saveSession, meta }) {
  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession });
  const app = mountChat({ runTurn, agentName, renderLines, initialTurns: historyToTurns(history), meta });
  return app.waitUntilExit();
}
