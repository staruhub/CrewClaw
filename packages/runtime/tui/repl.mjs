// tui/repl.mjs — bridges the Ink chat UI to the raw runtime's agentLoop WITHOUT importing
// run.mjs (run.mjs injects agentLoop + its deps). This turns one user turn into an
// agentLoop call that streams into the store via a sink, instead of agentLoop writing to
// stdout. Kept out of run.mjs so the integration logic is unit-testable with a fake loop.
//
// CONTRACT agentLoop must honor in Ink mode: accept onDelta(text), onInvocation(inv),
// onUsage(u) and, when given them (renderMd:false), NOT draw to stdout itself.
import { mountChat } from "./chat.mjs";
export {
  buildQuickUtilityTurn,
  buildRunTurn,
  historyToTurns,
} from "./turn-runner.mjs";
import {
  buildQuickUtilityTurn,
  buildRunTurn,
  historyToTurns,
} from "./turn-runner.mjs";

// Mount the Ink chat and return a promise that resolves when the user exits.
export function startInkChat({
  agentLoop,
  agentLoopDeps,
  history = [],
  agentName,
  renderLines,
  saveSession,
  meta,
}) {
  const runTurn = buildRunTurn({
    agentLoop,
    agentLoopDeps,
    history,
    saveSession,
  });
  const runQuickUtility = buildQuickUtilityTurn({ agentLoop, agentLoopDeps });
  const app = mountChat({
    runTurn,
    runQuickUtility,
    agentName,
    renderLines,
    initialTurns: historyToTurns(history),
    meta,
  });
  return app.waitUntilExit();
}
