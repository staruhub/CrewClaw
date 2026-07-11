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
import { captureArtifactFingerprint } from "../acceptance-transaction.mjs";
import { memoryCommandResponse } from "../memory-harness.mjs";
import { loadMemory } from "../memory-store.mjs";
import {
  addEvidence,
  newEvidenceCard,
  verifySourceType,
} from "../evidence-store.mjs";
import {
  revealStrategy,
  verifyGuardedArtifactFingerprint,
  writeArtifact,
} from "../artifact-contract.mjs";
import { weatherCity, weatherDay, fetchWeatherCard } from "../weather.mjs";
import { pickBackend } from "../tools-web.mjs";
import { EVENTS } from "./protocol.mjs";

// deps: { emit(type,data), runModelTurn(text)->Promise<answer>, pendingActions, employeeScope,
//         env, role, taskRunId, root } — taskRunId+root opt the turn into real artifact persistence
export async function routeTurn(message, deps = {}) {
  const {
    emit = () => {},
    runModelTurn = async () => {},
    runQuickUtility,
    fetchWeather = fetchWeatherCard,
    executeReveal,
    pendingActions = [],
    employeeScope,
    env = {},
    role,
    taskRunId,
    root,
    hasAttachments = false,
    recordExchange,
    agentId,
  } = deps;
  const decision = classifyIntent(message, { pendingActions, employeeScope });
  // v0.8 M6：带附件（图片/文件 parts）的消息天然是模型轮——看图/读文件必须真跑模型，不能被
  // 短文本的 ambiguous/out_of_scope 分类拦成澄清语。仅在这两类（+未命中 PendingAction）时降级为 chat；
  // employee_task 等正式意图保持原类，否则带附件的交付任务会跳过 TaskRun 升级/preflight 阻塞/交付物落盘。
  if (
    hasAttachments &&
    !decision.matchedPendingAction &&
    (decision.type === "ambiguous" || decision.type === "out_of_scope")
  ) {
    decision.type = "employee_chat";
    decision.forcedByAttachment = true;
  }

  // §6.4: a matched PendingAction takes priority over the model — system-owned, NOT guessed.
  if (decision.matchedPendingAction) {
    const a = decision.matchedPendingAction;
    if (a.action_type === "accept") {
      // Legacy/non-bridge renderers can still route digit 1 here. Revalidate the exact bytes that
      // were offered for review before turning the action into an acceptance signal. The JSONL
      // bridge performs the same check at its own settlement boundary.
      const verified = verifyPendingArtifact(a, root || process.cwd());
      const acceptedTaskRunId = a.taskRunId || taskRunId;
      if (!verified.ok) {
        if (a.artifactId) {
          emit(EVENTS.ARTIFACT_UPDATED, {
            id: a.artifactId,
            taskRunId: acceptedTaskRunId,
            patch: { status: "rejected" },
          });
        }
        emit(EVENTS.OUTCOME_CHECKED, {
          id: acceptedTaskRunId,
          taskRunId: acceptedTaskRunId,
          valid: false,
          deliverable: a.path,
          gaps: [verified.code],
          reason: verified.reason,
        });
        emit(EVENTS.TASK_REJECTED, {
          id: acceptedTaskRunId,
          taskRunId: acceptedTaskRunId,
          status: "failed",
          reason: verified.reason,
        });
        emit(EVENTS.PENDING_ACTIONS, {
          taskRunId: acceptedTaskRunId,
          actions: [],
        });
        decision.blocked = true;
        return decision;
      }
      // AC-009: accept the deliverable → mark it accepted + record the task effective. No model.
      if (a.artifactId)
        emit(EVENTS.ARTIFACT_UPDATED, {
          id: a.artifactId,
          taskRunId: acceptedTaskRunId,
          patch: { status: "accepted" },
        });
      emit(EVENTS.OUTCOME_CHECKED, {
        id: acceptedTaskRunId,
        taskRunId: acceptedTaskRunId,
        valid: true,
        deliverable: a.path,
        reason: "用户已验收",
      });
      emit(EVENTS.TOKEN_DELTA, {
        text: `✓ 已接受交付物${a.path ? "：" + a.path : ""},记为有效任务。`,
      });
      // v0.15 P0-1: the deliverable is consumed — release the digit bindings so 1-5 switch screens again.
      emit(EVENTS.PENDING_ACTIONS, {
        taskRunId: acceptedTaskRunId,
        actions: [],
      });
    } else if (a.action_type === "reveal") {
      // A renderer that cannot execute OS actions must not claim the file was opened. The JSONL
      // bridge intercepts this action and executes the strategy; other renderers get an honest
      // unavailable result and can surface the manual command.
      const reveal = revealStrategy(a.path);
      emit(EVENTS.ARTIFACT_REVEALED, {
        id: a.artifactId,
        artifact_id: a.artifactId,
        taskRunId: a.taskRunId || taskRunId,
        path: a.path,
        ok: false,
        available: reveal.available,
        reason: "当前 renderer 未执行系统打开动作",
        command: reveal.available
          ? `${reveal.command} ${(reveal.args || []).join(" ")}`
          : reveal.fallback?.manual_command,
      });
    } else {
      // revise / other → a fresh model turn on the action's payload.
      // v0.15 P0-1: release the old digit bindings first; the new turn may set its own list.
      emit(EVENTS.PENDING_ACTIONS, {
        taskRunId: a.taskRunId || taskRunId,
        actions: [],
      });
      emit(EVENTS.TOKEN_DELTA, { text: `执行待办：${a.label || a.key}` });
      await runModelTurn(a.payload || a.label || message);
    }
    return decision;
  }

  switch (decision.type) {
    case "employee_task": {
      if (decision.upgradeToTaskRun)
        emit(EVENTS.TASK_UPGRADED_FROM_CHAT, {
          id: taskRunId,
          taskRunId,
          reason: decision.reason,
        });
      // AC-003 / CC-TOOL-001 Preflight: a task that needs the live web must have a real
      // search provider BEFORE the model runs. No provider (pickBackend ⇒ ddg scrape) ⇒
      // block honestly instead of letting the agent burn tool calls guessing URLs and
      // fabricate a "latest models" list. Tool Truth over tool hallucination (§4.5/§9.1).
      if (decision.needsSearch && pickBackend(env).name === "ddg") {
        const detail = "未配置 web.search provider（Tavily / Serper / Brave）";
        emit(EVENTS.TOOL_PREFLIGHT_CHECKED, {
          id: "web_search",
          tool: "web.search",
          ok: false,
          label: "web.search",
          detail,
          status: "missing_key",
          reason: detail,
        });
        emit(EVENTS.TASK_BLOCKED, {
          id: taskRunId,
          taskRunId,
          reason:
            "缺少可验证的联网搜索能力（web.search missing_key），本研究任务已阻塞；配置 TAVILY_API_KEY（免费）后可运行。",
          tool: "web.search",
          status: "missing_key",
        });
        decision.blocked = true;
        break;
      }
      const answer = await runModelTurn(message);
      const art = await persistDeliverable({
        emit,
        answer,
        message,
        taskRunId,
        root,
      });
      if (art) decision.producedArtifact = art;
      break;
    }

    case "artifact_action": {
      if (isWorkspaceRevealRequest(message)) {
        const target = root || process.cwd();
        const reveal = revealStrategy(target);
        let result = { ok: false, error: "当前 renderer 未执行系统打开动作" };
        if (reveal.available && typeof executeReveal === "function") {
          try {
            result =
              executeReveal(reveal, { path: target, taskRunId }) || result;
          } catch (error) {
            result = { ok: false, error: error?.message || String(error) };
          }
        }
        emit(EVENTS.WORKSPACE_REVEALED, {
          id: taskRunId,
          taskRunId,
          path: target,
          ok: result.ok === true,
          available: reveal.available,
          reason: result.ok === true ? "已打开工作区位置" : result.error,
          command: reveal.available
            ? `${reveal.command} ${(reveal.args || []).join(" ")}`.trim()
            : reveal.fallback?.manual_command,
        });
        decision.unscored = true;
        break;
      }
      const answer = await runModelTurn(message);
      const art = await persistDeliverable({
        emit,
        answer,
        message,
        taskRunId,
        root,
      });
      if (art) decision.producedArtifact = art;
      break;
    }

    case "quick_utility": {
      emit(EVENTS.QUICK_UTILITY, { intent: message, status: "running" });
      // §5.3 Weather Card: a 天气 query fetches a STRUCTURED card from a free source (no model,
      // quota-independent), not prose. Non-weather quick utilities (time/换算) take the light path.
      const city = weatherCity(message);
      const day = weatherDay(message); // 0=今天 1=明天 2=后天；更远 null → 交给模型
      const card =
        city && day !== null
          ? await Promise.resolve(fetchWeather(city, { day })).catch(() => null)
          : null;
      if (card) {
        emit(EVENTS.QUICK_UTILITY, {
          intent: message,
          status: "done",
          result: card,
          source: card.source || "wttr.in",
        });
        // 预报日（带 label）显示温度区间；当天显示实况+体感/湿度。
        const cardLine = card.label
          ? `${card.city}${card.label}（${card.date}）：${card.condition} ${card.min_c}~${card.max_c}°C`
          : `${card.city}：${card.condition} ${card.temp_c}°C（体感 ${card.feels_c}°C · 湿度 ${card.humidity}%）`;
        emit(EVENTS.TOKEN_DELTA, { text: cardLine });
        // 无模型轮 → 手动把这轮问答写进共享历史，后续追问（"那明天呢"）才有上文可接。
        recordExchange?.(message, cardLine);
      } else if (/天气|weather|气温|温度/i.test(message)) {
        // 天气问但卡片答不了（没提城市、问得太远、源挂了）→ 走全上下文模型轮：
        // "明天天气呢" 这类省略城市的追问，只有带历史的模型才接得住（轻路径无历史会反问）。
        await runModelTurn(message);
      } else if (runQuickUtility) {
        // §10.2: light path (minimal system, no full employee context). Un-scored either way.
        // 轻路径进模型时不带员工上下文（设计如此），但答案必须回写历史保持对话连续。
        const answer = await runQuickUtility(message);
        if (typeof answer === "string" && answer.trim())
          recordExchange?.(message, answer);
      } else {
        await runModelTurn(message); // runModelTurn 自己维护历史
      }
      break;
    }

    case "memory_command": {
      const r = memoryCommandResponse(message, env) || {};
      if (r.truth) {
        // v0.13 M2：附带该员工记忆库的真实条目数（读不到就不发 count 字段——不发假 0）。
        let count;
        try {
          if (root && agentId) {
            const store = loadMemory(root, agentId);
            if (store.ok) count = store.items.length;
          }
        } catch {
          /* count stays undefined */
        }
        emit(EVENTS.MEMORY_STATE, {
          memory: count === undefined ? r.truth : { ...r.truth, count },
        });
      }
      emit(EVENTS.MEMORY_REQUESTED, { summary: message });
      if (r.note) emit(EVENTS.TOKEN_DELTA, { text: r.note });
      break; // no model turn — memory is a tool, not a sentence
    }

    case "out_of_scope":
      emit(EVENTS.TOKEN_DELTA, {
        text: `这超出我的岗位（${role || "本员工"}）。我可以委派给通用助手,或你换一个岗位相关的问题。`,
      });
      break;

    case "ambiguous":
      emit(EVENTS.TOKEN_DELTA, {
        text: "没太理解,能说具体一点吗?(或直接选上面的待办编号)",
      });
      break;

    case "employee_chat":
    default:
      await runModelTurn(message);
      break;
  }
  return decision;
}

function isWorkspaceRevealRequest(message) {
  const text = String(message || "");
  const asksReveal =
    /打开.*(?:文件夹|目录|位置)|(?:open|reveal)\s+(?:the\s+)?(?:folder|directory|location)/i.test(
      text
    );
  const alsoAsksDeliverable =
    /生成|创建|写|输出|保存为|导出.*(?:报告|文件)|report|document|spreadsheet|markdown/i.test(
      text
    );
  return asksReveal && !alsoAsksDeliverable;
}

// No-Artifact-No-Created + No-Chat-only-Done (§5.8/§8): a formal task must leave a REAL,
// openable deliverable on disk — not just chat text. Persist a substantial answer as an
// artifact file (writeArtifact verifies the bytes); if the model only chatted, say so
// honestly instead of letting the UI imply "完成". No taskRunId → caller didn't opt in.
async function persistDeliverable({ emit, answer, message, taskRunId, root }) {
  if (!taskRunId) return null;
  const text = typeof answer === "string" ? answer.trim() : "";
  const looksLikeDeliverable =
    text.length >= 200 ||
    /(^|\n)#{1,6}\s|\n\s*[-*]\s|\n\s*\d+\.\s|\|.+\|/.test(text);
  if (!looksLikeDeliverable) {
    // An explicit short-form request ("一句话/简短/两三句") is satisfied by a short answer —
    // don't pedantically flag No-Chat-only-Done. (Otherwise a formal task owes a real file.)
    if (
      /一句话|一行|简短|简要|两三句|两句|简单说|快速说|概括|tl;?dr/i.test(
        String(message || "")
      )
    )
      return null;
    emit(EVENTS.TOKEN_DELTA, {
      text: "\n⚠ 这是一项正式任务,但我只给了对话答复、没有产出可交付文件。按「无交付物不算完成」,本次不计为有效交付——要我整理成正式报告(.md)吗?",
    });
    emit(EVENTS.OUTCOME_CHECKED, {
      id: taskRunId,
      taskRunId,
      valid: false,
      gaps: ["no_artifact"],
      reason: "只有对话答复,无可交付文件",
    });
    return null;
  }
  try {
    const art = writeArtifact({
      name: artifactFileName(message),
      kind: "report",
      content: text,
      taskRunId,
      root,
    });
    const fingerprint = captureArtifactFingerprint(art.path);
    emit(EVENTS.ARTIFACT_CREATED, {
      id: art.artifact_id,
      taskRunId,
      name: art.name,
      kind: art.kind,
      path: art.path,
      status: art.status,
      bytes: art.bytes,
      sha256: fingerprint.ok ? fingerprint.sha256 : undefined,
      mtimeMs: fingerprint.ok ? fingerprint.mtimeMs : undefined,
    });
    // v0.13 M2：真·证据链进 chat 交付轮——复用 crew run 的配方（run.mjs Step4）：报告引用的
    // URL → evidence card 落 .crewclaw/runs/<id>.evidence.json（与 run 模式同一存储）并实时
    // emit。只在交付轮触发；不造数字置信度（引擎置信度是分类，source_type 才是真值）。
    try {
      const cited = [...new Set(text.match(/https?:\/\/[^\s)]+/g) || [])];
      for (const src of cited) {
        const card = newEvidenceCard({
          field: "来源",
          value: src,
          sourceUrl: src,
        });
        addEvidence(root, taskRunId, card);
        emit(EVENTS.EVIDENCE_CREATED, {
          fact: "报告引用来源",
          source: src,
          source_type: card.source_type,
        });
      }
    } catch {
      /* 证据落盘失败不沉没交付轮 */
    }
    const reveal = revealStrategy(art.path);
    emit(EVENTS.WORKSPACE_REVEALED, {
      id: taskRunId,
      taskRunId,
      path: art.path,
      ok: false,
      available: reveal.available,
      reason: "交付位置可用，但尚未执行系统打开动作",
      command: reveal.available
        ? `${reveal.command} ${(reveal.args || []).join(" ")}`.trim()
        : reveal.fallback?.manual_command,
    });
    // AC-001: if the report carries a table, also persist it as a real .csv spreadsheet Artifact.
    const csv = markdownTableToCsv(text);
    if (csv) {
      try {
        const csvArt = writeArtifact({
          name: artifactFileName(message).replace(/\.md$/i, "") + "-table.csv",
          kind: "table",
          content: csv,
          taskRunId,
          root,
        });
        const csvFingerprint = captureArtifactFingerprint(csvArt.path);
        emit(EVENTS.ARTIFACT_CREATED, {
          id: csvArt.artifact_id,
          taskRunId,
          name: csvArt.name,
          kind: csvArt.kind,
          path: csvArt.path,
          status: csvArt.status,
          bytes: csvArt.bytes,
          sha256: csvFingerprint.ok ? csvFingerprint.sha256 : undefined,
          mtimeMs: csvFingerprint.ok ? csvFingerprint.mtimeMs : undefined,
        });
      } catch {
        /* the .md is the primary deliverable; a CSV failure must not sink the turn */
      }
    }
    emit(EVENTS.OUTCOME_CHECKED, {
      id: taskRunId,
      taskRunId,
      valid: true,
      deliverable: art.path,
      kind: art.kind,
      bytes: art.bytes,
    });
    // AC-009/001/006: the deliverable is reviewable — offer accept / revise / open as
    // PendingActions (digit input matches these FIRST, §6.4), so "1" accepts, not a model guess.
    emit(EVENTS.PENDING_ACTIONS, {
      taskRunId,
      actions: [
        {
          key: "1",
          label: "接受交付物",
          action_type: "accept",
          artifactId: art.artifact_id,
          taskRunId,
          path: art.path,
          bytes: fingerprint.ok ? fingerprint.bytes : art.bytes,
          sha256: fingerprint.ok ? fingerprint.sha256 : undefined,
          mtimeMs: fingerprint.ok ? fingerprint.mtimeMs : undefined,
          realpath: fingerprint.ok ? fingerprint.realpath : undefined,
        },
        {
          key: "2",
          label: "要求修订",
          action_type: "revise",
          artifactId: art.artifact_id,
          taskRunId,
          path: art.path,
          payload: `请根据我的反馈修订《${art.name}》`,
        },
        {
          key: "3",
          label: "打开位置",
          action_type: "reveal",
          artifactId: art.artifact_id,
          taskRunId,
          path: art.path,
        },
      ],
    });
    return art;
  } catch (e) {
    emit(EVENTS.TOKEN_DELTA, {
      text: `\n（交付物保存失败:${(e && e.message) || e}）`,
    });
    emit(EVENTS.OUTCOME_CHECKED, {
      id: taskRunId,
      taskRunId,
      valid: false,
      gaps: ["write_failed"],
      reason: String((e && e.message) || e),
    });
    return null;
  }
}

function verifyPendingArtifact(action = {}, root = process.cwd()) {
  if (
    typeof action.path !== "string" ||
    typeof action.realpath !== "string" ||
    !Number.isFinite(action.bytes) ||
    !Number.isFinite(action.mtimeMs) ||
    typeof action.sha256 !== "string"
  ) {
    return {
      ok: false,
      code: "artifact_fingerprint_missing",
      reason: "待验收交付缺少完整性指纹，请重新生成并复核",
    };
  }
  return verifyGuardedArtifactFingerprint(root, {
    path: action.path,
    realpath: action.realpath,
    bytes: action.bytes,
    mtimeMs: action.mtimeMs,
    sha256: action.sha256,
  });
}

function artifactFileName(message) {
  const slug =
    String(message || "report")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "report";
  return `${slug}.md`;
}

// AC-001: pull the first Markdown table out of a report → CSV, so a report with an assumptions
// table also yields a real spreadsheet Artifact (not just prose). Returns null if there's no table.
export function markdownTableToCsv(text) {
  const rows = [];
  let inTable = false;
  for (const line of String(text || "").split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map(c => c.trim());
      inTable = true;
      if (cells.every(c => c === "" || /^:?-{2,}:?$/.test(c))) continue; // separator row
      rows.push(cells);
    } else if (inTable) {
      break; // table ended
    }
  }
  if (rows.length < 2) return null; // need a header + at least one data row
  const esc = c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map(r => r.map(esc).join(",")).join("\n") + "\n";
}
