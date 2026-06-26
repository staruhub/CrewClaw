// tui/route.mjs — the v0.6 Intent/Scope routing, SHARED by both renderers (Ink ChatApp and
// the Ratatui JSONL bridge). One user message is classified (router.classifyIntent) and
// driven through the TaskRun via events, so "chat→workbench" logic lives ONCE in the engine:
//   employee_task  → upgrade to a TaskRun (task.upgraded_from_chat) + run the model turn
//   quick_utility  → run un-scored (emit quick.utility; doesn't count as employee work, §6.2)
//   memory_command → memory-harness truth (no model turn, no false persistent claim — §9.8)
//   artifact_action→ run the model turn (the agentLoop's artifact tools do the real write)
//   out_of_scope   → decline + offer delegation (§6.2)
//   ambiguous      → if it matched a PendingAction, run that; else clarify (§6.4)
//   employee_chat  → light model turn
import { classifyIntent } from "../router.mjs";
import { memoryCommandResponse } from "../memory-harness.mjs";
import { EVENTS } from "./protocol.mjs";

// deps: { emit(type,data), runModelTurn(text)->Promise, pendingActions, employeeScope, env, role }
export async function routeTurn(message, deps = {}) {
  const { emit = () => {}, runModelTurn = async () => {}, pendingActions = [], employeeScope, env = {}, role } = deps;
  const decision = classifyIntent(message, { pendingActions, employeeScope });

  // §6.4: a matched PendingAction takes priority over the model — system-owned, NOT guessed.
  if (decision.matchedPendingAction) {
    const a = decision.matchedPendingAction;
    emit(EVENTS.TOKEN_DELTA, { text: `执行待办：${a.label || a.key}` });
    await runModelTurn(a.payload || a.label || message);
    return decision;
  }

  switch (decision.type) {
    case "employee_task":
      if (decision.upgradeToTaskRun) emit(EVENTS.TASK_UPGRADED_FROM_CHAT, { reason: decision.reason });
      await runModelTurn(message);
      break;

    case "quick_utility":
      emit(EVENTS.QUICK_UTILITY, { intent: message, status: "running" });
      await runModelTurn(message); // v1: still runs, but flagged un-scored (not employee work)
      break;

    case "memory_command": {
      const r = memoryCommandResponse(message, env) || {};
      if (r.truth) emit(EVENTS.MEMORY_STATE, { memory: r.truth });
      emit(EVENTS.MEMORY_REQUESTED, { summary: message });
      if (r.note) emit(EVENTS.TOKEN_DELTA, { text: r.note });
      break; // no model turn — memory is a tool, not a sentence
    }

    case "out_of_scope":
      emit(EVENTS.TOKEN_DELTA, { text: `这超出我的岗位（${role || "本员工"}）。我可以委派给通用助手,或你换一个岗位相关的问题。` });
      break;

    case "ambiguous":
      emit(EVENTS.TOKEN_DELTA, { text: "没太理解,能说具体一点吗?(或直接选上面的待办编号)" });
      break;

    case "employee_chat":
    default:
      await runModelTurn(message);
      break;
  }
  return decision;
}
