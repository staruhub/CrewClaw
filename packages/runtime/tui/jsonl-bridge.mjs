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
import { randomUUID } from "node:crypto";
import { makeEvent, EVENTS } from "./protocol.mjs";
import { createRevealPacer } from "./reveal-pacer.mjs";
import { renderMessage } from "../ui-markdown.mjs";
import { setContentWidth } from "../ui-layout.mjs";
import { truncateToolDetail } from "../event-summary.mjs";
import { toolEventPresentation } from "../ui-tools.mjs";
import { isCommand, runCommand, commandCatalog } from "../commands.mjs";
import {
  proposeSessionPermissionLease,
  sessionPermissionLeaseKey,
  sessionPermissionLeaseLabel,
  sessionPermissionLeaseMatches,
} from "../permission-leases.mjs";
import { buildRunTurn, buildQuickUtilityTurn } from "./turn-runner.mjs";
import { routeTurn } from "./route.mjs";
import {
  applyUserAction,
  executeRevealStrategy,
  parseUserActionLine,
} from "./task-jsonl.mjs";
import { assembleProofPack } from "../proofpack.mjs";
import {
  captureArtifactFingerprint,
  persistProofPackDurably,
  writeJsonDurably,
} from "../acceptance-transaction.mjs";
import {
  inspectArtifactPath,
  readArtifactFileGuarded,
  verifyGuardedArtifactFingerprint,
} from "../artifact-contract.mjs";
import { estimateCost } from "../budget-guard.mjs";
import {
  readStateFileGuarded,
  resolveStateDirectory,
  resolveStatePath,
  withStateLock,
} from "../state-lock.mjs";
import { readKpi, recordTaskOutcome } from "../kpi.mjs";
import {
  buildGrowthCard,
  classifyEvalProviderStatus,
} from "../eval-provider.mjs";
import { makeJudge, readEvalResult, runEval } from "../eval-runner.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";
import {
  approveGrowthCycle,
  awaitGrowthDelivery,
  inspectLatestGrowthCycle,
  learnGrowthCycle,
  markGrowthNextRecommended,
  queueGrowthCycle,
  recommendGrowthCycle,
  recoverGrowthCycle,
  settleGrowthCycle,
  startGrowthCycle,
} from "../growth-cycle.mjs";
import { loadTaskRun as loadPersistedTaskRun } from "../task-state.mjs";
import {
  DREAM_EVENT_FAMILY,
  activateDreamCandidate,
  approveDreamCandidate,
  assessDreamFromWorkspace,
  buildDreamMorningReport,
  generateDreamCandidate,
  inspectDreamJob,
  persistDreamRecommendation,
  rejectDreamCandidate,
  rollbackDreamActivation,
} from "../dream-controller.mjs";
import {
  readApprovalPolicy,
  readBudgetIndex,
  APPROVAL_TRUST_AUTO,
  TRUST_AUTO_THRESHOLD,
  readDreamRecommendation,
} from "./prefs.mjs";
import {
  recordSpend,
  readSpend,
  capForBudgetIndex,
  monthKey,
  SPEND_STATE_INVALID,
} from "../spend.mjs";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export async function startJsonlBridge({
  agentLoop,
  agentLoopDeps,
  agentName = "鲸",
  meta = {},
  history = [],
  saveSession,
  input = process.stdin,
  output = process.stdout, // injectable for tests
  // v0.13 M2：工作区根可注入（测试隔离到 tmpdir，不污染仓库）；缺省保持旧行为。
  root: bridgeRoot = process.env.CREWCLAW_ROOT || process.cwd(),
  artifactActionDeps = {},
  proofPackWriter,
  taskPreflight,
  refreshAgentContext,
}) {
  let sessionPendingActions = []; // last task's actions — digit input matches these (§6.4)
  const artifactsById = new Map();
  let partText = "";
  let activePartId = null;
  let turnSeq = 0,
    eventSeq = 0,
    partSeq = 0,
    toolSeq = 0,
    apprSeq = 0;
  let pendingConfirm = null; // {id, taskRunId, resolve} while agentLoop awaits a tool authorization
  const sessionPermissionLeases = new Map();
  let pendingQuestion = null; // {id, taskRunId, options, otherKey, awaitingOther, resolve}
  let pendingApproval = null; // durable held deliverable awaiting acceptance
  let activeTaskRunId = null;
  let activeTurnId = null;
  let generationActive = false;
  let revealPacer = null;
  let revealPaused = false;
  let postToolDeltas = [];
  let sinkEventChain = Promise.resolve();
  let activeAbortController = null;
  let busy = false;
  let dreamBusy = false;
  let recoveredDreamActivation = null;
  let currentGrowthCycleId = null;
  let queuedGrowthCycle = null;
  const growthCyclesByTaskRun = new Map();
  let contextEpoch = Number.isSafeInteger(meta.contextEpoch)
    ? meta.contextEpoch
    : 0;
  let activeMemoryStateHash =
    typeof meta.memoryStateHash === "string" ? meta.memoryStateHash : null;
  let closing = false;
  let closeReason = "input_eof";
  let closeTerminalEmitted = false;
  let usageAcc = { prompt: 0, completion: 0 };
  let lastTodoStatuses = [];
  const activeSkillCalls = new Map();
  const clientEventFamilies = new Set();
  const emittedDreamRecommendations = new Set();
  const terminalTaskIds = new Set();
  const cancelledTaskIds = new Set();
  const queuedInputs = [];
  const turnUsage = () => ({ ...usageAcc });
  const skillUsageSnapshot = () =>
    [...activeSkillCalls.entries()]
      .map(([skill_id, calls]) => ({ skill_id, calls }))
      .sort((left, right) => left.skill_id.localeCompare(right.skill_id, "en"));
  const terminalEvents = new Set([
    EVENTS.TASK_COMPLETED,
    EVENTS.TASK_REJECTED,
    EVENTS.TASK_BLOCKED,
    EVENTS.TASK_FAILED,
    EVENTS.TASK_REVISION_NEEDED,
  ]);
  const lateContentEvents = new Set([
    EVENTS.TOKEN_DELTA,
    EVENTS.THINKING_DELTA,
    EVENTS.ASSISTANT_RENDERED,
    EVENTS.ASSISTANT_RENDERING_PREVIEW,
    EVENTS.TOOL_REQUESTED,
    EVENTS.TOOL_RUNNING,
    EVENTS.TOOL_SUCCEEDED,
    EVENTS.TOOL_FAILED,
    EVENTS.TOOL_BLOCKED,
    EVENTS.TOOL_CANCELLED,
    EVENTS.TODO_UPDATED,
  ]);
  const correlatedEvents = new Set([
    EVENTS.TASK_STARTED,
    ...terminalEvents,
    EVENTS.GENERATION_STARTED,
    EVENTS.GENERATION_COMPLETED,
    EVENTS.GENERATION_FAILED,
    EVENTS.GENERATION_CANCELLED,
    EVENTS.TOKEN_DELTA,
    EVENTS.THINKING_DELTA,
    EVENTS.ASSISTANT_RENDERED,
    EVENTS.ASSISTANT_RENDERING_PREVIEW,
    EVENTS.TOKEN_USAGE,
    EVENTS.TOOL_REQUESTED,
    EVENTS.TOOL_RUNNING,
    EVENTS.TOOL_SUCCEEDED,
    EVENTS.TOOL_FAILED,
    EVENTS.TOOL_BLOCKED,
    EVENTS.TOOL_CANCELLED,
    EVENTS.TODO_UPDATED,
  ]);

  const emit = (type, data = {}) => {
    let payload = data && typeof data === "object" ? { ...data } : {};
    const referencedTaskId = payload.taskRunId || payload.id;
    if (
      lateContentEvents.has(type) &&
      referencedTaskId &&
      terminalTaskIds.has(referencedTaskId)
    ) {
      return false;
    }
    if (
      type === EVENTS.TOKEN_DELTA &&
      generationActive &&
      activeTaskRunId &&
      !payload.part_id
    ) {
      const text = payload.text ?? "";
      if (!text) return false;
      const partId = ensurePartId();
      partText += text;
      payload = { ...payload, part_id: partId };
    }
    if (
      type === EVENTS.APPROVAL_REQUESTED &&
      generationActive &&
      referencedTaskId === activeTaskRunId
    ) {
      cancelGenerationNow(EVENTS.GENERATION_COMPLETED);
    }
    if (
      terminalEvents.has(type) &&
      generationActive &&
      referencedTaskId === activeTaskRunId
    ) {
      const failed =
        type === EVENTS.TASK_FAILED ||
        (type === EVENTS.TASK_REJECTED && payload.status === "failed");
      cancelGenerationNow(
        failed ? EVENTS.GENERATION_FAILED : EVENTS.GENERATION_COMPLETED,
        failed ? { reason: payload.reason || "task failed" } : {}
      );
    }
    if (
      activeTaskRunId &&
      activeTurnId &&
      correlatedEvents.has(type) &&
      !payload.turn_id
    ) {
      payload = turnPayload({
        ...payload,
        taskRunId: payload.taskRunId || activeTaskRunId,
      });
    }
    if (type === EVENTS.PENDING_ACTIONS)
      sessionPendingActions = payload.actions || [];
    // v0.15 P0-1: a NEW task starting makes the previous deliverable's PendingActions stale.
    // Wipe them at task.started so a later digit (2 → MARKET) is never captured by a ghost list.
    // (deliver turns emit PENDING_ACTIONS *after* TASK_STARTED, so the fresh list still lands.)
    if (type === EVENTS.TASK_STARTED) {
      sessionPendingActions = [];
      activeTaskRunId = payload.id || payload.taskRunId || activeTaskRunId;
    }
    if (type === EVENTS.ARTIFACT_CREATED && payload.id) {
      artifactsById.set(payload.id, {
        ...payload,
        artifact_id: payload.id,
        taskRunId: payload.taskRunId || activeTaskRunId || null,
      });
    }
    if (
      type === EVENTS.ARTIFACT_UPDATED &&
      payload.id &&
      artifactsById.has(payload.id)
    ) {
      const current = artifactsById.get(payload.id);
      artifactsById.set(payload.id, {
        ...current,
        ...(payload.patch || {}),
        taskRunId: payload.taskRunId || current.taskRunId,
      });
    }
    if (type === EVENTS.ARTIFACT_DELETED && payload.ok === true) {
      const id = payload.artifact_id || payload.id;
      if (id && artifactsById.has(id))
        artifactsById.set(id, { ...artifactsById.get(id), status: "deleted" });
    }
    if (type === EVENTS.ARTIFACT_EXPORTED && payload.ok === true) {
      const id = payload.artifact_id || payload.id;
      if (id && artifactsById.has(id))
        artifactsById.set(id, {
          ...artifactsById.get(id),
          exportPath: payload.path,
          status: "exported",
        });
    }
    if (terminalEvents.has(type)) {
      const terminalTaskId = payload.taskRunId || payload.id;
      if (terminalTaskId) terminalTaskIds.add(terminalTaskId);
      if (terminalTaskId && terminalTaskId === activeTaskRunId)
        activeTaskRunId = null;
    }
    output.write(JSON.stringify(makeEvent(type, payload, Date.now())) + "\n");
    return true;
  };

  const nextEventSeq = () => ++eventSeq;
  const turnPayload = data => ({
    turn_id: activeTurnId,
    taskRunId: activeTaskRunId,
    seq: nextEventSeq(),
    ...data,
  });
  const emitTurn = (type, data = {}) => {
    if (!activeTaskRunId || !activeTurnId) return false;
    if (
      terminalTaskIds.has(activeTaskRunId) &&
      ![
        EVENTS.TASK_COMPLETED,
        EVENTS.TASK_REJECTED,
        EVENTS.TASK_BLOCKED,
        EVENTS.TASK_FAILED,
      ].includes(type)
    ) {
      return false;
    }
    return emit(type, turnPayload(data));
  };
  const summarizeContextIndex = contextIndex => ({
    skills: {
      included: contextIndex?.skills?.included?.length || 0,
      dropped: contextIndex?.skills?.dropped?.length || 0,
      estimated_tokens: contextIndex?.skills?.estimatedTokens || 0,
      budget_tokens: contextIndex?.skills?.budgetTokens || 0,
      body_injected: false,
    },
    memory: {
      included: contextIndex?.memory?.included?.length || 0,
      dropped: contextIndex?.memory?.dropped?.length || 0,
      estimated_tokens: contextIndex?.memory?.estimatedTokens || 0,
      full_estimated_tokens: contextIndex?.memory?.fullEstimatedTokens || 0,
      budget_tokens: contextIndex?.memory?.budgetTokens || 0,
      body_injected: false,
    },
  });
  const refreshContextAfterMemoryChange = async ({
    reason,
    expectedMemoryStateHash,
  }) => {
    const previousMemoryStateHash = activeMemoryStateHash;
    if (typeof refreshAgentContext !== "function") {
      return {
        status: "unavailable",
        reason,
        epoch: contextEpoch,
        previous_memory_state_hash: previousMemoryStateHash,
        expected_memory_state_hash: expectedMemoryStateHash || null,
      };
    }
    try {
      const refreshed = await refreshAgentContext({
        reason,
        expectedMemoryStateHash,
        epoch: contextEpoch + 1,
      });
      const nextSystem = String(refreshed?.system || "");
      const nextMemoryStateHash = String(
        refreshed?.memoryStateHash || ""
      ).trim();
      if (!nextSystem.trim()) throw new Error("refreshed system is empty");
      if (!nextMemoryStateHash)
        throw new Error("refreshed memory state hash is missing");
      if (
        expectedMemoryStateHash &&
        nextMemoryStateHash !== expectedMemoryStateHash
      ) {
        throw new Error("refreshed memory state hash does not match receipt");
      }
      if (
        !refreshed?.contextIndex ||
        typeof refreshed.contextIndex !== "object"
      ) {
        throw new Error("refreshed context index is missing");
      }

      // buildRunTurn spreads agentLoopDeps at invocation time. Mutating this frozen session
      // snapshot cannot affect an in-flight model call, but the very next turn sees the new index.
      agentLoopDeps.system = nextSystem;
      meta.contextIndex = refreshed.contextIndex;
      if (
        Number.isSafeInteger(refreshed.contextTokens) &&
        refreshed.contextTokens > 0
      ) {
        meta.contextTokens = refreshed.contextTokens;
      }
      activeMemoryStateHash = nextMemoryStateHash;
      contextEpoch += 1;
      meta.memoryStateHash = nextMemoryStateHash;
      meta.contextEpoch = contextEpoch;
      return {
        status: "applied",
        reason,
        epoch: contextEpoch,
        previous_memory_state_hash: previousMemoryStateHash,
        memory_state_hash: nextMemoryStateHash,
        context_tokens:
          Number.isSafeInteger(meta.contextTokens) && meta.contextTokens > 0
            ? meta.contextTokens
            : null,
        context_index: summarizeContextIndex(refreshed.contextIndex),
      };
    } catch (error) {
      return {
        status: "failed",
        reason,
        epoch: contextEpoch,
        previous_memory_state_hash: previousMemoryStateHash,
        expected_memory_state_hash: expectedMemoryStateHash || null,
        error: String(error?.message || error).slice(0, 240),
      };
    }
  };
  const ensurePartId = () => {
    if (!activePartId && activeTurnId) {
      activePartId = `${activeTurnId}-part-${++partSeq}`;
    }
    return activePartId;
  };
  // Mid-stream markdown previews used to re-typeset the whole part every ~200ms and the
  // front-end preferred that snapshot over the 30ms grapheme reveal. Generation therefore
  // streams the raw buffer only; the first (and only) typeset arrives on assistant.rendered
  // when the part flushes at a tool boundary or generation end.
  const emitRevealedDelta = value => {
    if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return false;
    const text = String(value || "");
    if (!text) return false;
    const partId = ensurePartId();
    partText += text;
    return emitTurn(EVENTS.TOKEN_DELTA, { part_id: partId, text });
  };
  const flushAssistantPart = () => {
    if (!partText.trim() || !generationActive) {
      partText = "";
      activePartId = null;
      return false;
    }
    const partId = ensurePartId();
    const emitted = emitTurn(EVENTS.ASSISTANT_RENDERED, {
      part_id: partId,
      text: partText,
      ansi_lines: renderMessage(partText, { color: true }),
    });
    partText = "";
    activePartId = null;
    return emitted;
  };
  const cancelGenerationNow = (
    type = EVENTS.GENERATION_CANCELLED,
    extra = {}
  ) => {
    if (!generationActive) return false;
    revealPacer?.cancel();
    revealPacer = null;
    revealPaused = false;
    postToolDeltas = [];
    flushAssistantPart();
    generationActive = false;
    return emitTurn(type, {
      id: `${activeTurnId}-generation`,
      ...extra,
    });
  };
  const finishGeneration = async (
    type = EVENTS.GENERATION_COMPLETED,
    extra = {}
  ) => {
    if (!generationActive) return false;
    await sinkEventChain;
    if (!generationActive) return false;
    await revealPacer?.drain();
    if (!generationActive) return false;
    flushAssistantPart();
    generationActive = false;
    revealPacer?.cancel();
    revealPacer = null;
    return emitTurn(type, {
      id: `${activeTurnId}-generation`,
      ...extra,
    });
  };

  // Capability negotiation comes before optional event families. Old clients may continue with
  // session.ready; dream/v1 stays silent until client.ready explicitly opts in.
  emit(EVENTS.PROTOCOL_READY, {
    protocol: "crewclaw.task-event/v1",
    event_families: ["core/v1", DREAM_EVENT_FAMILY],
  });

  // a header event so the front-end can paint the badge + tool/memory truth immediately.
  // caps.ansi=true tells the front-end this engine will also emit assistant.rendered (pre-typeset
  // ANSI); a front-end that lacks an ANSI parser simply ignores that event and keeps token.delta.
  // v0.13 M2：employee.skills = 真实技能名清单（SKILL.md 首标题，run.mjs 提取；无技能为空数组）。
  // v0.17 P2 C1：kpi_cumulative = 跨会话真累计（本进程启动前，本 root 下这个员工历史 accept/
  // tasks/cost 的落盘快照）——EMPLOYEE 面板的"本会话"区不变，新增的"累计"区读这个。
  const kpiCumulative = readKpi(bridgeRoot, meta.agentId);
  // v0.18 B2：eval = 上岗考试真评测结果（eval-runner 落 .crewclaw/eval/<agent>.json）。null=从未评测
  // → EVAL 屏保留 MOCK 占位；mock:true → 明示非 C2；mock:false → 已验证真实评测，仍非正式 C2。
  const evalResult = readEvalResult(bridgeRoot, meta.agentId);
  const dreamOptions = ({ manualTrigger = false } = {}) => {
    const currentSpend = readSpend(bridgeRoot);
    const budgetIndex = readBudgetIndex(bridgeRoot);
    return {
      policy: meta.dreamPolicy || {},
      baseline: evalResult,
      employeeIdle: !busy && !pendingApproval && !pendingConfirm,
      budgetAvailable:
        currentSpend.state !== SPEND_STATE_INVALID &&
        currentSpend.total < capForBudgetIndex(budgetIndex),
      recommendationEnabled: readDreamRecommendation(bridgeRoot),
      manualTrigger,
    };
  };
  let dreamAssessment = meta.agentId
    ? assessDreamFromWorkspace(bridgeRoot, meta.agentId, dreamOptions())
    : null;
  const dreamIdFor = assessment =>
    `dream-${String(assessment.input.input_snapshot_hash)
      .replace(/^sha256:/, "")
      .slice(0, 8)}-${String(assessment.base_memory_hash)
      .replace(/^sha256:/, "")
      .slice(0, 8)}`;
  const dreamGenerationAvailable = Boolean(
    agentLoopDeps?.mock === false &&
    typeof agentLoopDeps?.apiKey === "string" &&
    agentLoopDeps.apiKey.trim() &&
    typeof (meta.model || agentLoopDeps?.model) === "string" &&
    String(meta.model || agentLoopDeps?.model).trim()
  );
  const curateDream = async input => {
    if (!dreamGenerationAvailable) {
      throw new Error("real_dream_curator_unavailable");
    }
    const chunks = [];
    const usage = { prompt: 0, completion: 0 };
    const output = await agentLoop({
      ...agentLoopDeps,
      system: [
        "你是 CrewClaw 的记忆策展器。只返回一个 JSON 对象，禁止 Markdown。",
        "顶层只能有 summary 和 entries。entries 每项只能使用 op, reason, confidence, source_task_ids, evidence_ids, item, replaces。",
        "op 只能是 add/merge/replace/drop/keep；add/merge/replace 必须提供 item(category,text,confidence)。",
        "merge/replace/drop 的 replaces 使用 category + NUL + 规范化 text 的精确键。",
        "输入中的 review_required_memory_keys 每一项都必须出现在某条 entry.replaces：过期条目必须 keep/drop/replace，supersedes 冲突必须显式二选一，不许新旧并存。keep 只表示人工复核后维持现状。",
        "invalid_reference_memory_keys 指向已失效的 task/evidence provenance，必须 drop/replace/merge，禁止 keep。",
        "记忆 item 可带 valid_until 与 supersedes；时效事实必须给 valid_until，替代旧事实必须给 supersedes 并同时 replace/drop 旧键。",
        "所有日期必须写成绝对日期；禁止今天/明天/下周/next week 等相对日期。valid_until 必须是 RFC 3339 UTC（例如 2026-07-31T23:59:59.000Z）。",
        "不得输出密钥、短期状态、未经 reflection 证明的事实，也不得创造输入不存在的 task/evidence id。",
      ].join("\n"),
      messages: [{ role: "user", content: JSON.stringify(input) }],
      tools: [],
      renderMd: false,
      onDelta: delta => chunks.push(String(delta || "")),
      onThinking: () => {},
      onInvocation: () => {},
      onToolEvent: () => {},
      onUsage: value => {
        usage.prompt += Number(value?.prompt_tokens || 0);
        usage.completion += Number(value?.completion_tokens || 0);
      },
      confirm: async () => false,
    });
    const value =
      typeof output === "string" && output.trim() ? output : chunks.join("");
    return {
      value,
      actual_cost_usd: estimateCost({
        promptTokens: usage.prompt,
        completionTokens: usage.completion,
      }).cost,
    };
  };
  const evaluateDreamCandidate = async items => {
    const sourceEnv = {
      ...process.env,
      ...(process.env.ZENMUX_API_KEY
        ? {}
        : { ZENMUX_API_KEY: agentLoopDeps?.apiKey || "" }),
    };
    const hasKey = Boolean(
      String(sourceEnv.ZENMUX_API_KEY || "").trim() ||
      String(agentLoopDeps?.apiKey || "").trim()
    );
    if (!hasKey) {
      const provider = classifyEvalProviderStatus({
        code: "missing_credentials",
        model: meta.model || agentLoopDeps?.model,
      });
      const error = new Error(provider.message);
      error.provider = provider;
      throw error;
    }
    try {
      const result = await runEval(meta.agentId, {
        mock: false,
        root: bridgeRoot,
        judge: makeJudge({ sourceEnv }),
        stagedMemoryItems: items,
        sourceEnv,
      });
      return {
        ...result,
        provider_status: "verified",
        eval_provider: classifyEvalProviderStatus({
          ok: true,
          code: "verified",
          model: result.judge_model || result.model,
        }),
      };
    } catch (error) {
      const message = error?.message || String(error);
      const httpMatch = message.match(/HTTP\s+(\d{3})/i);
      const provider = classifyEvalProviderStatus(
        httpMatch
          ? { status: Number(httpMatch[1]), message, model: meta.model }
          : { code: "unavailable", message, model: meta.model }
      );
      error.provider = provider;
      throw error;
    }
  };
  const emitDreamAssessment = (assessment, { force = false } = {}) => {
    if (!assessment || !meta.agentId) return false;
    if (!clientEventFamilies.has(DREAM_EVENT_FAMILY)) return false;
    const dreamId = dreamIdFor(assessment);
    if (assessment.recommended) {
      const stored = persistDreamRecommendation(bridgeRoot, assessment, {
        dreamId,
      });
      if (!stored.ok) {
        emit(EVENTS.DREAM_BLOCKED, {
          dream_id: dreamId,
          employee_id: meta.agentId,
          reason: stored.reason || "recommendation_not_persisted",
          blockers: ["recommendation_not_persisted"],
        });
        return false;
      }
      if (!emittedDreamRecommendations.has(dreamId) || force) {
        emit(EVENTS.DREAM_RECOMMENDED, {
          dream_id: dreamId,
          employee_id: meta.agentId,
          base_memory_hash: assessment.base_memory_hash,
          trigger_reasons: assessment.trigger_reasons,
          metrics: assessment.metrics,
          skill_signals: assessment.skill_signals,
          curation: assessment.curation,
          activation: assessment.activation,
          estimated_cost_usd: assessment.cost.estimated_usd,
          estimated_input_tokens: assessment.cost.estimated_input_tokens,
          estimated_output_tokens: assessment.cost.estimated_output_tokens,
          generation_available: dreamGenerationAvailable,
        });
        emittedDreamRecommendations.add(dreamId);
      }
      return true;
    }
    if (force) {
      emit(EVENTS.DREAM_BLOCKED, {
        dream_id: dreamId,
        employee_id: meta.agentId,
        reason: "dream_not_recommended",
        blockers: assessment.curation.blockers,
        trigger_reasons: assessment.trigger_reasons,
        metrics: assessment.metrics,
        skill_signals: assessment.skill_signals,
      });
    }
    return false;
  };
  const refreshDreamAssessment = ({
    manualTrigger = false,
    force = false,
  } = {}) => {
    if (!meta.agentId) return false;
    dreamAssessment = assessDreamFromWorkspace(
      bridgeRoot,
      meta.agentId,
      dreamOptions({ manualTrigger })
    );
    return emitDreamAssessment(dreamAssessment, { force });
  };
  const emitDreamMorningReport = () => {
    if (!meta.agentId || !clientEventFamilies.has(DREAM_EVENT_FAMILY)) {
      return false;
    }
    const projected = buildDreamMorningReport(bridgeRoot, meta.agentId);
    if (!projected.ok) return false;
    emit(EVENTS.DREAM_MORNING_REPORT, projected.report);
    return true;
  };
  const projectGrowthCycle = (record, type, extra = {}) => {
    if (!record || !meta.agentId) return false;
    currentGrowthCycleId = record.cycle_id;
    if (record.task_run_id) {
      growthCyclesByTaskRun.set(record.task_run_id, record.cycle_id);
    }
    return emit(type, {
      dream_id: record.dream_id,
      employee_id: record.employee_id,
      cycle_id: record.cycle_id,
      kind: record.kind,
      state: record.state,
      goal: record.goal,
      plan_hash: record.plan_hash,
      task_run_id: record.task_run_id,
      outcome: record.outcome,
      ...extra,
    });
  };
  const recommendGrowth = (dreamId, kind) => {
    const taskTemplate = String(
      meta.firstTask ||
        (kind === "dream_revision"
          ? "复核被拒绝的 Dream 候选，逐项修正来源、证据与安全边界后重新提交。"
          : "执行下一项与员工职责一致的可验证任务，并产出证据、交付物与验收记录。")
    ).trim();
    const goal =
      kind === "dream_revision"
        ? `修订 Dream ${dreamId}：${taskTemplate}`
        : `${taskTemplate}\n\n成长目标：根据最近 KPI、evaluation 与 evidence 补强弱项；必须走工具授权、证据和交付验收门禁。`;
    const created = recommendGrowthCycle(bridgeRoot, {
      employeeId: meta.agentId,
      dreamId,
      kind,
      goal,
      taskRunIds: dreamAssessment?.input?.task_run_ids || [],
      evidenceIds: dreamAssessment?.input?.evidence_ids || [],
      kpi: readKpi(bridgeRoot, meta.agentId),
      evaluation: evalResult,
    });
    projectGrowthCycle(
      created.record,
      kind === "dream_revision"
        ? EVENTS.DREAM_REVISION_TASK_CREATED
        : EVENTS.DREAM_NEXT_TASK_READY,
      {
        next_step:
          "按 p 审批后，目标会进入同一 TaskRun/runtime 管线；未审批不会执行。",
      }
    );
    return created.record;
  };
  const settleGrowthOutcome = (held, outcome, detail) => {
    if (!held?.growthCycleId || !meta.agentId) return null;
    try {
      const settled = settleGrowthCycle(
        bridgeRoot,
        meta.agentId,
        held.growthCycleId,
        outcome,
        {
          taskRunId: held.taskRunId,
          detail,
        }
      );
      projectGrowthCycle(settled.record, EVENTS.DREAM_NEXT_TASK_SETTLED);
      if (["accepted", "rejected", "revision_needed"].includes(outcome)) {
        const learned = learnGrowthCycle(
          bridgeRoot,
          meta.agentId,
          held.growthCycleId
        );
        projectGrowthCycle(learned.evaluated, EVENTS.DREAM_NEXT_TASK_EVALUATED);
        projectGrowthCycle(learned.record, EVENTS.DREAM_NEXT_TASK_LEARNED, {
          next_step:
            "KPI、evidence 与 reflection 已回写；重新评估下一轮 Dream。",
        });
        if (["rejected", "revision_needed"].includes(outcome)) {
          const revision = recommendGrowthCycle(bridgeRoot, {
            employeeId: meta.agentId,
            dreamId: `${settled.record.dream_id}-${held.taskRunId}`,
            kind: "dream_revision",
            goal: `修订被拒绝的成长任务 ${held.taskRunId}：${detail || "根据人工反馈修正交付物，并重新提交 evidence 与审批。"}`,
            taskRunIds: [
              ...settled.record.context.task_run_ids,
              held.taskRunId,
            ],
            evidenceIds: settled.record.context.evidence_ids,
            kpi: readKpi(bridgeRoot, meta.agentId),
            evaluation: evalResult,
          });
          projectGrowthCycle(
            revision.record,
            EVENTS.DREAM_REVISION_TASK_CREATED,
            {
              parent_cycle_id: held.growthCycleId,
              next_step:
                "人工审批 revision 后，修订目标会进入同一 TaskRun/runtime 管线。",
            }
          );
        } else {
          const nextRecommended = refreshDreamAssessment({
            manualTrigger: true,
            force: true,
          });
          if (nextRecommended) {
            const nextDreamId = dreamIdFor(dreamAssessment);
            const next = markGrowthNextRecommended(
              bridgeRoot,
              meta.agentId,
              held.growthCycleId,
              { nextDreamId }
            );
            projectGrowthCycle(
              next.record,
              EVENTS.DREAM_NEXT_CYCLE_RECOMMENDED,
              { next_dream_id: nextDreamId }
            );
          }
        }
      }
      return settled.record;
    } catch (error) {
      emit(EVENTS.DREAM_BLOCKED, {
        dream_id:
          inspectLatestGrowthCycle(bridgeRoot, meta.agentId).record?.dream_id ||
          dreamIdFor(dreamAssessment),
        employee_id: meta.agentId,
        reason: error?.message || String(error),
        blockers: ["growth_settlement_failed"],
      });
      return null;
    }
  };
  if (meta.agentId) {
    const latestGrowth = inspectLatestGrowthCycle(bridgeRoot, meta.agentId);
    if (latestGrowth.ok) {
      const recovered = recoverGrowthCycle(
        bridgeRoot,
        meta.agentId,
        latestGrowth.record.cycle_id,
        {
          loadTaskRun: taskRunId => loadPersistedTaskRun(bridgeRoot, taskRunId),
        }
      );
      const record = recovered.ok ? recovered.record : latestGrowth.record;
      currentGrowthCycleId = record.cycle_id;
      if (record.task_run_id) {
        growthCyclesByTaskRun.set(record.task_run_id, record.cycle_id);
      }
    }
    const pendingDream = inspectDreamJob(bridgeRoot, meta.agentId);
    if (
      pendingDream.ok &&
      ["APPROVED", "ACTIVATING"].includes(pendingDream.job.state)
    ) {
      const activated = activateDreamCandidate(
        bridgeRoot,
        meta.agentId,
        pendingDream.job.dream_id
      );
      if (activated.ok) {
        const contextRefresh = await refreshContextAfterMemoryChange({
          reason: "dream.activation_recovered",
          expectedMemoryStateHash:
            activated.activation?.activated_memory_hash ||
            pendingDream.job.candidate_memory_hash,
        });
        recoveredDreamActivation = {
          dream_id: pendingDream.job.dream_id,
          employee_id: meta.agentId,
          activation: activated.activation,
          context_refresh: contextRefresh,
          recovered: true,
        };
        refreshDreamAssessment();
      }
    }
  }
  const growthCard = buildGrowthCard({
    employeeId: meta.agentId,
    evalResult,
    provider: process.env.ZENMUX_API_KEY
      ? evalResult?.mock === false
        ? { ok: true, code: "verified" }
        : {
            code: process.env.ZENMUX_API_KEY
              ? "unavailable"
              : "missing_credentials",
            message: evalResult
              ? "Stored eval is mock-only; provider credentials are present but no certified baseline is bound."
              : "No certified eval result is bound to this employee yet.",
          }
      : { code: "missing_credentials" },
    kpi: kpiCumulative,
  });
  emit(EVENTS.SESSION_READY, {
    employee: {
      name: agentName,
      role: meta.role,
      mode: meta.mode,
      model: meta.model,
      skills: meta.skills || [],
      avatar: meta.avatar || [],
      kpi_cumulative: kpiCumulative,
      eval: evalResult,
      growth_card: growthCard,
    },
    tool_catalog: {
      version: meta.toolCatalogVersion || null,
      capabilities: meta.canonicalToolCatalog || [],
      resolution: meta.toolCatalog || [],
      declarations: meta.toolCatalog || [],
      blocking: meta.toolBlocking || [],
      degraded: meta.toolDegraded || [],
      surface: meta.toolSurface || meta.mode?.toLowerCase?.() || null,
      grant_source: meta.toolGrantSource || null,
      grant_warning: meta.toolGrantWarning || null,
    },
    growth_cycle: currentGrowthCycleId
      ? inspectLatestGrowthCycle(bridgeRoot, meta.agentId).record || null
      : null,
    context_index: {
      epoch: contextEpoch,
      memory_state_hash: activeMemoryStateHash,
      context_tokens:
        Number.isSafeInteger(meta.contextTokens) && meta.contextTokens > 0
          ? meta.contextTokens
          : null,
      ...summarizeContextIndex(meta.contextIndex),
    },
    caps: {
      ansi: true,
      parts: true,
      commands: commandCatalog(agentLoopDeps?.skillCatalog || []),
    },
  });

  // Assistant prose is accumulated per part. A tool request flushes only the current part, and a
  // later token opens a new one; no whole-turn snapshot can move prose across a tool row.

  // v0.18 C3: add a settled task's estimated cost to this month's ledger; emit a one-shot
  // budget.warning the moment cumulative spend crosses 80% of the SETTINGS cap (the ledger's
  // warned_80 flag keeps it from firing every task after that).
  const accrueSpend = (cost, settlementId) => {
    const result = recordSpend(
      bridgeRoot,
      readBudgetIndex(bridgeRoot),
      cost,
      monthKey(),
      { settlementId }
    );
    const { total, cap, crossedWarn } = result;
    if (crossedWarn) {
      emit(EVENTS.BUDGET_WARNING, {
        level: "warn",
        month: monthKey(),
        spent: total,
        cap,
      });
    }
    return result;
  };

  const failDeliverySettlement = (
    held,
    { code, reason, decision = "validation_failed", auto = false }
  ) => {
    const produced = held.usage || { prompt: 0, completion: 0 };
    const cost = estimateCost({
      promptTokens: produced.prompt,
      completionTokens: produced.completion,
    }).cost;
    emit(EVENTS.PENDING_ACTIONS, { taskRunId: held.taskRunId, actions: [] });
    if (held.artifact?.artifact_id) {
      emit(EVENTS.ARTIFACT_UPDATED, {
        id: held.artifact.artifact_id,
        taskRunId: held.taskRunId,
        patch: { status: "rejected" },
      });
    }
    emit(EVENTS.OUTCOME_CHECKED, {
      id: held.taskRunId,
      taskRunId: held.taskRunId,
      valid: false,
      deliverable: held.artifact?.path,
      gaps: [code],
      reason,
    });
    emit(EVENTS.APPROVAL_REJECTED, {
      id: held.id,
      taskRunId: held.taskRunId,
      kind: "deliverable_acceptance",
      decision: "reject",
      reason_code: decision,
      reason,
      ...(auto ? { auto: true } : {}),
    });
    emit(EVENTS.TASK_REJECTED, {
      id: held.taskRunId,
      taskRunId: held.taskRunId,
      status: "failed",
      reason,
      gaps: [code],
      usage: produced,
      est_cost: cost,
    });
    // Validation/ProofPack failures are not user outcomes and must not affect KPI. The model cost
    // still belongs in the monthly spend ledger so the budget cannot be bypassed via failed writes.
    accrueSpend(cost, held.taskRunId);
    settleGrowthOutcome(held, "failed", reason);
    removePendingDelivery(held);
    return false;
  };

  // A deliverable may be accepted from either the structured Ratatui action or the legacy digit
  // PendingAction. The settlement boundary revalidates the exact bytes and writes the ProofPack
  // before emitting any success/KPI signal.
  // M1（条件式 Dream）：chat/trial 交付验收也落一份不可变 Reflect（最小事实集），否则可信池
  // 在真实使用（用户日常以 chat trial task 为主）中永远不走字。agentId 为 null（未绑定员工）→
  // 不写，发 debug（ReflectionSchema.employee_id 是 NonEmptyString，无归属员工无法诚实归档）。
  const writeBridgeReflection = (held, { outcome, outputValid, feedback }) => {
    const employeeId = held.agentId || meta.agentId;
    if (!employeeId) {
      emit(EVENTS.DEBUG_LINE, {
        line: "reflect skipped: no agent bound to this delivery",
      });
      return;
    }
    try {
      const now = new Date().toISOString();
      const reflection = buildReflection(
        {
          id: held.taskRunId,
          employee_id: employeeId,
          status: outcome,
          output_valid: outputValid,
          artifact: held.artifact?.artifact_id || null,
          user_feedback: feedback,
          started_at: now,
          updated_at: now,
        },
        { createdAt: now }
      );
      writeReflection(held.root || bridgeRoot, reflection);
    } catch (error) {
      emit(EVENTS.DEBUG_LINE, {
        line: `reflect skipped: ${error?.message ?? error}`,
      });
    }
  };

  const completeAcceptedDelivery = (held, { auto = false } = {}) => {
    const verified = verifyHeldArtifact(held);
    if (!verified.ok) {
      return failDeliverySettlement(held, {
        code: verified.code,
        reason: verified.reason,
        decision: "artifact_invalid",
        auto,
      });
    }

    let pack = null;
    try {
      pack = (proofPackWriter || writeProofPack)(held);
    } catch {
      pack = null;
    }
    if (!pack?.path || !isNonEmptyFile(pack.path)) {
      return failDeliverySettlement(held, {
        code: "proofpack_not_persisted",
        reason: "ProofPack 落盘失败，任务不能标记为已验收",
        decision: "proofpack_failed",
        auto,
      });
    }

    const verifiedAfterProofPack = verifyHeldArtifact(held);
    if (!verifiedAfterProofPack.ok) {
      try {
        unlinkSync(resolveStatePath(pack.path, held.root, { mustExist: true }));
      } catch {}
      return failDeliverySettlement(held, {
        code: verifiedAfterProofPack.code,
        reason: verifiedAfterProofPack.reason,
        decision: "artifact_invalid",
        auto,
      });
    }

    const produced = held.usage || { prompt: 0, completion: 0 };
    const cost = estimateCost({
      promptTokens: produced.prompt,
      completionTokens: produced.completion,
    }).cost;
    const kpi = recordTaskOutcome(held.root, held.agentId || meta.agentId, {
      taskKind: "formal",
      outcome: auto ? "auto_accepted" : "accepted",
      acceptanceSource: auto ? "policy" : "user",
      cost,
      durationMs: Number.isFinite(held.createdAt)
        ? Math.max(0, Date.now() - held.createdAt)
        : 0,
      evidenceCount: held.artifact ? 1 : 0,
      skillUsage: held.skillUsage || [],
      taskRunId: held.taskRunId,
    });
    const spend = accrueSpend(cost, held.taskRunId);
    if (!kpi || spend.persisted === false) {
      pendingApproval = held;
      emit(EVENTS.DEBUG_LINE, {
        line: "验收账本未能持久化；保留恢复回执，未发出成功终态",
      });
      return false;
    }

    emit(EVENTS.PENDING_ACTIONS, { taskRunId: held.taskRunId, actions: [] });
    if (held.artifact?.artifact_id) {
      emit(EVENTS.ARTIFACT_UPDATED, {
        id: held.artifact.artifact_id,
        taskRunId: held.taskRunId,
        patch: { status: "accepted" },
      });
    }
    emit(EVENTS.OUTCOME_CHECKED, {
      id: held.taskRunId,
      taskRunId: held.taskRunId,
      valid: true,
      deliverable: held.artifact?.path,
      reason: auto ? "信任策略自动验收" : "用户已验收",
    });
    emit(EVENTS.APPROVAL_ACCEPTED, {
      id: held.id,
      taskRunId: held.taskRunId,
      proofpack: pack.path,
      kind: "deliverable_acceptance",
      ...(auto ? { auto: true } : {}),
    });
    emit(EVENTS.TASK_COMPLETED, {
      id: held.taskRunId,
      taskRunId: held.taskRunId,
      usage: produced,
      est_cost: cost,
    });
    writeBridgeReflection(held, {
      outcome: "accepted",
      outputValid: true,
      feedback: "useful",
    });
    settleGrowthOutcome(
      held,
      "accepted",
      "Human accepted the growth task delivery"
    );
    refreshDreamAssessment();
    if (!removePendingDelivery(held)) {
      emit(EVENTS.DEBUG_LINE, {
        line: "验收已提交，但恢复回执暂未清除；下次恢复将按 taskRunId 幂等重放",
      });
    }
    return true;
  };

  const completeRejectedDelivery = (
    held,
    { decision = "reject", reason = "用户拒绝交付物，等待后续修订" } = {}
  ) => {
    const produced = held.usage || { prompt: 0, completion: 0 };
    const cost = estimateCost({
      promptTokens: produced.prompt,
      completionTokens: produced.completion,
    }).cost;
    const kpi = recordTaskOutcome(held.root, held.agentId || meta.agentId, {
      taskKind: "formal",
      outcome: "rejected",
      acceptanceSource: "none",
      cost,
      durationMs: Number.isFinite(held.createdAt)
        ? Math.max(0, Date.now() - held.createdAt)
        : 0,
      evidenceCount: held.artifact ? 1 : 0,
      skillUsage: held.skillUsage || [],
      taskRunId: held.taskRunId,
    });
    const spend = accrueSpend(cost, held.taskRunId);
    if (!kpi || spend.persisted === false) {
      pendingApproval = held;
      emit(EVENTS.DEBUG_LINE, {
        line: "拒绝结算账本未能持久化；保留恢复回执，未发出终态",
      });
      return false;
    }

    emit(EVENTS.PENDING_ACTIONS, { taskRunId: held.taskRunId, actions: [] });
    if (held.artifact?.artifact_id && decision !== "artifact_deleted") {
      emit(EVENTS.ARTIFACT_UPDATED, {
        id: held.artifact.artifact_id,
        taskRunId: held.taskRunId,
        patch: { status: "rejected" },
      });
    }
    emit(EVENTS.APPROVAL_REJECTED, {
      id: held.id,
      taskRunId: held.taskRunId,
      kind: "deliverable_acceptance",
      decision: "reject",
      reason_code: decision,
      reason,
    });
    emit(EVENTS.TASK_REJECTED, {
      id: held.taskRunId,
      taskRunId: held.taskRunId,
      status: "rejected",
      reason,
      usage: produced,
      est_cost: cost,
    });
    writeBridgeReflection(held, {
      outcome: "rejected",
      outputValid: false,
      feedback: "not_useful",
    });
    settleGrowthOutcome(
      held,
      decision === "revise" ? "revision_needed" : "rejected",
      reason
    );
    refreshDreamAssessment();
    if (!removePendingDelivery(held)) {
      emit(EVENTS.DEBUG_LINE, {
        line: "拒绝已提交，但恢复回执暂未清除；下次恢复将幂等重放",
      });
    }
    return true;
  };

  // Structured approval.resolve is the Ratatui response for approval.requested. Unlike a tool
  // authorization, it settles a deliverable and therefore emits accepted/rejected, never
  // approval.resolved. Detach first so duplicate/stale actions cannot double count KPI or cost.
  const settlePendingDelivery = (
    accepted,
    {
      decision = accepted ? "accept" : "reject",
      reason = accepted ? "用户已验收" : "用户拒绝交付物，等待后续修订",
    } = {}
  ) => {
    const held = pendingApproval;
    if (!held) return false;
    const durableDecision = persistDeliveryDecision(
      held,
      accepted ? "accept" : "reject"
    );
    if (!durableDecision.ok) {
      emit(EVENTS.DEBUG_LINE, {
        line: `验收决策无法持久化：${durableDecision.reason || durableDecision.code}`,
      });
      return false;
    }
    pendingApproval = null;
    const decided = {
      ...held,
      decision: durableDecision.decision,
      decisionAt: durableDecision.decisionAt,
    };
    const settled = accepted
      ? completeAcceptedDelivery(decided)
      : completeRejectedDelivery(decided, { decision, reason });
    if (settled) queueMicrotask(() => scheduleQueuedInput());
    return settled;
  };

  const seenToolLifecycle = new Set();
  const activeToolLifecycles = new Map();
  const terminalToolLifecycles = new Set();
  const cancelActiveToolLifecycles = reason => {
    for (const [id, common] of activeToolLifecycles) {
      if (terminalToolLifecycles.has(id)) continue;
      terminalToolLifecycles.add(id);
      emitTurn(EVENTS.TOOL_CANCELLED, {
        ...common,
        summary: "工具已取消",
        code: "generation_cancelled",
        detail: String(reason || "generation cancelled"),
      });
    }
    activeToolLifecycles.clear();
  };
  const sink = {
    get signal() {
      return activeAbortController?.signal;
    },
    get taskRunId() {
      return activeTaskRunId;
    },
    onArtifactCreated: artifact => {
      if (!generationActive || !activeTaskRunId || !artifact) return;
      emitTurn(EVENTS.ARTIFACT_CREATED, {
        id: artifact.artifact_id,
        taskRunId: activeTaskRunId,
        name: artifact.name,
        kind: artifact.kind,
        path: artifact.path,
        status: artifact.status,
        bytes: artifact.bytes,
      });
    },
    onDelta: text => {
      if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return;
      const value = text ?? "";
      if (!value) return;
      if (revealPaused) postToolDeltas.push(value);
      else revealPacer?.push(value);
    },
    // v0.11 M4：真·思考增量 → thinking.delta（前端折叠成「思考」块）。不计入 turnText（思考不是交付正文）。
    onThinking: text => {
      if (text && generationActive) emitTurn(EVENTS.THINKING_DELTA, { text });
    },
    onSkillLaunched: skill => {
      if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return;
      const skillId = String(skill?.skill || skill?.name || "").trim();
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillId)) {
        activeSkillCalls.set(skillId, (activeSkillCalls.get(skillId) || 0) + 1);
      }
      emitTurn(EVENTS.SKILL_LAUNCHED, {
        id: skill?.id,
        skill: skillId,
      });
    },
    onTodoUpdated: update => {
      if (!generationActive || !activeTaskRunId) return;
      const todos = Array.isArray(update?.todos) ? update.todos : [];
      if (update?.phase === "proposed") {
        emitTurn(EVENTS.PLAN_CREATED, {
          id: `plan-${activeTaskRunId}`,
          steps: todos.map(todo => todo.content),
        });
      }
      if (update?.phase === "approved") {
        emitTurn(EVENTS.PLAN_APPROVED, { id: `plan-${activeTaskRunId}` });
      }
      todos.forEach((todo, index) => {
        const previous = lastTodoStatuses[index];
        if (todo.status === "in_progress" && previous !== "in_progress") {
          emitTurn(EVENTS.STEP_STARTED, {
            id: `todo-step-${activeTaskRunId}-${index}`,
            label: todo.content,
          });
        }
        if (todo.status === "completed" && previous !== "completed") {
          emitTurn(EVENTS.STEP_COMPLETED, {
            id: `todo-step-${activeTaskRunId}-${index}`,
            summary: todo.content,
          });
        }
      });
      lastTodoStatuses = todos.map(todo => todo.status);
      emitTurn(EVENTS.TODO_UPDATED, {
        id: `todo-${activeTaskRunId}`,
        phase: update?.phase || "updated",
        todos,
      });
    },
    onMemoryCandidate: candidate => {
      if (!generationActive || !activeTaskRunId || !candidate) return;
      emitTurn(EVENTS.MEMORY_SAVED, {
        id: candidate.id,
        pool: "candidate",
        status: candidate.status,
        category: candidate.category,
        active_memory_changed: false,
      });
    },
    askUser: question => {
      const taskRunId = activeTaskRunId;
      const id = `question-${taskRunId || "session"}-${++apprSeq}`;
      const options = Array.isArray(question?.options) ? question.options : [];
      const otherKey = String(options.length + 1);
      const pending = new Promise(resolve => {
        pendingQuestion = {
          id,
          taskRunId,
          question: question?.question,
          options,
          otherKey,
          awaitingOther: false,
          resolve,
        };
      });
      sinkEventChain = sinkEventChain
        .then(async () => {
          await revealPacer?.drain();
          if (!generationActive || pendingQuestion?.id !== id) return;
          emitTurn(EVENTS.PENDING_ACTIONS, {
            id,
            question: question?.question,
            actions: [
              ...options.map((label, index) => ({
                key: String(index + 1),
                label,
                action_type: "ask_user_option",
                payload: label,
              })),
              {
                key: otherKey,
                label: "其他（直接输入）",
                action_type: "ask_user_other",
              },
            ],
          });
        })
        .catch(error => {
          emit(EVENTS.DEBUG_LINE, {
            line: `structured question failed: ${String(error?.message || error)}`,
          });
        });
      return pending;
    },
    onToolEvent: (toolEvent = {}) => {
      if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return;
      const queuedToolEvent = { ...toolEvent };
      const boundaryPacer =
        queuedToolEvent.phase === "requested" ? revealPacer : null;
      if (boundaryPacer) revealPaused = true;
      sinkEventChain = sinkEventChain
        .then(async () => {
          if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return;
          if (queuedToolEvent.phase === "requested")
            await boundaryPacer?.drain();
          if (!generationActive || terminalTaskIds.has(activeTaskRunId)) return;
          const id = queuedToolEvent.id || `tool${++toolSeq}`;
          const tool =
            queuedToolEvent.toolName || queuedToolEvent.tool || "unknown";
          const phase = queuedToolEvent.phase;
          const rawDetail =
            queuedToolEvent.detail ??
            queuedToolEvent.output ??
            queuedToolEvent.result ??
            queuedToolEvent.error ??
            "";
          const detailResult = truncateToolDetail(rawDetail);
          const common = {
            id,
            tool,
            name: queuedToolEvent.name || tool,
            capability: queuedToolEvent.decision?.capability,
            capabilities: queuedToolEvent.decision?.capabilities,
            args: queuedToolEvent.args || {},
            args_summary: queuedToolEvent.args_summary,
            result_summary: queuedToolEvent.result_summary,
            label:
              queuedToolEvent.label ||
              queuedToolEvent.action ||
              queuedToolEvent.summary ||
              tool,
            debug_ref: queuedToolEvent.debug_ref,
            decision: queuedToolEvent.decision?.decision,
            decision_source: queuedToolEvent.decision?.decision_source,
            permission_level: queuedToolEvent.decision?.level,
            started_at: queuedToolEvent.started_at,
            ended_at: queuedToolEvent.ended_at,
            elapsed_ms: queuedToolEvent.elapsed_ms,
          };
          if (phase === "requested") {
            if (terminalToolLifecycles.has(id)) return;
            const current = activeToolLifecycles.get(id);
            if (current?.phase === "requested" || current?.phase === "running")
              return;
            flushAssistantPart();
            seenToolLifecycle.add(id);
            activeToolLifecycles.set(id, { phase, ...common });
            emitTurn(EVENTS.TOOL_REQUESTED, common);
            if (revealPacer === boundaryPacer) {
              revealPacer = createRevealPacer({ emit: emitRevealedDelta });
            }
            revealPaused = false;
            for (const delta of postToolDeltas.splice(0))
              revealPacer?.push(delta);
            return;
          }
          if (phase === "running") {
            if (terminalToolLifecycles.has(id)) return;
            if (activeToolLifecycles.get(id)?.phase === "running") return;
            seenToolLifecycle.add(id);
            activeToolLifecycles.set(id, { phase, ...common });
            emitTurn(EVENTS.TOOL_RUNNING, common);
            return;
          }
          const terminalType = {
            succeeded: EVENTS.TOOL_SUCCEEDED,
            failed: EVENTS.TOOL_FAILED,
            blocked: EVENTS.TOOL_BLOCKED,
            cancelled: EVENTS.TOOL_CANCELLED,
          }[phase];
          if (terminalType) {
            if (terminalToolLifecycles.has(id)) return;
            terminalToolLifecycles.add(id);
            activeToolLifecycles.delete(id);
            seenToolLifecycle.add(id);
            emitTurn(terminalType, {
              ...common,
              summary:
                queuedToolEvent.result_summary ||
                queuedToolEvent.summary ||
                queuedToolEvent.action ||
                tool,
              code: queuedToolEvent.code,
              detail: detailResult.detail,
              ...(detailResult.truncated
                ? {
                    truncated: true,
                    detail_original_chars: detailResult.originalChars,
                  }
                : {}),
            });
          }
        })
        .catch(error => {
          revealPaused = false;
          postToolDeltas = [];
          emit(EVENTS.DEBUG_LINE, {
            line: `tool event pacing failed: ${String(error?.message || error)}`,
          });
        });
    },
    // Backward-compatible adapter for injected/older agentLoop implementations that only expose
    // the settled audit record. The current runtime emits onToolEvent and is therefore skipped.
    onInvocation: (inv = {}) => {
      const knownId = inv.call_id || inv.id;
      if (knownId && seenToolLifecycle.has(knownId)) return;
      const id = knownId || `tool${++toolSeq}`;
      const tool = inv.toolName || inv.tool_name || "unknown";
      const args = inv.args || {};
      const detail =
        inv.output ??
        inv.result ??
        inv.detail ??
        inv.output_summary ??
        inv.error ??
        "";
      const phase =
        inv.status === "blocked"
          ? "blocked"
          : inv.status === "error"
            ? "failed"
            : inv.status === "cancelled"
              ? "cancelled"
              : "succeeded";
      const requestedPresentation = toolEventPresentation({
        name: tool,
        args,
        phase: "requested",
      });
      if (!requestedPresentation.args_summary && (inv.line || inv.action)) {
        requestedPresentation.label = inv.line || inv.action;
      }
      sink.onToolEvent({
        id,
        toolName: tool,
        args,
        phase: "requested",
        ...requestedPresentation,
      });
      sink.onToolEvent({
        id,
        toolName: tool,
        args,
        phase,
        ...toolEventPresentation({
          name: tool,
          args,
          output: detail,
          confirmed: phase === "blocked" ? false : undefined,
          phase,
          decision: inv.decision,
        }),
        detail,
        code: inv.code,
      });
    },
    onUsage: u => {
      if (!u) return;
      usageAcc.prompt += u.prompt_tokens || 0;
      usageAcc.completion += u.completion_tokens || 0;
      emitTurn(EVENTS.TOKEN_USAGE, {
        prompt: u.prompt_tokens,
        completion: u.completion_tokens,
      });
    },
    // Protected-tool approval over the process boundary. A session lease may satisfy a repeated,
    // narrowly-scoped workspace request only after the gateway has independently returned confirm.
    confirm: (msg, info = {}) => {
      const taskRunId = activeTaskRunId;
      const id = `tool-appr-${taskRunId || "session"}-${++apprSeq}`;
      const kind = info.kind || "tool_authorization";
      const request = {
        tool: info.tool || info.toolName,
        args: info.args,
        permission: {
          decision: "confirm",
          scope: info.scope,
          level: info.level,
        },
        root: bridgeRoot,
        kind,
      };
      const sessionLease = proposeSessionPermissionLease(request);
      const matchedLease = [...sessionPermissionLeases.values()].find(lease =>
        sessionPermissionLeaseMatches(lease, request)
      );
      if (matchedLease) {
        sinkEventChain = sinkEventChain
          .then(async () => {
            await revealPacer?.drain();
            if (!generationActive) return false;
            const common = {
              id,
              kind,
              tool: info.tool || info.toolName,
              taskRunId,
              scope: info.scope,
              session_lease: matchedLease,
              auto: true,
              decision_source: "session_permission_lease",
            };
            // Preserve an auditable canonical approval pair without leaving a human modal open.
            emitTurn(EVENTS.APPROVAL_REQUIRED, {
              ...common,
              reason: typeof msg === "string" ? msg : info.reason,
              choices: ["allow_session", "deny"],
            });
            emitTurn(EVENTS.APPROVAL_RESOLVED, {
              ...common,
              decision: "allow_session",
            });
            return true;
          })
          .catch(error => {
            emit(EVENTS.DEBUG_LINE, {
              line: `session approval pacing failed: ${String(error?.message || error)}`,
            });
            return false;
          });
        return sinkEventChain;
      }
      const pending = new Promise(resolve => {
        pendingConfirm = {
          id,
          taskRunId,
          resolve,
          kind,
          sessionLease,
        };
      });
      sinkEventChain = sinkEventChain
        .then(async () => {
          await revealPacer?.drain();
          if (!generationActive || pendingConfirm?.id !== id) return;
          emitTurn(EVENTS.APPROVAL_REQUIRED, {
            id,
            // Preserve the approval kind (e.g. "plan_approval" from todo_write) instead of
            // flattening everything to tool_authorization — consumers (eval harness, TUI
            // approval bar) must be able to tell a task-plan review from a tool grant.
            kind,
            tool: info.tool || info.toolName,
            reason: typeof msg === "string" ? msg : info.reason,
            scope: info.scope,
            choices: sessionLease
              ? ["allow", "allow_session", "deny"]
              : ["allow", "deny"],
            ...(sessionLease ? { session_lease: sessionLease } : {}),
          });
        })
        .catch(error => {
          emit(EVENTS.DEBUG_LINE, {
            line: `approval pacing failed: ${String(error?.message || error)}`,
          });
        });
      return pending;
    },
  };

  const runTurn = buildRunTurn({
    agentLoop,
    agentLoopDeps,
    history,
    saveSession,
    root: bridgeRoot,
  });
  const runQuickUtility = buildQuickUtilityTurn({ agentLoop, agentLoopDeps });
  const actionContext = () => ({
    emit,
    resolveArtifact: id => artifactsById.get(id) || null,
    root: bridgeRoot,
    ...artifactActionDeps,
  });
  const safelyApplyUserAction = action => {
    try {
      return applyUserAction(action, actionContext());
    } catch (error) {
      emit(EVENTS.DEBUG_LINE, {
        line: `user action ${action?.type || "unknown"} failed: ${String(error?.message || error)}`,
      });
      return {
        handled: true,
        ok: false,
        error: String(error?.message || error),
      };
    }
  };

  // If the previous engine process lost stdin while a deliverable was waiting, restore the exact
  // task/artifact/fingerprint before accepting any new work. Recovery is scoped by agent id so two
  // employees sharing a workspace cannot inherit each other's approval.
  if (meta.agentId) {
    const recovery = readPendingDelivery(bridgeRoot, meta.agentId);
    if (!recovery.ok) {
      const recoveryTaskId = `approval-recovery-${randomUUID()}`;
      emit(EVENTS.TASK_STARTED, {
        id: recoveryTaskId,
        taskRunId: recoveryTaskId,
        title: "恢复待验收任务失败",
        mode: "Task",
        resumed: true,
      });
      emit(EVENTS.TASK_BLOCKED, {
        id: recoveryTaskId,
        taskRunId: recoveryTaskId,
        status: "approval_recovery_failed",
        reason: `${recovery.code}: ${recovery.reason}`,
      });
    }
    const restored = recovery.ok ? recovery.pending : null;
    if (restored) {
      const verified = verifyHeldArtifact(restored);
      if (verified.ok) {
        emit(EVENTS.TASK_STARTED, {
          id: restored.taskRunId,
          taskRunId: restored.taskRunId,
          title: restored.goal || "恢复待验收任务",
          mode: "Task",
          resumed: true,
        });
        if (restored.artifact?.artifact_id) {
          emit(EVENTS.ARTIFACT_CREATED, {
            id: restored.artifact.artifact_id,
            taskRunId: restored.taskRunId,
            name: restored.artifact.name,
            kind: restored.artifact.kind,
            path: restored.artifact.path,
            status: restored.artifact.status || "ready",
            bytes: restored.fingerprint?.bytes,
            sha256: restored.fingerprint?.sha256,
            mtimeMs: restored.fingerprint?.mtimeMs,
          });
        }
        emit(EVENTS.OUTCOME_CHECKED, {
          id: restored.taskRunId,
          taskRunId: restored.taskRunId,
          valid: true,
          deliverable: restored.artifact?.path,
          reason: "已恢复中断的待验收交付",
        });
        emit(EVENTS.PENDING_ACTIONS, {
          taskRunId: restored.taskRunId,
          actions: restored.decision ? [] : pendingActionsForHeld(restored),
        });
        if (restored.decision === "accept") {
          completeAcceptedDelivery(restored, {
            auto: Boolean(restored.auto),
          });
        } else if (restored.decision === "reject") {
          completeRejectedDelivery(restored, {
            decision: "reject",
            reason: "已恢复并提交用户的拒绝决策",
          });
        } else {
          pendingApproval = restored;
          emitApprovalRequested(emit, restored, { restored: true });
        }
      } else {
        emit(EVENTS.TASK_STARTED, {
          id: restored.taskRunId,
          taskRunId: restored.taskRunId,
          title: restored.goal || "恢复待验收任务",
          mode: "Task",
          resumed: true,
        });
        failDeliverySettlement(restored, {
          code: verified.code,
          reason: `待恢复交付已失效：${verified.reason}`,
          decision: "restore_failed",
        });
      }
    }
  }

  const rl = createInterface({ input });

  const interruptPendingWork = () => {
    if (closeTerminalEmitted) return;
    closeTerminalEmitted = true;
    closing = true;
    queuedInputs.length = 0;
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort(closeReason);
    }
    // Close every visible invocation before the generation/task terminals. The underlying
    // operation receives the same AbortSignal; this eager event makes the transcript truthful
    // even while Windows is still reaping a child-process tree.
    cancelActiveToolLifecycles(closeReason);

    if (pendingQuestion) {
      const held = pendingQuestion;
      pendingQuestion = null;
      cancelGenerationNow(EVENTS.GENERATION_CANCELLED, {
        reason: "等待用户回答期间会话已结束",
      });
      emit(EVENTS.PENDING_ACTIONS, {
        taskRunId: held.taskRunId,
        actions: [],
      });
      if (held.taskRunId) {
        emitTurn(EVENTS.TASK_BLOCKED, {
          id: held.taskRunId,
          status: "question_interrupted",
          reason: "等待用户回答期间输入通道关闭，任务已安全阻塞",
        });
      }
      held.resolve("（输入通道已关闭，未收到用户回答）");
      return;
    }

    if (pendingConfirm) {
      const held = pendingConfirm;
      pendingConfirm = null;
      cancelGenerationNow(EVENTS.GENERATION_CANCELLED, {
        reason: "工具授权等待期间会话已结束",
      });
      emit(EVENTS.APPROVAL_RESOLVED, {
        id: held.id,
        taskRunId: held.taskRunId,
        kind: held.kind || "tool_authorization",
        decision: "deny",
        reason: closeReason,
      });
      if (held.taskRunId) {
        emitTurn(EVENTS.TASK_BLOCKED, {
          id: held.taskRunId,
          status: "approval_interrupted",
          reason: "工具授权等待期间输入通道关闭，任务已安全阻塞",
        });
      }
      held.resolve(false);
      return;
    }

    if (pendingApproval) {
      const held = pendingApproval;
      pendingApproval = null;
      // Unexpected EOF is recoverable; an explicit /exit is an intentional cancellation and
      // must not surprise the next session with a resurrected modal.
      const recoverable = Boolean(
        closeReason === "input_eof" &&
        meta.agentId &&
        persistPendingDelivery(held).ok
      );
      emit(EVENTS.APPROVAL_REJECTED, {
        id: held.id,
        taskRunId: held.taskRunId,
        kind: "deliverable_acceptance",
        decision: "reject",
        reason_code: "interrupted",
        recoverable,
        reason: closeReason,
      });
      if (recoverable) {
        emit(EVENTS.TASK_BLOCKED, {
          id: held.taskRunId,
          taskRunId: held.taskRunId,
          status: "approval_interrupted",
          recoverable: true,
          reason: "验收输入中断，待验收状态已持久化，可在下次启动恢复",
        });
      } else {
        removePendingDelivery(held);
        emit(EVENTS.TASK_REJECTED, {
          id: held.taskRunId,
          taskRunId: held.taskRunId,
          status: "rejected",
          reason: "验收输入中断且无法持久化恢复状态",
        });
      }
      return;
    }

    if (busy && activeTaskRunId) {
      cancelGenerationNow(EVENTS.GENERATION_CANCELLED, {
        reason: "输入通道关闭，生成已取消",
      });
      emitTurn(EVENTS.TASK_BLOCKED, {
        id: activeTaskRunId,
        status: "input_interrupted",
        reason: "输入通道关闭，运行中的任务已阻塞",
      });
      settleGrowthOutcome(
        {
          taskRunId: activeTaskRunId,
          growthCycleId: growthCyclesByTaskRun.get(activeTaskRunId) || null,
        },
        "cancelled",
        "Input channel closed while the growth task was running"
      );
      busy = false;
    }
  };
  rl.once("close", interruptPendingWork);
  const closedPromise = new Promise(resolve => rl.once("close", resolve));
  let queueScheduled = false;
  let handleLine;
  const scheduleQueuedInput = () => {
    if (
      queueScheduled ||
      closing ||
      busy ||
      pendingApproval ||
      pendingConfirm ||
      pendingQuestion ||
      queuedInputs.length === 0
    ) {
      return false;
    }
    const queued = queuedInputs.shift();
    queueScheduled = true;
    queueMicrotask(() => {
      queueScheduled = false;
      void handleLine(queued.raw, { fromQueue: true }).catch(error => {
        emit(EVENTS.DEBUG_LINE, {
          line: `queued input failed: ${String(error?.message || error)}`,
        });
        scheduleQueuedInput();
      });
    });
    return true;
  };

  handleLine = async (raw, { fromQueue = false } = {}) => {
    let action;
    try {
      action = parseUserActionLine(raw);
    } catch (e) {
      emit(EVENTS.DEBUG_LINE, {
        line: `user action parse error: ${String((e && e.message) || e)}`,
      });
      return;
    }
    let text = (action?.data?.text ?? String(raw)).trim();

    if (text === "/exit" || text === ":q") {
      closeReason = "user_exit";
      rl.close();
      return;
    }

    if (action?.type === "client.ready") {
      const result = safelyApplyUserAction(action);
      for (const family of result.eventFamilies || [])
        clientEventFamilies.add(family);
      refreshDreamAssessment();
      emitDreamMorningReport();
      if (recoveredDreamActivation) {
        emit(EVENTS.DREAM_ACTIVATED, recoveredDreamActivation);
      }
      if (currentGrowthCycleId && meta.agentId) {
        const latest = inspectLatestGrowthCycle(bridgeRoot, meta.agentId);
        if (latest.ok) {
          const type =
            latest.record.kind === "dream_revision"
              ? EVENTS.DREAM_REVISION_TASK_CREATED
              : EVENTS.DREAM_NEXT_TASK_READY;
          projectGrowthCycle(latest.record, type, {
            recovered: true,
            next_step:
              latest.record.state === "RECOMMENDED" ||
              latest.record.state === "REVISION_REQUIRED"
                ? "按 p 审批后进入同一 TaskRun/runtime 管线。"
                : "已从持久化 growth cycle 恢复。",
          });
        }
      }
      return;
    }

    // Layout negotiation is control-plane input: never queue it behind a task or approval.
    if (action?.type === "viewport.resize") {
      setContentWidth(action.data?.content_width);
      return;
    }

    if (action?.type === "generation.cancel") {
      if (!busy || !activeTaskRunId) return;
      const reason = String(action.data?.reason || "用户取消生成");
      const taskRunId = activeTaskRunId;
      cancelledTaskIds.add(taskRunId);
      if (activeAbortController && !activeAbortController.signal.aborted) {
        activeAbortController.abort(reason);
      }
      cancelActiveToolLifecycles(reason);
      if (pendingConfirm) {
        const held = pendingConfirm;
        pendingConfirm = null;
        emit(EVENTS.APPROVAL_RESOLVED, {
          id: held.id,
          taskRunId: held.taskRunId,
          kind: held.kind || "tool_authorization",
          decision: "deny",
          reason,
        });
        held.resolve(false);
      }
      if (pendingQuestion) {
        const held = pendingQuestion;
        pendingQuestion = null;
        emit(EVENTS.PENDING_ACTIONS, { taskRunId, actions: [] });
        held.resolve("（用户取消提问）");
      }
      cancelGenerationNow(EVENTS.GENERATION_CANCELLED, { reason });
      emitTurn(EVENTS.TASK_BLOCKED, {
        id: taskRunId,
        status: "user_cancelled",
        reason,
      });
      settleGrowthOutcome(
        {
          taskRunId,
          growthCycleId: growthCyclesByTaskRun.get(taskRunId) || null,
        },
        "cancelled",
        reason
      );
      return;
    }

    if (action?.type?.startsWith("dream.")) {
      const result = safelyApplyUserAction(action);
      let growthTaskText = null;
      if (!clientEventFamilies.has(DREAM_EVENT_FAMILY)) return;
      if (!dreamAssessment || !meta.agentId) {
        emit(EVENTS.DEBUG_LINE, {
          line: "dream action ignored: no employee bound",
        });
        return;
      }
      if (
        result.dreamAction === "next_task_approve" &&
        (busy || pendingApproval || pendingConfirm || pendingQuestion)
      ) {
        emit(EVENTS.DREAM_BLOCKED, {
          dream_id: result.dreamId || dreamIdFor(dreamAssessment),
          employee_id: meta.agentId,
          reason: "workbench_gate_busy",
          blockers: ["active_task_or_approval"],
          next_step: "先完成当前任务、工具授权或交付验收，再启动成长任务。",
        });
        return;
      }
      if (dreamBusy) {
        emit(EVENTS.DREAM_BLOCKED, {
          dream_id: result.dreamId || dreamIdFor(dreamAssessment),
          employee_id: meta.agentId,
          reason: "dream_action_in_progress",
          blockers: ["dream_busy"],
        });
        return;
      }
      dreamBusy = true;
      try {
        if (result.dreamAction === "run") {
          refreshDreamAssessment({ manualTrigger: true, force: true });
          if (!dreamAssessment.recommended) return;
          const dreamId = result.dreamId || dreamIdFor(dreamAssessment);
          if (!dreamGenerationAvailable) {
            emit(EVENTS.DREAM_BLOCKED, {
              dream_id: dreamId,
              employee_id: meta.agentId,
              reason: "real_dream_curator_unavailable",
              blockers: ["real_curator_unavailable"],
              next_step: "配置真实模型凭据后重试；不会使用启发式或 MOCK 候选",
            });
            return;
          }
          emit(EVENTS.DREAM_STARTED, {
            dream_id: dreamId,
            employee_id: meta.agentId,
            base_memory_hash: dreamAssessment.base_memory_hash,
            model: meta.model || agentLoopDeps.model,
          });
          const generated = await generateDreamCandidate(
            bridgeRoot,
            dreamAssessment,
            {
              dreamId,
              curate: curateDream,
              modelId: String(meta.model || agentLoopDeps.model),
              baseline: readEvalResult(bridgeRoot, meta.agentId),
              evaluateCandidate: evaluateDreamCandidate,
            }
          );
          if (!generated.ok) {
            emit(EVENTS.DREAM_VALIDATION_FAILED, {
              dream_id: dreamId,
              employee_id: meta.agentId,
              reason: generated.reason || "candidate_generation_failed",
              validation: generated.validation || null,
              blockers: generated.validation?.activation?.blockers || [
                "candidate_generation_failed",
              ],
            });
            return;
          }
          emit(EVENTS.DREAM_CANDIDATE_READY, {
            dream_id: dreamId,
            employee_id: meta.agentId,
            state: generated.job.state,
            summary: generated.summary,
            base_memory_hash: generated.candidate.base_memory_hash,
            candidate_memory_hash: generated.candidate.candidate_memory_hash,
            diff: generated.diff,
            validation: generated.validation,
          });
        } else if (result.dreamAction === "inspect") {
          const inspected = inspectDreamJob(
            bridgeRoot,
            meta.agentId,
            result.dreamId
          );
          if (!inspected.ok) {
            refreshDreamAssessment({ force: true });
            return;
          }
          const payload = {
            dream_id: inspected.job.dream_id,
            employee_id: meta.agentId,
            state: inspected.job.state,
            base_memory_hash: inspected.job.base_memory_hash,
            candidate_memory_hash: inspected.job.candidate_memory_hash,
            diff: inspected.diff,
            validation: inspected.validation,
          };
          const type =
            {
              REVIEW_REQUIRED: EVENTS.DREAM_CANDIDATE_READY,
              ACTIVE: EVENTS.DREAM_ACTIVATED,
              ROLLED_BACK: EVENTS.DREAM_ROLLED_BACK,
              REJECTED: EVENTS.DREAM_REJECTED,
              FAILED: EVENTS.DREAM_VALIDATION_FAILED,
            }[inspected.job.state] || EVENTS.DREAM_RECOMMENDED;
          emit(type, payload);
        } else if (result.dreamAction === "approve") {
          const inspected = inspectDreamJob(
            bridgeRoot,
            meta.agentId,
            result.dreamId
          );
          const dreamId = inspected.ok
            ? inspected.job.dream_id
            : result.dreamId;
          const approved = dreamId
            ? approveDreamCandidate(bridgeRoot, meta.agentId, dreamId)
            : { ok: false, reason: inspected.reason || "dream_job_not_found" };
          if (!approved.ok) {
            emit(EVENTS.DREAM_BLOCKED, {
              dream_id: dreamId || dreamIdFor(dreamAssessment),
              employee_id: meta.agentId,
              reason: approved.reason,
              blockers: approved.blockers || ["approval_failed"],
            });
            return;
          }
          emit(EVENTS.DREAM_APPROVED, {
            dream_id: dreamId,
            employee_id: meta.agentId,
            approval: approved.approval,
          });
          const activated = activateDreamCandidate(
            bridgeRoot,
            meta.agentId,
            dreamId
          );
          if (!activated.ok) {
            emit(EVENTS.DREAM_BLOCKED, {
              dream_id: dreamId,
              employee_id: meta.agentId,
              reason: activated.reason,
              blockers: activated.blockers || ["activation_failed"],
              next_step: activated.next_step,
            });
            return;
          }
          const contextRefresh = await refreshContextAfterMemoryChange({
            reason: EVENTS.DREAM_ACTIVATED,
            expectedMemoryStateHash:
              activated.activation?.activated_memory_hash,
          });
          emit(EVENTS.DREAM_ACTIVATED, {
            dream_id: dreamId,
            employee_id: meta.agentId,
            activation: activated.activation,
            context_refresh: contextRefresh,
          });
          recommendGrowth(dreamId, "next_task");
        } else if (result.dreamAction === "reject") {
          const inspected = inspectDreamJob(
            bridgeRoot,
            meta.agentId,
            result.dreamId
          );
          const dreamId = inspected.ok
            ? inspected.job.dream_id
            : result.dreamId;
          const rejected = dreamId
            ? rejectDreamCandidate(bridgeRoot, meta.agentId, dreamId)
            : { ok: false, reason: inspected.reason || "dream_job_not_found" };
          emit(rejected.ok ? EVENTS.DREAM_REJECTED : EVENTS.DREAM_BLOCKED, {
            dream_id: dreamId || dreamIdFor(dreamAssessment),
            employee_id: meta.agentId,
            ...(rejected.ok
              ? { approval: rejected.approval }
              : { reason: rejected.reason, blockers: ["rejection_failed"] }),
          });
          if (rejected.ok) recommendGrowth(dreamId, "dream_revision");
        } else if (result.dreamAction === "next_task_approve") {
          const latest = inspectLatestGrowthCycle(bridgeRoot, meta.agentId);
          if (
            !latest.ok ||
            ![
              "RECOMMENDED",
              "REVISION_REQUIRED",
              "APPROVED",
              "QUEUED",
            ].includes(latest.record.state)
          ) {
            emit(EVENTS.DREAM_BLOCKED, {
              dream_id: latest.record?.dream_id || dreamIdFor(dreamAssessment),
              employee_id: meta.agentId,
              reason: latest.ok
                ? `growth cycle is ${latest.record.state}`
                : latest.reason,
              blockers: ["growth_task_not_approvable"],
            });
            return;
          }
          const approved = approveGrowthCycle(
            bridgeRoot,
            meta.agentId,
            latest.record.cycle_id
          );
          projectGrowthCycle(approved.record, EVENTS.DREAM_NEXT_TASK_APPROVED);
          const queued = queueGrowthCycle(
            bridgeRoot,
            meta.agentId,
            latest.record.cycle_id
          );
          projectGrowthCycle(queued.record, EVENTS.DREAM_NEXT_TASK_QUEUED);
          queuedGrowthCycle = queued.record;
          growthTaskText = queued.record.goal;
        } else if (result.dreamAction === "rollback") {
          const inspected = inspectDreamJob(
            bridgeRoot,
            meta.agentId,
            result.dreamId
          );
          const dreamId = inspected.ok
            ? inspected.job.dream_id
            : result.dreamId;
          const rolledBack = dreamId
            ? rollbackDreamActivation(bridgeRoot, meta.agentId, dreamId)
            : { ok: false, reason: inspected.reason || "dream_job_not_found" };
          const contextRefresh = rolledBack.ok
            ? await refreshContextAfterMemoryChange({
                reason: EVENTS.DREAM_ROLLED_BACK,
                expectedMemoryStateHash:
                  rolledBack.activation?.previous_memory_hash,
              })
            : null;
          emit(
            rolledBack.ok ? EVENTS.DREAM_ROLLED_BACK : EVENTS.DREAM_BLOCKED,
            {
              dream_id: dreamId || dreamIdFor(dreamAssessment),
              employee_id: meta.agentId,
              ...(rolledBack.ok
                ? {
                    activation: rolledBack.activation,
                    rollback: rolledBack.rollback,
                    context_refresh: contextRefresh,
                  }
                : {
                    reason: rolledBack.reason,
                    blockers: rolledBack.blockers || ["rollback_failed"],
                  }),
            }
          );
        }
      } finally {
        emitDreamMorningReport();
        dreamBusy = false;
      }
      if (growthTaskText) {
        action = {
          type: "user.message",
          data: { text: growthTaskText, refs: [] },
        };
        text = growthTaskText;
      } else {
        return;
      }
    }

    // ask_user reuses the same PendingAction digit transport. Choosing “other” keeps the model
    // paused until the next free-form user.message arrives; no answer is fabricated locally.
    if (pendingQuestion) {
      const held = pendingQuestion;
      const key =
        action?.type === "pending.run" ? String(action.data?.key || "") : "";
      if (key === held.otherKey) {
        held.awaitingOther = true;
        emit(EVENTS.PENDING_ACTIONS, {
          taskRunId: held.taskRunId,
          actions: [],
        });
        return;
      }
      const index = Number(key) - 1;
      const option = Number.isInteger(index) ? held.options[index] : null;
      const freeform =
        action?.type === "user.message"
          ? String(action.data?.text || "").trim()
          : "";
      // Leaked control frames (e.g. viewport.resize) are degraded to user.message by the
      // parser; they must never be treated as the user's answer to a structured question.
      if (!option && freeform.startsWith("{")) {
        try {
          const maybeFrame = JSON.parse(freeform);
          if (maybeFrame && typeof maybeFrame.type === "string") {
            emit(EVENTS.DEBUG_LINE, {
              line: `ignored leaked control frame as ask_user answer: ${freeform.slice(0, 80)}`,
            });
            return;
          }
        } catch {
          // Not valid JSON — treat as a normal free-form answer.
        }
      }
      const answer = option || freeform;
      if (!answer) return;
      pendingQuestion = null;
      emit(EVENTS.PENDING_ACTIONS, {
        taskRunId: held.taskRunId,
        actions: [],
      });
      held.resolve(answer);
      return;
    }

    // while the agent awaits approval, the next line IS the a/d/y/n decision — not a new task
    if (pendingConfirm) {
      let allow;
      if (action?.type === "approval.resolve") {
        // A structured decision is correlated: a stale/wrong id must not release whichever tool
        // happens to be waiting now. Keep pendingConfirm intact so the matching response can arrive.
        if (action.data?.id !== pendingConfirm.id) return;
        const result = safelyApplyUserAction(action);
        if (result.invalidDecision) {
          emit(EVENTS.DEBUG_LINE, {
            line: `invalid approval decision for ${pendingConfirm.id}`,
          });
          return;
        }
        allow = !!result.approval;
      } else {
        // Only explicit approve/deny keys release the approval; unrecognized input
        // (e.g. leaked control frames degraded to user.message) must not auto-reject.
        const normalized = text.toLowerCase();
        const approveKeys = new Set(["a", "allow", "y", "是"]);
        const denyKeys = new Set(["r", "reject", "d", "n", "deny", "否"]);
        if (approveKeys.has(normalized)) {
          allow = true;
        } else if (denyKeys.has(normalized)) {
          allow = false;
        } else {
          emit(EVENTS.DEBUG_LINE, {
            line: `ignored unrecognized input while awaiting approval: ${text.slice(0, 80)}`,
          });
          return;
        }
      }
      const wantsSession =
        action?.type === "approval.resolve" &&
        String(action.data?.decision || "").toLowerCase() === "allow_session";
      if (wantsSession && !pendingConfirm.sessionLease) {
        emit(EVENTS.DEBUG_LINE, {
          line: `session lease is unavailable for approval ${pendingConfirm.id}`,
        });
        return;
      }
      const { id, taskRunId, resolve, kind, sessionLease } = pendingConfirm;
      pendingConfirm = null;
      if (allow && wantsSession && sessionLease) {
        const key = sessionPermissionLeaseKey(sessionLease);
        if (key) sessionPermissionLeases.set(key, sessionLease);
      }
      emit(EVENTS.APPROVAL_RESOLVED, {
        id,
        taskRunId,
        kind: kind || "tool_authorization",
        decision: allow ? (wantsSession ? "allow_session" : "allow") : "deny",
        ...(allow && wantsSession && sessionLease
          ? {
              session_lease: sessionLease,
              decision_source: "user_session_grant",
            }
          : {}),
      });
      resolve(allow);
      return;
    }

    // approval.requested is a different lifecycle from approval.required. Ratatui responds to
    // both with approval.resolve, so consume a matching deliverable decision here before the
    // generic applyUserAction path (which intentionally treats stale approvals as a no-op).
    if (action?.type === "approval.resolve") {
      if (!pendingApproval || action.data?.id !== pendingApproval.id) return;
      const result = safelyApplyUserAction(action);
      if (result.invalidDecision || result.decision === "allow_session") {
        emit(EVENTS.DEBUG_LINE, {
          line: `invalid approval decision for ${pendingApproval.id}`,
        });
        return;
      }
      settlePendingDelivery(!!result.approval);
      return;
    }

    // Legacy digit actions are control-plane input. Accept/reject settle the held task exactly
    // once; reveal executes without consuming it; revise rejects the held version and immediately
    // hands its revision prompt into a fresh correlated task.
    const pendingKey =
      action?.type === "pending.run" ? String(action.data?.key || "") : text;
    const matchedPendingAction = pendingApproval
      ? sessionPendingActions.find(candidate => candidate?.key === pendingKey)
      : null;
    if (
      matchedPendingAction?.action_type === "accept" ||
      (pendingApproval &&
        ["a", "accept", "y", "yes", "是"].includes(text.toLowerCase()))
    ) {
      settlePendingDelivery(true);
      return;
    }
    if (
      pendingApproval &&
      ["r", "reject", "d", "deny", "n", "no", "否"].includes(text.toLowerCase())
    ) {
      settlePendingDelivery(false);
      return;
    }
    if (matchedPendingAction?.action_type === "reveal") {
      safelyApplyUserAction({
        type: "artifact.reveal",
        data: {
          artifact_id:
            matchedPendingAction.artifactId ||
            pendingApproval?.artifact?.artifact_id,
        },
      });
      return;
    }

    let revisionText = null;
    if (matchedPendingAction?.action_type === "revise") {
      revisionText =
        matchedPendingAction.payload ||
        matchedPendingAction.label ||
        "请修订上一版交付物";
      settlePendingDelivery(false, {
        decision: "revise",
        reason: "用户要求修订交付物",
      });
    }

    // A renderer-agnostic bridge must not overwrite its single pending deliverable with a new task.
    // Ratatui normally enforces this with the modal; the runtime enforces it as the final boundary.
    if (pendingApproval) {
      if (
        [
          "artifact.preview",
          "artifact.reveal",
          "artifact.export",
          "artifact.delete",
        ].includes(action?.type)
      ) {
        const artifactResult = safelyApplyUserAction(action);
        if (action.type === "artifact.delete" && artifactResult.ok === true) {
          settlePendingDelivery(false, {
            decision: "artifact_deleted",
            reason: "待验收交付物已被删除",
          });
        }
      } else {
        emit(EVENTS.DEBUG_LINE, {
          line: `task blocked while approval ${pendingApproval.id} is pending`,
        });
      }
      return;
    }
    const applied = revisionText
      ? { handled: false, text: revisionText, parts: undefined }
      : safelyApplyUserAction(action);
    if (applied.handled) return;
    text = String(applied.text || "").trim();
    // v0.8 M6：结构化 parts（图片/文件附件）随本轮走 runModelTurn；routeTurn 只看 text（路由分类只认文字）。
    const messageParts = applied.parts;
    // 空消息才丢弃：纯附件（text 为空但 parts 非空）是合法的看图/读文件轮，必须放行——
    // 不能再加一条 `if (!text) return`，否则会把 parts-only 路径 dead-code 掉（附件被静默吞没）。
    if (!text && !(messageParts && messageParts.length)) return;
    // v0.8 M3: slash commands are engine-executed (they read engine state: model/history/registry),
    // NOT model turns. Intercept BEFORE task.started so a command never counts as a task, and emit
    // command.output for the front-end to display. /clear also resets the shared history + transcript.
    let userInvokedSkillIds = [];
    if (isCommand(text)) {
      const result = runCommand(text, {
        name: agentName,
        model: meta.model,
        root: bridgeRoot,
        color: true,
        permissionLeases: [...sessionPermissionLeases.values()]
          .map(sessionPermissionLeaseLabel)
          .filter(Boolean),
        skillCatalog: agentLoopDeps?.skillCatalog || [],
      });
      if (result.action?.type === "skill") {
        userInvokedSkillIds = [result.action.skill];
        text =
          String(result.action.arguments || "").trim() ||
          `请执行用户显式调用的技能 /${result.action.skill}`;
      } else {
        if (result.action?.type === "exit") {
          rl.close();
          return;
        }
        const clear = result.action?.type === "clear";
        if (clear) history.length = 0; // single source of truth: engine clears, front-end mirrors
        const clearPermissionLeases =
          result.action?.type === "permission_leases_clear";
        const clearedPermissionLeaseCount = clearPermissionLeases
          ? sessionPermissionLeases.size
          : 0;
        if (clearPermissionLeases) sessionPermissionLeases.clear();
        const switchUnavailable = result.action?.type === "switch";
        const body =
          result.text ||
          (clear
            ? "（上下文已清空）"
            : clearPermissionLeases
              ? `已撤销 ${clearedPermissionLeaseCount} 条本会话授权；后续受保护操作将重新询问。`
              : switchUnavailable
                ? "Workbench 会话不支持原地切换员工；请退出后用 crew chat <employee> 启动新会话，以便重新执行工具预检。"
                : "");
        emit(EVENTS.COMMAND_OUTPUT, {
          command: text,
          clear,
          ansi_lines: body ? renderMessage(body, { color: true }) : [],
          text: body,
        });
        return;
      }
    }
    if (busy) {
      const queued = {
        id: `input-${randomUUID()}`,
        raw: String(raw),
        text: text.slice(0, 240),
      };
      queuedInputs.push(queued);
      emitTurn(EVENTS.INPUT_QUEUED, {
        id: queued.id,
        position: queuedInputs.length,
        text: queued.text,
      });
      return;
    }
    // v0.18 C3: monthly budget enforcement. At ≥100% of the SETTINGS cap, refuse to start a NEW
    // task. A digit that matches a pending action ("1"=accept/"2"=revise/"3"=reveal) is NOT a new
    // task — it closes an existing one — so it's exempt. The refusal names the cap + points at SETTINGS.
    const isPendingActionInput =
      revisionText !== null ||
      sessionPendingActions.some(a => a && a.key === text.trim());
    const budgetIndex = readBudgetIndex(bridgeRoot);
    const spend = readSpend(bridgeRoot);
    const cap = capForBudgetIndex(budgetIndex);
    const budgetBlocksNewTask =
      spend.state === SPEND_STATE_INVALID || (cap > 0 && spend.total >= cap);
    busy = true;
    // v0.15 P0-1: snapshot the pending actions BEFORE task.started wipes them. The digit the user
    // pressed matches against what was on screen; task.started clears the list for the NEXT turn.
    const pendingSnapshot = sessionPendingActions;
    const taskRunId = `task-${randomUUID()}`;
    const root = bridgeRoot;
    const turnId = "turn" + ++turnSeq;
    activeTaskRunId = taskRunId;
    activeTurnId = turnId;
    activeSkillCalls.clear();
    activeAbortController = new AbortController();
    generationActive = true;
    revealPacer?.cancel();
    revealPacer = createRevealPacer({ emit: emitRevealedDelta });
    revealPaused = false;
    postToolDeltas = [];
    sinkEventChain = Promise.resolve();
    seenToolLifecycle.clear();
    activeToolLifecycles.clear();
    terminalToolLifecycles.clear();
    lastTodoStatuses = [];
    partText = "";
    activePartId = null;
    // 纯附件轮 text 为空——给个占位标题，避免任务标题空白。
    emitTurn(EVENTS.TASK_STARTED, {
      id: taskRunId,
      title: text || "（附件消息）",
      mode: meta.mode,
      ...(fromQueue ? { queued: true } : {}),
    });
    emitTurn(EVENTS.GENERATION_STARTED, {
      id: `${turnId}-generation`,
    });
    usageAcc = { prompt: 0, completion: 0 }; // 每轮重置 token 计量，ProofPack 成本只算本任务本轮（不累计历史轮）
    try {
      const capabilityCheck =
        typeof taskPreflight === "function" ? await taskPreflight(text) : null;
      if (!isPendingActionInput && capabilityCheck?.ok === false) {
        const reason = String(
          capabilityCheck.reason ||
            "当前员工无法完成该交付物；请先完成工具体检与授权。"
        );
        sink.onDelta(`\n⛔ ${reason}`);
        await finishGeneration();
        emitTurn(EVENTS.TASK_BLOCKED, {
          id: taskRunId,
          status: capabilityCheck.code || "tool_preflight_blocked",
          reason,
          blocking: capabilityCheck.blocking || [],
          est_cost: 0,
        });
        recordTaskOutcome(root, meta.agentId, {
          taskKind: "formal",
          outcome: "correctly_blocked",
          acceptanceSource: "none",
          cost: 0,
          evidenceCount: 1,
          skillUsage: skillUsageSnapshot(),
          taskRunId,
        });
        settleGrowthOutcome(
          {
            taskRunId,
            growthCycleId:
              growthCycleIdForTask ||
              growthCyclesByTaskRun.get(taskRunId) ||
              null,
          },
          "failed",
          "Growth task was correctly blocked and produced no delivery"
        );
        return;
      }
      if (!isPendingActionInput && budgetBlocksNewTask) {
        const unavailable = spend.state === SPEND_STATE_INVALID;
        const reason = unavailable
          ? "月度预算账本无法安全验证"
          : `本月已达预算上限（$${spend.total.toFixed(2)}/$${cap}）`;
        emit(EVENTS.BUDGET_WARNING, {
          level: "block",
          month: monthKey(),
          spent: unavailable ? null : spend.total,
          cap,
          ...(unavailable
            ? {
                reason_code: "budget_state_unavailable",
                reason,
              }
            : {}),
        });
        sink.onDelta(
          unavailable
            ? "\n⛔ 月度预算账本无法安全验证，新任务已暂停。请先修复或恢复 SETTINGS 对应的本月预算状态。"
            : `\n⛔ 本月已达预算上限（$${spend.total.toFixed(2)}/$${cap}）。新任务已暂停——去 SETTINGS 调高月度预算上限后再派活。`
        );
        await finishGeneration();
        emitTurn(EVENTS.TASK_BLOCKED, {
          id: taskRunId,
          status: "budget_blocked",
          reason,
          est_cost: 0,
        });
        recordTaskOutcome(root, meta.agentId, {
          taskKind: "formal",
          outcome: "correctly_blocked",
          acceptanceSource: "none",
          cost: 0,
          evidenceCount: 1,
          skillUsage: skillUsageSnapshot(),
          taskRunId,
        });
        return;
      }
      let growthCycleIdForTask = null;
      if (queuedGrowthCycle) {
        const startedGrowth = startGrowthCycle(
          bridgeRoot,
          meta.agentId,
          queuedGrowthCycle.cycle_id,
          taskRunId
        );
        growthCycleIdForTask = startedGrowth.record.cycle_id;
        growthCyclesByTaskRun.set(taskRunId, growthCycleIdForTask);
        projectGrowthCycle(
          startedGrowth.record,
          EVENTS.DREAM_NEXT_TASK_STARTED
        );
        queuedGrowthCycle = null;
      }
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
        runModelTurn: msg =>
          runTurn(
            (messageParts && messageParts.length) || userInvokedSkillIds.length
              ? {
                  text: msg,
                  ...(messageParts && messageParts.length
                    ? { parts: messageParts }
                    : {}),
                  ...(userInvokedSkillIds.length
                    ? { initialSkillIds: userInvokedSkillIds }
                    : {}),
                }
              : msg,
            sink
          ),
        runQuickUtility: msg => runQuickUtility(msg, sink), // §10.2 light path
        executeReveal:
          artifactActionDeps.executeReveal ||
          (process.env.CREW_MOCK === "1" ? null : executeRevealStrategy),
        hasAttachments: !!(
          messageParts &&
          messageParts.some(p => p && (p.type === "image" || p.type === "file"))
        ),
        pendingActions: pendingSnapshot,
        employeeScope: meta.employeeScope,
        env: process.env,
        role: meta.role,
        taskRunId,
        root,
        agentId: meta.agentId, // v0.13 M2：memory.state 的真实条目数按员工读取
      });
      if (closing) return;
      // Provider chunking is transport-level detail. Do not expose a terminal, approval modal, or
      // final assistant snapshot until the stable 30 ms / 2–4 grapheme visual stream is drained.
      await finishGeneration();
      // §11 Approval-before-Done + CC-PROOF-001. Three terminal shapes:
      //  (a) user accepted a held deliverable → write the ProofPack, emit approval.accepted, done.
      //  (b) task produced a deliverable → enter Approval (approval.requested), do NOT complete.
      //  (c) blocked / plain chat / revise → complete immediately.
      const art = decision?.producedArtifact;
      if (art && !decision.blocked) {
        // v0.18 C4: honor the SETTINGS approval policy (was stored-but-ignored). "信任后自动"
        // auto-accepts once the employee has earned ≥N cumulative accepts — but still emits the
        // full approval.accepted → task.completed stream (+ ProofPack) so the record is complete,
        // just without a human keystroke. Default policy = manual gate (conformance unchanged).
        const approvalId = `delivery-appr-${randomUUID()}`;
        const fingerprint = artifactFingerprint(
          readArtifactFileGuarded(root, art.path)
        );
        const held = {
          id: approvalId,
          taskRunId,
          root,
          agentId: meta.agentId || null,
          goal: text,
          artifact: art,
          fingerprint,
          usage: turnUsage(),
          skillUsage: skillUsageSnapshot(),
          createdAt: Date.now(),
          growthCycleId:
            growthCycleIdForTask ||
            growthCyclesByTaskRun.get(taskRunId) ||
            null,
        };
        if (!fingerprint.ok) {
          failDeliverySettlement(held, {
            code: fingerprint.code,
            reason: fingerprint.reason,
            decision: "artifact_invalid",
          });
          return;
        }
        const policy = readApprovalPolicy(root);
        const trusted =
          policy === APPROVAL_TRUST_AUTO &&
          readKpi(root, meta.agentId).accepted >= TRUST_AUTO_THRESHOLD;
        if (trusted) {
          const autoAccepted =
            "✓ 信任后自动验收（该员工累计验收已达阈值，交付流水完整保留）。";
          emit(EVENTS.COMMAND_OUTPUT, {
            command: "approval.auto_accept",
            text: autoAccepted,
            ansi_lines: renderMessage(autoAccepted, { color: true }),
          });
          const pendingPersisted = persistPendingDelivery(held);
          const decisionPersisted = pendingPersisted.ok
            ? persistDeliveryDecision(held, "accept", { auto: true })
            : pendingPersisted;
          if (!pendingPersisted.ok || !decisionPersisted.ok) {
            failDeliverySettlement(held, {
              code: "approval_state_not_persisted",
              reason: "自动验收状态无法持久化，任务已安全失败",
              decision: "persistence_failed",
              auto: true,
            });
            return;
          }
          completeAcceptedDelivery(
            {
              ...held,
              decision: "accept",
              decisionAt: decisionPersisted.decisionAt,
            },
            { auto: true }
          );
        } else {
          const persisted = persistPendingDelivery(held);
          if (!persisted.ok) {
            failDeliverySettlement(held, {
              code: "approval_state_not_persisted",
              reason: "待验收状态无法持久化，任务已安全失败",
              decision: "persistence_failed",
            });
            return;
          }
          pendingApproval = held;
          if (held.growthCycleId) {
            const awaiting = awaitGrowthDelivery(
              bridgeRoot,
              meta.agentId,
              held.growthCycleId,
              taskRunId
            );
            projectGrowthCycle(
              awaiting.record,
              EVENTS.DREAM_NEXT_TASK_DELIVERY_READY
            );
          }
          emitApprovalRequested(emit, held);
          // do NOT emit task.completed — the accept action closes the task.
        }
      } else if (decision.correctlyBlocked) {
        recordTaskOutcome(root, meta.agentId, {
          taskKind: "formal",
          outcome: "correctly_blocked",
          acceptanceSource: "none",
          cost: 0,
          evidenceCount: 1,
          skillUsage: skillUsageSnapshot(),
          taskRunId,
        });
      } else if (!decision.blocked) {
        // preflight-blocked 轮已经发过 task.blocked（终态，已清 busy）——不能再发 task.completed，
        // 否则 reducer 会把 blocked 覆盖成 done/needs_artifact，UI 前脚说阻塞后脚说完成。
        // v0.13 M2：带上本轮真实 usage 与估算成本（前端 TASK QUEUE / KPI 的数据源）。
        const u = turnUsage();
        const plainCost = estimateCost({
          promptTokens: u.prompt,
          completionTokens: u.completion,
        }).cost;
        emit(EVENTS.TASK_COMPLETED, {
          id: taskRunId,
          taskRunId,
          usage: u,
          est_cost: plainCost,
        });
        // v0.17 P2 C1：非验收终态也计入累计"任务数"（与本会话 KPI 的 tasks 定义一致——
        // task_meta 挂在每个 completed/blocked/rejected 任务头上，不只挂验收产出）。
        const countsTowardEmployeeKpi =
          !decision?.unscored &&
          ["employee_task", "employee_chat", "artifact_action"].includes(
            decision?.type
          );
        if (countsTowardEmployeeKpi) {
          recordTaskOutcome(root, meta.agentId, {
            taskKind:
              decision.type === "employee_chat"
                ? "chat"
                : decision.type === "artifact_action"
                  ? "artifact_action"
                  : "formal",
            outcome: "completed",
            acceptanceSource: "none",
            cost: plainCost,
            skillUsage: skillUsageSnapshot(),
            taskRunId,
          });
        }
        accrueSpend(plainCost, taskRunId); // v0.18 C3
        settleGrowthOutcome(
          {
            taskRunId,
            growthCycleId:
              growthCycleIdForTask ||
              growthCyclesByTaskRun.get(taskRunId) ||
              null,
          },
          "failed",
          "Growth task completed without a deliverable and cannot enter approval"
        );
      }
    } catch (e) {
      if (!closing && !cancelledTaskIds.has(taskRunId)) {
        await finishGeneration(EVENTS.GENERATION_FAILED, {
          reason: String((e && e.message) || e),
        });
        emit(EVENTS.TASK_REJECTED, {
          id: taskRunId,
          taskRunId,
          status: "failed",
          reason: String((e && e.message) || e),
          ...(typeof e?.code === "string" && e.code
            ? { reason_code: e.code }
            : {}),
          ...(Number.isInteger(e?.httpStatus)
            ? { http_status: e.httpStatus }
            : {}),
        });
        settleGrowthOutcome(
          {
            taskRunId,
            growthCycleId:
              growthCycleIdForTask ||
              growthCyclesByTaskRun.get(taskRunId) ||
              null,
          },
          "failed",
          String((e && e.message) || e)
        );
      }
    } finally {
      cancelledTaskIds.delete(taskRunId);
      busy = false;
      activeAbortController = null;
      scheduleQueuedInput();
    }
  };
  rl.on("line", raw => {
    void handleLine(raw).catch(error => {
      emit(EVENTS.DEBUG_LINE, {
        line: `input handler failed: ${String(error?.message || error)}`,
      });
    });
  });

  await closedPromise;
}

// CC-PROOF-001: the ProofPack is a completion receipt. It is atomically written, fsynced and
// read back before the bridge is allowed to emit approval.accepted/task.completed.
function writeProofPack({
  taskRunId,
  root,
  goal,
  artifact,
  fingerprint,
  usage,
  decisionAt,
  createdAt,
}) {
  const pack = assembleProofPack({
    task_run_id: taskRunId,
    user_goal: goal,
    artifacts: artifact ? [{ ...artifact, fingerprint }] : [],
    outcome_checks: [{ valid: true, deliverable: artifact?.path, fingerprint }],
    approval: {
      decision: "accept",
      // This timestamp is captured in the immutable decision receipt. A crash retry must assemble
      // byte-identical ProofPack JSON or persistProofPackDurably will correctly reject it.
      at: heldDecisionAt({ decisionAt, createdAt }),
    },
    usage,
  });
  const persisted = persistProofPackDurably({ root, taskRunId, pack });
  return persisted.ok ? { path: persisted.path, pack } : null;
}

function heldDecisionAt({ decisionAt, createdAt } = {}) {
  const value = Number(decisionAt || createdAt);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function artifactFingerprint(result = {}) {
  if (!result.ok) return result;
  return {
    ok: true,
    path: result.path,
    realpath: result.realpath,
    bytes: result.bytes,
    mtimeMs: result.mtimeMs,
    sha256: result.sha256,
  };
}

function verifyHeldArtifact(held = {}) {
  if (!held.fingerprint?.ok) {
    return (
      held.fingerprint || {
        ok: false,
        code: "artifact_fingerprint_missing",
        reason: "待验收交付缺少完整性指纹",
      }
    );
  }
  if (held.artifact?.path !== held.fingerprint.path) {
    return {
      ok: false,
      code: "artifact_path_changed",
      reason: "待验收交付路径与审批快照不一致",
    };
  }
  const artifactRoot = resolve(
    held.root || ".",
    ".crewclaw",
    "artifacts",
    String(held.taskRunId || "")
  );
  const taskRoot = inspectArtifactPath(held.root || ".", artifactRoot, {
    mustExist: true,
  });
  if (!taskRoot.ok || !taskRoot.stat?.isDirectory()) {
    return taskRoot.ok
      ? {
          ok: false,
          code: "artifact_task_root_invalid",
          reason: "待验收任务的 artifacts 目录不存在或不是目录",
        }
      : taskRoot;
  }
  const verified = verifyGuardedArtifactFingerprint(
    held.root || ".",
    held.fingerprint
  );
  if (!verified.ok) return verified;
  const rel = relative(taskRoot.realpath, verified.realpath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      code: "artifact_outside_task_root",
      reason: "待验收交付路径不属于当前任务工作区",
    };
  }
  return artifactFingerprint(verified);
}

function isNonEmptyFile(path) {
  return captureArtifactFingerprint(path).ok;
}

function approvalStateId(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new Error(`unsafe ${field || "approval state"} id`);
  }
  return value;
}

function pendingDeliveryPath(root, taskRunId) {
  const safeTaskRunId = approvalStateId(taskRunId, "taskRunId");
  return resolveStatePath(
    join(root, ".crewclaw", "runs", `${safeTaskRunId}.pending-approval.json`),
    root
  );
}

function deliveryDecisionPath(root, taskRunId) {
  const safeTaskRunId = approvalStateId(taskRunId, "taskRunId");
  return resolveStatePath(
    join(root, ".crewclaw", "runs", `${safeTaskRunId}.approval-decision.json`),
    root
  );
}

function deliveryApprovalLockPath(root) {
  return resolveStatePath(
    join(root, ".crewclaw", "runs", ".delivery-approval.lock"),
    root
  );
}

function readJsonStateFile(path, root) {
  return JSON.parse(readStateFileGuarded(path, { root }).toString("utf8"));
}

function pendingDeliveryReceipt(held) {
  return {
    version: 1,
    status: "pending",
    id: held.id,
    taskRunId: held.taskRunId,
    agentId: held.agentId || null,
    root: resolve(held.root),
    goal: held.goal,
    artifact: held.artifact,
    fingerprint: held.fingerprint,
    usage: held.usage,
    skillUsage: Array.isArray(held.skillUsage) ? held.skillUsage : [],
    createdAt: held.createdAt,
    growthCycleId: held.growthCycleId || null,
  };
}

function persistPendingDelivery(held) {
  let path;
  try {
    path = pendingDeliveryPath(held.root, held.taskRunId);
    const lockPath = deliveryApprovalLockPath(held.root);
    const receipt = pendingDeliveryReceipt({
      ...held,
      createdAt: held.createdAt || Date.now(),
    });
    return withStateLock(
      lockPath,
      () => {
        if (existsSync(path)) {
          try {
            const existing = readJsonStateFile(path, held.root);
            if (JSON.stringify(existing) === JSON.stringify(receipt)) {
              return { ok: true, path, existing: true };
            }
            return {
              ok: false,
              code:
                existing?.version !== 1
                  ? "pending_approval_version_unsupported"
                  : "pending_approval_conflict",
              reason: "已有待验收回执与当前任务内容不一致",
              path,
            };
          } catch (error) {
            return {
              ok: false,
              code: "pending_approval_corrupt",
              reason: `已有待验收回执损坏：${error?.message || error}`,
              path,
            };
          }
        }
        return writeJsonDurably(path, receipt, { root: held.root });
      },
      { root: held.root }
    );
  } catch (error) {
    return {
      ok: false,
      code: "pending_approval_path_unsafe",
      reason: error?.message || String(error),
    };
  }
}

function persistDeliveryDecision(held, decision, { auto = false } = {}) {
  let path;
  try {
    path = deliveryDecisionPath(held.root, held.taskRunId);
    const lockPath = deliveryApprovalLockPath(held.root);
    return withStateLock(
      lockPath,
      () => {
        if (existsSync(path)) {
          try {
            const existing = readJsonStateFile(path, held.root);
            if (
              existing?.version === 1 &&
              existing?.id === held.id &&
              existing?.taskRunId === held.taskRunId &&
              existing?.agentId === (held.agentId || null) &&
              existing?.decision === decision &&
              existing?.fingerprintSha256 === held.fingerprint?.sha256 &&
              Number.isFinite(existing?.decisionAt)
            ) {
              return { ...existing, ok: true, path, existing: true };
            }
            return {
              ok: false,
              code: "approval_decision_conflict",
              reason: "已有验收决策与当前任务不一致",
              path,
            };
          } catch (error) {
            return {
              ok: false,
              code: "approval_decision_corrupt",
              reason: `验收决策回执损坏：${error?.message || error}`,
              path,
            };
          }
        }
        const receipt = {
          version: 1,
          id: held.id,
          taskRunId: held.taskRunId,
          agentId: held.agentId || null,
          decision,
          decisionAt: Date.now(),
          fingerprintSha256: held.fingerprint?.sha256 || null,
          auto,
        };
        const written = writeJsonDurably(path, receipt, { root: held.root });
        return written.ok ? { ...written, ...receipt } : written;
      },
      { root: held.root }
    );
  } catch (error) {
    return {
      ok: false,
      code: "approval_decision_path_unsafe",
      reason: error?.message || String(error),
    };
  }
}

function removePendingDelivery(held) {
  if (!held?.root || !held?.taskRunId) return false;
  try {
    return withStateLock(
      deliveryApprovalLockPath(held.root),
      () => {
        const paths = [
          pendingDeliveryPath(held.root, held.taskRunId),
          deliveryDecisionPath(held.root, held.taskRunId),
        ];
        for (const path of paths) {
          if (existsSync(path)) {
            unlinkSync(resolveStatePath(path, held.root, { mustExist: true }));
          }
        }
        return paths.every(path => !existsSync(path));
      },
      { root: held.root }
    );
  } catch {
    return false;
  }
}

function readPendingDelivery(root, agentId) {
  try {
    const dir = resolveStateDirectory(join(root, ".crewclaw", "runs"), root);
    if (!existsSync(dir)) return { ok: true, pending: null };
    return withStateLock(
      deliveryApprovalLockPath(root),
      () => {
        const guardedDir = resolveStateDirectory(dir, root, {
          mustExist: true,
        });
        const candidates = [];
        for (const name of readdirSync(guardedDir).filter(name =>
          name.endsWith(".pending-approval.json")
        )) {
          let held;
          try {
            const receiptPath = resolveStatePath(join(guardedDir, name), root, {
              mustExist: true,
            });
            held = readJsonStateFile(receiptPath, root);
          } catch (error) {
            return {
              ok: false,
              code: "pending_approval_corrupt",
              reason: `待验收回执损坏：${name}：${error?.message || error}`,
            };
          }
          if (held?.agentId !== agentId) continue;
          if (held?.version !== 1 || held?.status !== "pending") {
            return {
              ok: false,
              code: "pending_approval_version_unsupported",
              reason: `待验收回执版本或状态不受支持：${name}`,
            };
          }
          if (
            typeof held.id !== "string" ||
            typeof held.taskRunId !== "string" ||
            held.root !== resolve(root) ||
            pendingDeliveryPath(root, held.taskRunId) !==
              join(guardedDir, name) ||
            !Number.isFinite(held.createdAt) ||
            held.createdAt <= 0 ||
            typeof held.artifact?.artifact_id !== "string" ||
            held.fingerprint?.ok !== true ||
            held.artifact?.path !== held.fingerprint?.path
          ) {
            return {
              ok: false,
              code: "pending_approval_invalid",
              reason: `待验收回执字段或文件名不一致：${name}`,
            };
          }
          const decisionPath = deliveryDecisionPath(root, held.taskRunId);
          if (existsSync(decisionPath)) {
            let decision;
            try {
              decision = readJsonStateFile(decisionPath, root);
            } catch (error) {
              return {
                ok: false,
                code: "approval_decision_corrupt",
                reason: `验收决策回执损坏：${error?.message || error}`,
              };
            }
            if (
              decision?.version !== 1 ||
              decision?.id !== held.id ||
              decision?.taskRunId !== held.taskRunId ||
              decision?.agentId !== held.agentId ||
              !["accept", "reject"].includes(decision?.decision) ||
              !Number.isFinite(decision?.decisionAt) ||
              decision?.fingerprintSha256 !== held.fingerprint?.sha256
            ) {
              return {
                ok: false,
                code: "approval_decision_invalid",
                reason: `验收决策与待验收回执不一致：${name}`,
              };
            }
            held = { ...held, ...decision };
          }
          candidates.push({ ...held, root: resolve(root) });
        }
        if (candidates.length > 1) {
          return {
            ok: false,
            code: "pending_approval_ambiguous",
            reason: "同一员工存在多个待验收回执，拒绝猜测恢复目标",
          };
        }
        return { ok: true, pending: candidates[0] || null };
      },
      { root }
    );
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, pending: null };
    return {
      ok: false,
      code: "pending_approval_scan_failed",
      reason: `无法扫描待验收回执：${error?.message || error}`,
    };
  }
}

function pendingActionsForHeld(held) {
  const artifact = held.artifact || {};
  return [
    {
      key: "1",
      label: "接受交付物",
      action_type: "accept",
      artifactId: artifact.artifact_id,
      taskRunId: held.taskRunId,
      path: artifact.path,
      bytes: held.fingerprint?.bytes,
      sha256: held.fingerprint?.sha256,
      mtimeMs: held.fingerprint?.mtimeMs,
      realpath: held.fingerprint?.realpath,
    },
    {
      key: "2",
      label: "要求修订",
      action_type: "revise",
      artifactId: artifact.artifact_id,
      taskRunId: held.taskRunId,
      path: artifact.path,
      payload: `请修订《${artifact.name || "上一版交付物"}》`,
    },
    {
      key: "3",
      label: "打开位置",
      action_type: "reveal",
      artifactId: artifact.artifact_id,
      taskRunId: held.taskRunId,
      path: artifact.path,
    },
  ];
}

function emitApprovalRequested(emit, held, extra = {}) {
  emit(EVENTS.APPROVAL_REQUESTED, {
    id: held.id,
    kind: "deliverable_acceptance",
    taskRunId: held.taskRunId,
    artifacts: [
      {
        id: held.artifact?.artifact_id,
        name: held.artifact?.name,
        path: held.artifact?.path,
        kind: held.artifact?.kind,
        status: held.artifact?.status,
        bytes: held.fingerprint?.bytes,
        sha256: held.fingerprint?.sha256,
        mtimeMs: held.fingerprint?.mtimeMs,
      },
    ],
    reason: "任务已产出交付物，等待验收（a=接受，r=拒绝并要求修订）。",
    ...extra,
  });
}
