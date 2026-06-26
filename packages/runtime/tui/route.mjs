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
import { weatherCity, fetchWeatherCard } from "../weather.mjs";
import { EVENTS } from "./protocol.mjs";

// deps: { emit(type,data), runModelTurn(text)->Promise<answer>, pendingActions, employeeScope,
//         env, role, taskRunId, root } — taskRunId+root opt the turn into real artifact persistence
export async function routeTurn(message, deps = {}) {
  const { emit = () => {}, runModelTurn = async () => {}, runQuickUtility, fetchWeather = fetchWeatherCard, pendingActions = [], employeeScope, env = {}, role, taskRunId, root } = deps;
  const decision = classifyIntent(message, { pendingActions, employeeScope });

  // §6.4: a matched PendingAction takes priority over the model — system-owned, NOT guessed.
  if (decision.matchedPendingAction) {
    const a = decision.matchedPendingAction;
    if (a.action_type === "accept") {
      // AC-009: accept the deliverable → mark it accepted + record the task effective. No model.
      if (a.artifactId) emit(EVENTS.ARTIFACT_UPDATED, { id: a.artifactId, patch: { status: "accepted" } });
      emit(EVENTS.OUTCOME_CHECKED, { valid: true, deliverable: a.path, reason: "用户已验收" });
      emit(EVENTS.TOKEN_DELTA, { text: `✓ 已接受交付物${a.path ? "：" + a.path : ""},记为有效任务。` });
    } else if (a.action_type === "reveal") {
      // AC-007: open the folder via the OS reveal, never raw bash.
      const reveal = revealStrategy(a.path);
      emit(EVENTS.WORKSPACE_REVEALED, { path: a.path, available: reveal.available, command: reveal.available ? `${reveal.command} ${(reveal.args || []).join(" ")}` : reveal.fallback?.manual_command });
    } else {
      // revise / other → a fresh model turn on the action's payload
      emit(EVENTS.TOKEN_DELTA, { text: `执行待办：${a.label || a.key}` });
      await runModelTurn(a.payload || a.label || message);
    }
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

    case "quick_utility": {
      emit(EVENTS.QUICK_UTILITY, { intent: message, status: "running" });
      // §5.3 Weather Card: a 天气 query fetches a STRUCTURED card from a free source (no model,
      // quota-independent), not prose. Non-weather quick utilities (time/换算) take the light path.
      const city = weatherCity(message);
      const card = city ? await Promise.resolve(fetchWeather(city)).catch(() => null) : null;
      if (card) {
        emit(EVENTS.QUICK_UTILITY, { intent: message, status: "done", result: card, source: card.source || "wttr.in" });
        emit(EVENTS.TOKEN_DELTA, { text: `${card.city}：${card.condition} ${card.temp_c}°C（体感 ${card.feels_c}°C · 湿度 ${card.humidity}%）` });
      } else {
        // §10.2: light path (minimal system, no full employee context). Un-scored either way.
        await (runQuickUtility || runModelTurn)(message);
      }
      break;
    }

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
    // An explicit short-form request ("一句话/简短/两三句") is satisfied by a short answer —
    // don't pedantically flag No-Chat-only-Done. (Otherwise a formal task owes a real file.)
    if (/一句话|一行|简短|简要|两三句|两句|简单说|快速说|概括|tl;?dr/i.test(String(message || ""))) return null;
    emit(EVENTS.TOKEN_DELTA, {
      text: "\n⚠ 这是一项正式任务,但我只给了对话答复、没有产出可交付文件。按「无交付物不算完成」,本次不计为有效交付——要我整理成正式报告(.md)吗?",
    });
    emit(EVENTS.OUTCOME_CHECKED, { valid: false, gaps: ["no_artifact"], reason: "只有对话答复,无可交付文件" });
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
    // AC-001: if the report carries a table, also persist it as a real .csv spreadsheet Artifact.
    const csv = markdownTableToCsv(text);
    if (csv) {
      try {
        const csvArt = writeArtifact({ name: artifactFileName(message).replace(/\.md$/i, "") + "-table.csv", kind: "table", content: csv, taskRunId, root });
        emit(EVENTS.ARTIFACT_CREATED, { id: csvArt.artifact_id, name: csvArt.name, kind: csvArt.kind, path: csvArt.path, status: csvArt.status, bytes: csvArt.bytes });
      } catch { /* the .md is the primary deliverable; a CSV failure must not sink the turn */ }
    }
    emit(EVENTS.OUTCOME_CHECKED, { valid: true, deliverable: art.path, kind: art.kind, bytes: art.bytes });
    // AC-009/001/006: the deliverable is reviewable — offer accept / revise / open as
    // PendingActions (digit input matches these FIRST, §6.4), so "1" accepts, not a model guess.
    emit(EVENTS.PENDING_ACTIONS, { actions: [
      { key: "1", label: "接受交付物", action_type: "accept", artifactId: art.artifact_id, path: art.path },
      { key: "2", label: "要求修订", action_type: "revise", payload: `请根据我的反馈修订《${art.name}》` },
      { key: "3", label: "打开位置", action_type: "reveal", path: art.path },
    ] });
    return art;
  } catch (e) {
    emit(EVENTS.TOKEN_DELTA, { text: `\n（交付物保存失败:${(e && e.message) || e}）` });
    emit(EVENTS.OUTCOME_CHECKED, { valid: false, gaps: ["write_failed"], reason: String((e && e.message) || e) });
    return null;
  }
}

function artifactFileName(message) {
  const slug = String(message || "report").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "report";
  return `${slug}.md`;
}

// AC-001: pull the first Markdown table out of a report → CSV, so a report with an assumptions
// table also yields a real spreadsheet Artifact (not just prose). Returns null if there's no table.
export function markdownTableToCsv(text) {
  const rows = [];
  let inTable = false;
  for (const line of String(text || "").split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      inTable = true;
      if (cells.every((c) => c === "" || /^:?-{2,}:?$/.test(c))) continue; // separator row
      rows.push(cells);
    } else if (inTable) {
      break; // table ended
    }
  }
  if (rows.length < 2) return null; // need a header + at least one data row
  const esc = (c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
