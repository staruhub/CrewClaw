// tui/jsonl-bridge.mjs — headless event mode: the engine (this Node process) emits TaskEvents
// as JSONL to stdout and reads user input lines from stdin. A Rust/Ratatui (or any) front-end
// reduces the JSONL into AppState and renders. This is the "RatatuiRenderer" backend — the
// renderer-agnostic protocol carried over a process boundary (exactly what the protocol's
// serializable { type, ts, data } shape was built for).
//
// Wire format: one JSON object per line, e.g.
//   {"type":"task.started","ts":1719,"data":{"id":"turn1","title":"...","mode":"Chat"}}
//   {"type":"token.delta","ts":1719,"data":{"text":"…"}}
//   {"type":"approval.required","ts":1719,"data":{"id":"appr1","reason":"执行命令: …"}}
// Input lines are either a new task OR — while an approval is pending — the a/d/y/n decision.
// Event-driven (rl.on("line")) NOT for-await: the front's decision line must be read WHILE the
// agent is blocked inside confirm(), which a blocking for-await loop could never reach.
import { createInterface } from "node:readline";
import { makeEvent, EVENTS } from "./protocol.mjs";
import { renderMessage } from "../ui-markdown.mjs";
import { isCommand, runCommand, commandCatalog } from "../commands.mjs";
import { buildRunTurn, buildQuickUtilityTurn } from "./turn-runner.mjs";
import { routeTurn } from "./route.mjs";
import { applyUserAction, parseUserActionLine } from "./task-jsonl.mjs";
import { assembleProofPack } from "../proofpack.mjs";
import { estimateCost } from "../budget-guard.mjs";
import { readKpi, recordTaskOutcome } from "../kpi.mjs";
import { readEvalResult } from "../eval-runner.mjs";
import { readApprovalPolicy, readBudgetIndex, APPROVAL_TRUST_AUTO, TRUST_AUTO_THRESHOLD } from "./prefs.mjs";
import { recordSpend, readSpend, isOverBudget, capForBudgetIndex, monthKey } from "../spend.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export async function startJsonlBridge({
  agentLoop, agentLoopDeps, agentName = "鲸", meta = {}, history = [], saveSession,
  input = process.stdin, output = process.stdout, // injectable for tests
  // v0.13 M2：工作区根可注入（测试隔离到 tmpdir，不污染仓库）；缺省保持旧行为。
  root: bridgeRoot = process.env.CREWCLAW_ROOT || process.cwd(),
}) {
  let sessionPendingActions = []; // last task's actions — digit input matches these (§6.4)
  const emit = (type, data) => {
    if (type === EVENTS.PENDING_ACTIONS) sessionPendingActions = (data && data.actions) || [];
    // v0.15 P0-1: a NEW task starting makes the previous deliverable's PendingActions stale.
    // Wipe them at task.started so a later digit (2 → MARKET) is never captured by a ghost list.
    // (deliver turns emit PENDING_ACTIONS *after* TASK_STARTED, so the fresh list still lands.)
    if (type === EVENTS.TASK_STARTED) sessionPendingActions = [];
    output.write(JSON.stringify(makeEvent(type, data, Date.now())) + "\n");
  };

  // a header event so the front-end can paint the badge + tool/memory truth immediately.
  // caps.ansi=true tells the front-end this engine will also emit assistant.rendered (pre-typeset
  // ANSI); a front-end that lacks an ANSI parser simply ignores that event and keeps token.delta.
  // v0.13 M2：employee.skills = 真实技能名清单（SKILL.md 首标题，run.mjs 提取；无技能为空数组）。
  // v0.17 P2 C1：kpi_cumulative = 跨会话真累计（本进程启动前，本 root 下这个员工历史 accept/
  // tasks/cost 的落盘快照）——EMPLOYEE 面板的"本会话"区不变，新增的"累计"区读这个。
  const kpiCumulative = readKpi(bridgeRoot, meta.agentId);
  // v0.18 B2：eval = 上岗考试真评测结果（eval-runner 落 .crewclaw/eval/<agent>.json）。null=从未评测
  // → EVAL 屏保留 MOCK 占位；mock:true → 屏上标注"非认证分"；mock:false → 真认证分。
  const evalResult = readEvalResult(bridgeRoot, meta.agentId);
  emit("session.ready", { employee: { name: agentName, role: meta.role, mode: meta.mode, model: meta.model, skills: meta.skills || [], avatar: meta.avatar || [], kpi_cumulative: kpiCumulative, eval: evalResult }, caps: { ansi: true, parts: true, commands: commandCatalog() } });

  // v0.8 M2: accumulate the assistant text streamed this turn (from EVERY source — model
  // deltas AND route.mjs's direct token.delta emits) so the completed turn can be typeset once.
  let turnText = "";

  let turnSeq = 0, toolSeq = 0, apprSeq = 0;
  let pendingConfirm = null; // resolver set while agentLoop awaits an approval decision (§14.3)
  let busy = false;          // one task at a time (the front sends a line per Enter)
  let pendingApproval = null; // {taskRunId, root, goal, artifact, usage} while a task awaits accept (§11)
  let usageAcc = { prompt: 0, completion: 0 }; // running token usage for the ProofPack cost summary
  const turnUsage = () => ({ ...usageAcc });

  // v0.18 C3: add a settled task's estimated cost to this month's ledger; emit a one-shot
  // budget.warning the moment cumulative spend crosses 80% of the SETTINGS cap (the ledger's
  // warned_80 flag keeps it from firing every task after that).
  const accrueSpend = (cost) => {
    const { total, cap, crossedWarn } = recordSpend(bridgeRoot, readBudgetIndex(bridgeRoot), cost);
    if (crossedWarn) {
      emit(EVENTS.BUDGET_WARNING, { level: "warn", month: monthKey(), spent: total, cap });
    }
  };

  const sink = {
    onDelta: (text) => { turnText += text ?? ""; emit(EVENTS.TOKEN_DELTA, { text }); },
    // v0.11 M4：真·思考增量 → thinking.delta（前端折叠成「思考」块）。不计入 turnText（思考不是交付正文）。
    onThinking: (text) => { if (text) emit(EVENTS.THINKING_DELTA, { text }); },
    onInvocation: (inv = {}) => {
      const id = "tool" + ++toolSeq;
      emit(EVENTS.TOOL_REQUESTED, { id, tool: inv.toolName, label: inv.line || inv.action || inv.toolName });
      const failed = inv.status === "blocked" || inv.status === "error";
      // v0.8 M4: carry the full tool output (capped ~4KB) so the front-end's collapsed line can
      // expand to show it. Pick the richest available field; stringify non-strings defensively.
      const rawDetail = inv.output ?? inv.result ?? inv.detail ?? inv.stdout ?? inv.error ?? "";
      const detail = String(typeof rawDetail === "string" ? rawDetail : JSON.stringify(rawDetail, null, 2)).slice(0, 4096);
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, { id, summary: inv.action, code: failed ? (inv.code || inv.action) : undefined, detail });
    },
    onUsage: (u) => {
      if (!u) return;
      usageAcc.prompt += u.prompt_tokens || 0;
      usageAcc.completion += u.completion_tokens || 0;
      emit(EVENTS.TOKEN_USAGE, { prompt: u.prompt_tokens, completion: u.completion_tokens });
    },
    // L2 approval over the process boundary: emit APPROVAL_REQUIRED, await the front's a/d line.
    confirm: (msg, info = {}) => {
      emit(EVENTS.APPROVAL_REQUIRED, { id: "appr" + ++apprSeq, tool: info.tool || info.toolName, reason: typeof msg === "string" ? msg : info.reason, scope: info.scope });
      return new Promise((resolve) => { pendingConfirm = resolve; });
    },
  };

  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession, root: bridgeRoot });
  const runQuickUtility = buildQuickUtilityTurn({ agentLoop, agentLoopDeps });
  const rl = createInterface({ input });

  rl.on("line", async (raw) => {
    let action;
    try {
      action = parseUserActionLine(raw);
    } catch (e) {
      emit(EVENTS.DEBUG_LINE, { line: `user action parse error: ${String(e && e.message || e)}` });
      return;
    }
    let text = (action?.data?.text ?? String(raw)).trim();
    // while the agent awaits approval, the next line IS the a/d/y/n decision — not a new task
    if (pendingConfirm) {
      let allow;
      if (action?.type === "approval.resolve") {
        const result = applyUserAction(action, { emit });
        allow = !!result.approval;
      } else {
        allow = text === "a" || text === "allow" || text === "y" || text === "是";
      }
      const resolve = pendingConfirm; pendingConfirm = null;
      emit(EVENTS.APPROVAL_RESOLVED, { decision: allow ? "allow" : "deny" });
      resolve(allow);
      return;
    }
    const applied = applyUserAction(action, { emit });
    if (applied.handled) return;
    text = String(applied.text || "").trim();
    // v0.8 M6：结构化 parts（图片/文件附件）随本轮走 runModelTurn；routeTurn 只看 text（路由分类只认文字）。
    const messageParts = applied.parts;
    // 空消息才丢弃：纯附件（text 为空但 parts 非空）是合法的看图/读文件轮，必须放行——
    // 不能再加一条 `if (!text) return`，否则会把 parts-only 路径 dead-code 掉（附件被静默吞没）。
    if (!text && !(messageParts && messageParts.length)) return;
    if (text === "/exit" || text === ":q") { rl.close(); return; }
    // v0.8 M3: slash commands are engine-executed (they read engine state: model/history/registry),
    // NOT model turns. Intercept BEFORE task.started so a command never counts as a task, and emit
    // command.output for the front-end to display. /clear also resets the shared history + transcript.
    if (isCommand(text)) {
      const result = runCommand(text, { name: agentName, model: meta.model, root: bridgeRoot, color: true });
      if (result.action?.type === "exit") { rl.close(); return; }
      const clear = result.action?.type === "clear";
      if (clear) history.length = 0; // single source of truth: engine clears, front-end mirrors
      const body = result.text || (clear ? "（上下文已清空）" : "");
      emit(EVENTS.COMMAND_OUTPUT, { command: text, clear, ansi_lines: body ? renderMessage(body, { color: true }) : [], text: body });
      return;
    }
    if (busy) return; // a task is already running; ignore stray input
    // v0.18 C3: monthly budget enforcement. At ≥100% of the SETTINGS cap, refuse to start a NEW
    // task. A digit that matches a pending action ("1"=accept/"2"=revise/"3"=reveal) is NOT a new
    // task — it closes an existing one — so it's exempt. The refusal names the cap + points at SETTINGS.
    const isPendingActionInput = sessionPendingActions.some((a) => a && a.key === text.trim());
    const budgetIndex = readBudgetIndex(bridgeRoot);
    if (!isPendingActionInput && isOverBudget(bridgeRoot, budgetIndex)) {
      const total = readSpend(bridgeRoot).total;
      const cap = capForBudgetIndex(budgetIndex);
      emit(EVENTS.BUDGET_WARNING, { level: "block", month: monthKey(), spent: total, cap });
      emit(EVENTS.TOKEN_DELTA, { text: `\n⛔ 本月已达预算上限（$${total.toFixed(2)}/$${cap}）。新任务已暂停——去 SETTINGS 调高月度预算上限后再派活。` });
      return;
    }
    busy = true;
    // v0.15 P0-1: snapshot the pending actions BEFORE task.started wipes them. The digit the user
    // pressed matches against what was on screen; task.started clears the list for the NEXT turn.
    const pendingSnapshot = sessionPendingActions;
    const taskRunId = `turn-${turnSeq + 1}-${Date.now()}`;
    const root = bridgeRoot;
    const turnId = "turn" + ++turnSeq;
    // 纯附件轮 text 为空——给个占位标题，避免任务标题空白。
    emit(EVENTS.TASK_STARTED, { id: turnId, title: text || "（附件消息）", mode: meta.mode });
    turnText = ""; // start collecting this turn's assistant text for the typeset "set" event
    usageAcc = { prompt: 0, completion: 0 }; // 每轮重置 token 计量，ProofPack 成本只算本任务本轮（不累计历史轮）
    try {
      // v0.11：不跑 runModelTurn 的分支（天气卡/轻路径快捷工具）也必须把问答写进共享历史，
      // 否则下一轮模型看不到上一轮（"那明天呢"接不上中山天气——真实用户卡点）。
      const recordExchange = (userText, assistantText) => {
        history.push({ role: "user", content: userText });
        history.push({ role: "assistant", content: assistantText });
        if (saveSession) saveSession();
      };
      // same §6 Router as the Ink renderer — chat→workbench logic lives once in the engine
      const decision = await routeTurn(text, {
        emit,
        recordExchange,
        // v0.8 M6：runModelTurn 收 {text, parts}，附件展开成 content blocks（parts.mjs 单一事实源）。
        // routeTurn 传给我们的 msg 是路由用的字符串；把本轮 parts 合并回去交给 runTurn。
        runModelTurn: (msg) =>
          runTurn(messageParts && messageParts.length ? { text: msg, parts: messageParts } : msg, sink),
        runQuickUtility: (msg) => runQuickUtility(msg, sink), // §10.2 light path
        hasAttachments: !!(messageParts && messageParts.some((p) => p && (p.type === "image" || p.type === "file"))),
        pendingActions: pendingSnapshot,
        employeeScope: meta.employeeScope,
        env: process.env,
        role: meta.role,
        taskRunId,
        root,
        agentId: meta.agentId, // v0.13 M2：memory.state 的真实条目数按员工读取
      });
      // v0.8 M2: the turn's text is complete — typeset it ONCE via the shared markdown renderer
      // and "set" it over the live token.delta stream. Non-empty guard: pure tool/memory turns
      // that streamed no prose don't emit an empty rendered block.
      if (turnText.trim()) {
        emit(EVENTS.ASSISTANT_RENDERED, { turn_id: turnId, ansi_lines: renderMessage(turnText, { color: true }) });
      }
      // §11 Approval-before-Done + CC-PROOF-001. Three terminal shapes:
      //  (a) user accepted a held deliverable → write the ProofPack, emit approval.accepted, done.
      //  (b) task produced a deliverable → enter Approval (approval.requested), do NOT complete.
      //  (c) blocked / plain chat / revise → complete immediately.
      const acceptedAction = decision?.matchedPendingAction?.action_type === "accept";
      const art = decision?.producedArtifact;
      if (acceptedAction && pendingApproval) {
        const pack = writeProofPack(pendingApproval);
        emit(EVENTS.APPROVAL_ACCEPTED, { taskRunId: pendingApproval.taskRunId, proofpack: pack?.path });
        // v0.13 M2：accept 轮的 usage≈0——任务成本归**产出轮**（pendingApproval.usage），不是本轮。
        const produced = pendingApproval.usage || { prompt: 0, completion: 0 };
        pendingApproval = null;
        const acceptedCost = estimateCost({ promptTokens: produced.prompt, completionTokens: produced.completion }).cost;
        emit(EVENTS.TASK_COMPLETED, { usage: produced, est_cost: acceptedCost });
        // v0.17 P2 C1：真实验收落盘累计（EMPLOYEE 面板"累计"区 + MARKET/EVAL 真 KPI 的数据源）。
        recordTaskOutcome(root, meta.agentId, { accepted: true, cost: acceptedCost });
        accrueSpend(acceptedCost); // v0.18 C3
      } else if (art && !decision.blocked) {
        // v0.18 C4: honor the SETTINGS approval policy (was stored-but-ignored). "信任后自动"
        // auto-accepts once the employee has earned ≥N cumulative accepts — but still emits the
        // full approval.accepted → task.completed stream (+ ProofPack) so the record is complete,
        // just without a human keystroke. Default policy = manual gate (conformance unchanged).
        const held = { taskRunId, root, goal: text, artifact: art, usage: turnUsage() };
        const policy = readApprovalPolicy(root);
        const trusted =
          policy === APPROVAL_TRUST_AUTO &&
          readKpi(root, meta.agentId).accepted >= TRUST_AUTO_THRESHOLD;
        if (trusted) {
          const pack = writeProofPack(held);
          emit(EVENTS.TOKEN_DELTA, { text: "\n✓ 信任后自动验收（该员工累计验收已达阈值，交付流水完整保留）。" });
          emit(EVENTS.APPROVAL_ACCEPTED, { taskRunId, proofpack: pack?.path, auto: true });
          const cost = estimateCost({ promptTokens: held.usage.prompt, completionTokens: held.usage.completion }).cost;
          emit(EVENTS.TASK_COMPLETED, { usage: held.usage, est_cost: cost });
          recordTaskOutcome(root, meta.agentId, { accepted: true, cost });
          accrueSpend(cost); // v0.18 C3
        } else {
          pendingApproval = held;
          emit(EVENTS.APPROVAL_REQUESTED, {
            id: "task-appr-" + turnSeq,
            taskRunId,
            artifacts: [{ id: art.artifact_id, name: art.name, path: art.path, kind: art.kind, status: art.status }],
            reason: "任务已产出交付物，等待验收（1=接受 2=修订 3=打开位置）。",
          });
          // do NOT emit task.completed — the accept action closes the task.
        }
      } else if (!decision.blocked) {
        // preflight-blocked 轮已经发过 task.blocked（终态，已清 busy）——不能再发 task.completed，
        // 否则 reducer 会把 blocked 覆盖成 done/needs_artifact，UI 前脚说阻塞后脚说完成。
        // v0.13 M2：带上本轮真实 usage 与估算成本（前端 TASK QUEUE / KPI 的数据源）。
        const u = turnUsage();
        const plainCost = estimateCost({ promptTokens: u.prompt, completionTokens: u.completion }).cost;
        emit(EVENTS.TASK_COMPLETED, { usage: u, est_cost: plainCost });
        // v0.17 P2 C1：非验收终态也计入累计"任务数"（与本会话 KPI 的 tasks 定义一致——
        // task_meta 挂在每个 completed/blocked/rejected 任务头上，不只挂验收产出）。
        recordTaskOutcome(root, meta.agentId, { accepted: false, cost: plainCost });
        accrueSpend(plainCost); // v0.18 C3
      }
    } catch (e) {
      emit(EVENTS.TASK_REJECTED, { reason: String((e && e.message) || e) });
    } finally {
      busy = false;
    }
  });

  await new Promise((resolve) => rl.on("close", resolve));
}

// CC-PROOF-001: on accept, assemble and persist the ProofPack next to the run —
// .crewclaw/runs/<taskRunId>.proofpack.json — so a Trial Task leaves a durable evidence
// bundle (plan/timeline/tool_calls/artifacts/evidence/outcome/approval/cost), not just a
// chat log. Best-effort: a write failure must not crash the session.
function writeProofPack({ taskRunId, root, goal, artifact, usage }) {
  try {
    const pack = assembleProofPack({
      task_run_id: taskRunId,
      user_goal: goal,
      artifacts: artifact ? [artifact] : [],
      outcome_checks: [{ valid: true, deliverable: artifact?.path }],
      approval: { decision: "accept", at: Date.now() },
      usage,
    });
    const dir = join(root, ".crewclaw", "runs");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${taskRunId}.proofpack.json`);
    writeFileSync(path, JSON.stringify(pack, null, 2));
    return { path, pack };
  } catch {
    return null;
  }
}
