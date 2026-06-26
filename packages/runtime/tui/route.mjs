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
import { writeArtifact, revealStrategy } from "../artifact-contract.mjs";
import { EVENTS } from "./protocol.mjs";

// deps: { emit(type,data), runModelTurn(text)->Promise<answer>, pendingActions, employeeScope,
//         env, role, taskRunId, root } — taskRunId+root opt the turn into real artifact persistence
export async function routeTurn(message, deps = {}) {
  const { emit = () => {}, runModelTurn = async () => {}, pendingActions = [], employeeScope, env = {}, role, taskRunId, root } = deps;
  const decision = classifyIntent(message, { pendingActions, employeeScope });

  // §6.4: a matched PendingAction takes priority over the model — system-owned, NOT guessed.
  if (decision.matchedPendingAction) {
    const a = decision.matchedPendingAction;
    emit(EVENTS.TOKEN_DELTA, { text: `执行待办：${a.label || a.key}` });
    await runModelTurn(a.payload || a.label || message);
    return decision;
  }

  switch (decision.type) {
    case "employee_task": {
      if (decision.upgradeToTaskRun) emit(EVENTS.TASK_UPGRADED_FROM_CHAT, { reason: decision.reason });
      const answer = await runModelTurn(message);
      await persistDeliverable({ emit, answer, message, taskRunId, root });
      break;
    }

    case "artifact_action": {
      const answer = await runModelTurn(message);
      await persistDeliverable({ emit, answer, message, taskRunId, root });
      break;
    }

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

// No-Artifact-No-Created + No-Chat-only-Done (§5.8/§8): a formal task must leave a REAL,
// openable deliverable on disk — not just chat text. Persist a substantial answer as an
// artifact file (writeArtifact verifies the bytes); if the model only chatted, say so
// honestly instead of letting the UI imply "完成". No taskRunId → caller didn't opt in.
async function persistDeliverable({ emit, answer, message, taskRunId, root }) {
  if (!taskRunId) return null;
  const text = typeof answer === "string" ? answer.trim() : "";
  const looksLikeDeliverable = text.length >= 200 || /(^|\n)#{1,6}\s|\n\s*[-*]\s|\n\s*\d+\.\s|\|.+\|/.test(text);
  if (!looksLikeDeliverable) {
    emit(EVENTS.TOKEN_DELTA, {
      text: "\n⚠ 这是一项正式任务,但我只给了对话答复、没有产出可交付文件。按「无交付物不算完成」,本次不计为有效交付——要我整理成正式报告(.md)吗?",
    });
    return null;
  }
  try {
    const art = writeArtifact({ name: artifactFileName(message), kind: "report", content: text, taskRunId, root });
    emit(EVENTS.ARTIFACT_CREATED, { id: art.artifact_id, name: art.name, kind: art.kind, path: art.path, status: art.status, bytes: art.bytes });
    const reveal = revealStrategy(art.path);
    emit(EVENTS.WORKSPACE_REVEALED, {
      path: art.path,
      available: reveal.available,
      command: reveal.available ? `${reveal.command} ${(reveal.args || []).join(" ")}` : reveal.fallback?.manual_command,
    });
    return art;
  } catch (e) {
    emit(EVENTS.TOKEN_DELTA, { text: `\n（交付物保存失败:${(e && e.message) || e}）` });
    return null;
  }
}

function artifactFileName(message) {
  const slug = String(message || "report").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "report";
  return `${slug}.md`;
}
