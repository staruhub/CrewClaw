// tui/workbench-store.mjs — the chat's TaskRun-centric store (replaces the message-parts
// store). Each user turn spawns a TaskRun (event-bridge → AppState); committed turns become
// a snapshot list, the in-flight turn is the live AppState. Session token usage accumulates
// across turns. External store (useSyncExternalStore-friendly) so React stays a dumb view.
import { createTaskRun } from "./event-bridge.mjs";

export function createWorkbenchStore(meta = {}, initialTurns = []) {
  let state = {
    turns: initialTurns, // [{ role:'user', text } | { role:'assistant', app: AppStateSnapshot, errored? }]
    live: null,  // live AppState | null
    sessionUsage: { promptTok: 0, completionTok: 0 },
    status: "idle",
  };
  let currentRun = null;
  const subs = new Set();
  const emit = () => { for (const fn of subs) fn(state); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  const commit = (errored) => {
    if (!currentRun) { set({ status: errored ? "error" : "idle" }); return; }
    const app = currentRun.get();
    const sessionUsage = {
      promptTok: state.sessionUsage.promptTok + (app.usage?.promptTok || 0),
      completionTok: state.sessionUsage.completionTok + (app.usage?.completionTok || 0),
    };
    currentRun = null;
    set({ turns: [...state.turns, { role: "assistant", app, errored: !!errored }], live: null, sessionUsage, status: errored ? "error" : "idle" });
  };

  return {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    pushUser(text) { set({ turns: [...state.turns, { role: "user", text }] }); },
    // start a turn → returns a TaskRun whose `.sink` you hand straight to runTurn(text, sink)
    startTurn(info = {}) {
      const run = createTaskRun(meta, (app) => set({ live: app, status: app.status }));
      currentRun = run;
      run.start(info.title || "", info.mode || meta.mode);
      return run;
    },
    commitTurn() { commit(false); },
    failTurn(reason) { if (currentRun) currentRun.reject(reason); commit(true); },
    // L2 approval: the input handler routes a/d here → resolves the awaiting agentLoop confirm()
    resolveApproval(decision) { return !!(currentRun && currentRun.resolveApproval(decision)); },
    awaitingApproval() { return !!(currentRun && currentRun.awaitingApproval()); },
  };
}
