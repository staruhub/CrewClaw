// tui/repl.mjs — bridges the Ink chat UI to the raw runtime's agentLoop WITHOUT importing
// run.mjs (run.mjs injects agentLoop + its deps). This turns one user turn into an
// agentLoop call that streams into the store via a sink, instead of agentLoop writing to
// stdout. Kept out of run.mjs so the integration logic is unit-testable with a fake loop.
//
// CONTRACT agentLoop must honor in Ink mode: accept onDelta(text), onInvocation(inv),
// onUsage(u) and, when given them (renderMd:false), NOT draw to stdout itself.
import { mountChat } from "./chat.mjs";

// Map the model `history` (assistant/tool/user with tool_calls) to display messages for
// the initial scrollback when resuming a saved session.
export function historyToMessages(history) {
  const out = [];
  for (const m of history || []) {
    if (m.role === "user") {
      out.push({ role: "user", text: typeof m.content === "string" ? m.content : "（含附件）" });
    } else if (m.role === "assistant" && m.content && !m.tool_calls) {
      out.push({ role: "assistant", parts: [{ type: "text", text: m.content }] });
    }
  }
  return out;
}

// Build the per-turn runner. Pushes the user message to history, runs agentLoop streaming
// into the sink, persists. Pure (no Ink) → unit-testable.
export function buildRunTurn({ agentLoop, agentLoopDeps = {}, history, saveSession }) {
  return async function runTurn(text, sink) {
    history.push({ role: "user", content: text });
    await agentLoop({
      ...agentLoopDeps,
      messages: history,
      renderMd: false,            // Ink owns the screen — agentLoop must not write stdout
      onDelta: sink.onDelta,      // stream text to the store, not the internal md printer
      onInvocation: sink.onInvocation,
      onUsage: sink.onUsage,
    });
    if (saveSession) saveSession();
  };
}

// Mount the Ink chat and return a promise that resolves when the user exits.
export function startInkChat({ agentLoop, agentLoopDeps, history = [], agentName, renderLines, saveSession, meta }) {
  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession });
  const app = mountChat({ runTurn, agentName, renderLines, initialMessages: historyToMessages(history), meta });
  return app.waitUntilExit();
}
