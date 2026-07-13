// tui/workbench-store.mjs — the chat's TaskRun-centric store (replaces the message-parts
// store). Each user turn spawns a TaskRun (event-bridge → AppState); committed turns become
// a snapshot list, the in-flight turn is the live AppState. Session token usage accumulates
// across turns. External store (useSyncExternalStore-friendly) so React stays a dumb view.
import { createTaskRun } from "./event-bridge.mjs";
import { EVENTS } from "./protocol.mjs";

const HELD_TERMINALS = new Set([
  EVENTS.TASK_COMPLETED,
  EVENTS.TASK_REJECTED,
  EVENTS.TASK_BLOCKED,
  EVENTS.TASK_FAILED,
  EVENTS.TASK_REVISION_NEEDED,
]);

export function createWorkbenchStore(meta = {}, initialTurns = []) {
  let state = {
    turns: initialTurns, // [{ role:'user', text } | { role:'assistant', app: AppStateSnapshot, errored? }]
    live: null, // live AppState | null
    sessionUsage: { promptTok: 0, completionTok: 0 },
    status: "idle",
    sessionPendingActions: [], // PendingActions from the last task — digit input matches these (§6.4)
  };
  let currentRun = null;
  const heldRuns = new Map();
  let sessionPendingTaskRunId = null;
  const subs = new Set();
  const emit = () => {
    for (const fn of subs) fn(state);
  };
  const set = patch => {
    state = { ...state, ...patch };
    emit();
  };

  const snapshotFor = app => {
    const approvalId =
      app.approval?.kind === "deliverable_acceptance" ? app.approval.id : null;
    const pendingActions = (app.pendingActions || []).map(action =>
      approvalId
        ? {
            ...action,
            taskRunId: action.taskRunId || app.task?.id,
            approvalId,
          }
        : action
    );
    return { ...app, pendingActions };
  };

  const updateHeldSnapshot = (run, app) => {
    const taskRunId = app.task?.id;
    if (!taskRunId || heldRuns.get(taskRunId) !== run) return;
    let found = false;
    const snapshot = snapshotFor(app);
    const turns = state.turns.map(turn => {
      if (turn.role !== "assistant" || turn.app?.task?.id !== taskRunId)
        return turn;
      found = true;
      return { ...turn, app: snapshot };
    });
    if (!found) return;
    set({
      turns,
      ...(sessionPendingTaskRunId === taskRunId
        ? { sessionPendingActions: snapshot.pendingActions }
        : {}),
    });
  };

  const commit = (outcome, expectedRun = currentRun) => {
    if (!currentRun || currentRun !== expectedRun) return false;
    const app = currentRun.get();
    const snapshot = snapshotFor(app);
    const taskRunId = app.task?.id;
    const heldForAcceptance =
      !!taskRunId &&
      app.approval?.kind === "deliverable_acceptance" &&
      !app.taskStreamTerminal;
    const sessionUsage = {
      promptTok: state.sessionUsage.promptTok + (app.usage?.promptTok || 0),
      completionTok:
        state.sessionUsage.completionTok + (app.usage?.completionTok || 0),
    };
    currentRun = null;
    set({
      turns: [
        ...state.turns,
        {
          role: "assistant",
          app: snapshot,
          errored: outcome === "error",
          cancelled: outcome === "cancelled",
        },
      ],
      live: null,
      sessionUsage,
      status: outcome === "error" ? "error" : "idle",
      sessionPendingActions: snapshot.pendingActions,
    });
    if (heldForAcceptance) {
      heldRuns.set(taskRunId, expectedRun);
      sessionPendingTaskRunId = taskRunId;
    } else {
      sessionPendingTaskRunId = null;
    }
    return true;
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    pushUser(text) {
      set({ turns: [...state.turns, { role: "user", text }] });
    },
    // start a turn → returns a TaskRun whose `.sink` you hand straight to runTurn(text, sink)
    startTurn(info = {}) {
      let run = null;
      run = createTaskRun(meta, app => {
        if (currentRun === run) set({ live: app, status: app.status });
        else updateHeldSnapshot(run, app);
      });
      currentRun = run;
      run.start(info.title || "", info.mode || meta.mode);
      return run;
    },
    commitTurn(run = currentRun, options = {}) {
      if (!run || currentRun !== run) return false;
      run.settle(options);
      return commit("success", run);
    },
    failTurn(reason, run = currentRun) {
      if (!run || currentRun !== run) return false;
      run.fail(reason);
      return commit("error", run);
    },
    cancelTurn(reason = "用户取消生成", run = currentRun) {
      if (!run || currentRun !== run) return false;
      run.cancel(reason);
      return commit("cancelled", run);
    },
    // L2 approval: the input handler routes a/d here → resolves the awaiting agentLoop confirm()
    resolveApproval(decision) {
      return !!(currentRun && currentRun.resolveApproval(decision));
    },
    awaitingApproval() {
      return !!(currentRun && currentRun.awaitingApproval());
    },
    matchPendingAction(input) {
      const key = String(input || "").trim();
      const action = state.sessionPendingActions.find(
        candidate => String(candidate?.key ?? "") === key
      );
      return action && heldRuns.has(action.taskRunId) ? action : null;
    },
    emitPendingAction(action, type, data = {}) {
      const taskRunId = action?.taskRunId;
      const run = taskRunId ? heldRuns.get(taskRunId) : null;
      if (!run) return false;
      const approvalEvent =
        type === EVENTS.APPROVAL_ACCEPTED || type === EVENTS.APPROVAL_REJECTED;
      run.emit(type, {
        ...data,
        ...(approvalEvent
          ? {
              id: data.id || action.approvalId || run.get().approval?.id,
              kind: "deliverable_acceptance",
            }
          : {}),
        taskRunId,
      });
      if (HELD_TERMINALS.has(type)) {
        heldRuns.delete(taskRunId);
        if (sessionPendingTaskRunId === taskRunId) {
          sessionPendingTaskRunId = null;
          set({ sessionPendingActions: [] });
        }
      }
      return true;
    },
  };
}
