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
      confirm: sink.confirm || agentLoopDeps.confirm, // L2 approval → the workbench modal (not auto-yes)
    });
    if (saveSession) saveSession();
    return output;                // the final answer — the Router persists it as an artifact
  };
}

// A LIGHT turn for quick utilities (§10.2): a generic minimal system + just the one question —
// NOT the employee's full soul/skills/memory/history. Keeps trivia (天气/时间/换算) cheap and off
// the employee's professional context, so it never counts as — or costs like — real employee work.
export function buildQuickUtilityTurn({ agentLoop, agentLoopDeps = {} }) {
  const LIGHT_SYSTEM = "你是一个通用快捷助手。请简短、直接地回答用户这一个快捷问题(天气/时间/单位换算等),不要展开,也不要使用任何员工的专业身份或长期上下文。";
  return async function runQuickUtility(text, sink) {
    return agentLoop({
      ...agentLoopDeps,
      system: LIGHT_SYSTEM,                          // strip the employee's full system prompt
      messages: [{ role: "user", content: text }],   // fresh, minimal context (no chat history)
      renderMd: false,
      onDelta: sink.onDelta,
      onInvocation: sink.onInvocation,
      onUsage: sink.onUsage,
      confirm: sink.confirm || agentLoopDeps.confirm,
    });
  };
}

// Mount the Ink chat and return a promise that resolves when the user exits.
export function startInkChat({ agentLoop, agentLoopDeps, history = [], agentName, renderLines, saveSession, meta }) {
  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession });
  const runQuickUtility = buildQuickUtilityTurn({ agentLoop, agentLoopDeps });
  const app = mountChat({ runTurn, runQuickUtility, agentName, renderLines, initialTurns: historyToTurns(history), meta });
  return app.waitUntilExit();
}
