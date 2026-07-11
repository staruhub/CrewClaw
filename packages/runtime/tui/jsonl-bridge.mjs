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
import { renderMessage } from "../ui-markdown.mjs";
import { isCommand, runCommand, commandCatalog } from "../commands.mjs";
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
import { readEvalResult } from "../eval-runner.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";
import {
  DREAM_EVENT_FAMILY,
  assessDreamFromWorkspace,
  persistDreamRecommendation,
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
}) {
  let sessionPendingActions = []; // last task's actions — digit input matches these (§6.4)
  const artifactsById = new Map();
  let turnText = "";
  let turnSeq = 0,
    toolSeq = 0,
    apprSeq = 0;
  let pendingConfirm = null; // {id, taskRunId, resolve} while agentLoop awaits a tool authorization
  let pendingApproval = null; // durable held deliverable awaiting acceptance
  let activeTaskRunId = null;
  let busy = false;
  let closing = false;
  let closeReason = "input_eof";
  let closeTerminalEmitted = false;
  let usageAcc = { prompt: 0, completion: 0 };
  const clientEventFamilies = new Set();
  const emittedDreamRecommendations = new Set();
  const turnUsage = () => ({ ...usageAcc });

  const emit = (type, data) => {
    if (type === EVENTS.PENDING_ACTIONS)
      sessionPendingActions = (data && data.actions) || [];
    // v0.15 P0-1: a NEW task starting makes the previous deliverable's PendingActions stale.
    // Wipe them at task.started so a later digit (2 → MARKET) is never captured by a ghost list.
    // (deliver turns emit PENDING_ACTIONS *after* TASK_STARTED, so the fresh list still lands.)
    if (type === EVENTS.TASK_STARTED) {
      sessionPendingActions = [];
      activeTaskRunId = data?.id || data?.taskRunId || activeTaskRunId;
    }
    if (type === EVENTS.ARTIFACT_CREATED && data?.id) {
      artifactsById.set(data.id, {
        ...data,
        artifact_id: data.id,
        taskRunId: data.taskRunId || activeTaskRunId || null,
      });
    }
    if (
      type === EVENTS.ARTIFACT_UPDATED &&
      data?.id &&
      artifactsById.has(data.id)
    ) {
      const current = artifactsById.get(data.id);
      artifactsById.set(data.id, {
        ...current,
        ...(data.patch || {}),
        taskRunId: data.taskRunId || current.taskRunId,
      });
    }
    if (type === EVENTS.ARTIFACT_DELETED && data?.ok === true) {
      const id = data.artifact_id || data.id;
      if (id && artifactsById.has(id))
        artifactsById.set(id, { ...artifactsById.get(id), status: "deleted" });
    }
    if (type === EVENTS.ARTIFACT_EXPORTED && data?.ok === true) {
      const id = data.artifact_id || data.id;
      if (id && artifactsById.has(id))
        artifactsById.set(id, {
          ...artifactsById.get(id),
          exportPath: data.path,
          status: "exported",
        });
    }
    if (
      [
        EVENTS.TASK_COMPLETED,
        EVENTS.TASK_REJECTED,
        EVENTS.TASK_BLOCKED,
      ].includes(type)
    ) {
      const terminalTaskId = data?.taskRunId || data?.id;
      if (terminalTaskId && terminalTaskId === activeTaskRunId)
        activeTaskRunId = null;
    }
    output.write(JSON.stringify(makeEvent(type, data, Date.now())) + "\n");
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
  // → EVAL 屏保留 MOCK 占位；mock:true → 屏上标注"非认证分"；mock:false → 真认证分。
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
          curation: assessment.curation,
          activation: assessment.activation,
          estimated_cost_usd: assessment.cost.estimated_usd,
          estimated_input_tokens: assessment.cost.estimated_input_tokens,
          estimated_output_tokens: assessment.cost.estimated_output_tokens,
          generation_available: false,
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
    },
    caps: { ansi: true, parts: true, commands: commandCatalog() },
  });

  // v0.8 M2: turnText accumulates assistant text from every source so the completed turn can be
  // typeset once. Approval state above is declared before emit() because artifact/terminal events
  // update the bridge's correlation registry synchronously.

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
      accepted: true,
      cost,
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
      accepted: false,
      cost,
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
    return accepted
      ? completeAcceptedDelivery(decided)
      : completeRejectedDelivery(decided, { decision, reason });
  };

  const sink = {
    onDelta: text => {
      turnText += text ?? "";
      emit(EVENTS.TOKEN_DELTA, { text });
    },
    // v0.11 M4：真·思考增量 → thinking.delta（前端折叠成「思考」块）。不计入 turnText（思考不是交付正文）。
    onThinking: text => {
      if (text) emit(EVENTS.THINKING_DELTA, { text });
    },
    onInvocation: (inv = {}) => {
      const id = "tool" + ++toolSeq;
      emit(EVENTS.TOOL_REQUESTED, {
        id,
        taskRunId: activeTaskRunId,
        tool: inv.toolName,
        label: inv.line || inv.action || inv.toolName,
      });
      const failed = inv.status === "blocked" || inv.status === "error";
      // v0.8 M4: carry the full tool output (capped ~4KB) so the front-end's collapsed line can
      // expand to show it. Pick the richest available field; stringify non-strings defensively.
      const rawDetail =
        inv.output ?? inv.result ?? inv.detail ?? inv.stdout ?? inv.error ?? "";
      const detail = String(
        typeof rawDetail === "string"
          ? rawDetail
          : JSON.stringify(rawDetail, null, 2)
      ).slice(0, 4096);
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, {
        id,
        taskRunId: activeTaskRunId,
        summary: inv.action,
        code: failed ? inv.code || inv.action : undefined,
        detail,
      });
    },
    onUsage: u => {
      if (!u) return;
      usageAcc.prompt += u.prompt_tokens || 0;
      usageAcc.completion += u.completion_tokens || 0;
      emit(EVENTS.TOKEN_USAGE, {
        taskRunId: activeTaskRunId,
        prompt: u.prompt_tokens,
        completion: u.completion_tokens,
      });
    },
    // L2 approval over the process boundary: emit APPROVAL_REQUIRED, await the front's a/d line.
    confirm: (msg, info = {}) => {
      const taskRunId = activeTaskRunId;
      const id = `tool-appr-${taskRunId || "session"}-${++apprSeq}`;
      emit(EVENTS.APPROVAL_REQUIRED, {
        id,
        taskRunId,
        kind: "tool_authorization",
        tool: info.tool || info.toolName,
        reason: typeof msg === "string" ? msg : info.reason,
        scope: info.scope,
      });
      return new Promise(resolve => {
        pendingConfirm = { id, taskRunId, resolve };
      });
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

    if (pendingConfirm) {
      const held = pendingConfirm;
      pendingConfirm = null;
      emit(EVENTS.APPROVAL_RESOLVED, {
        id: held.id,
        taskRunId: held.taskRunId,
        kind: "tool_authorization",
        decision: "deny",
        reason: closeReason,
      });
      if (held.taskRunId) {
        emit(EVENTS.TASK_BLOCKED, {
          id: held.taskRunId,
          taskRunId: held.taskRunId,
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
      emit(EVENTS.TASK_BLOCKED, {
        id: activeTaskRunId,
        taskRunId: activeTaskRunId,
        status: "input_interrupted",
        reason: "输入通道关闭，运行中的任务已阻塞",
      });
    }
  };
  rl.once("close", interruptPendingWork);
  const closedPromise = new Promise(resolve => rl.once("close", resolve));

  rl.on("line", async raw => {
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
      return;
    }

    if (action?.type?.startsWith("dream.")) {
      const result = safelyApplyUserAction(action);
      if (!clientEventFamilies.has(DREAM_EVENT_FAMILY)) return;
      if (!dreamAssessment || !meta.agentId) {
        emit(EVENTS.DEBUG_LINE, {
          line: "dream action ignored: no employee bound",
        });
        return;
      }
      if (result.dreamAction === "run") {
        refreshDreamAssessment({ manualTrigger: true, force: true });
      } else if (result.dreamAction === "inspect") {
        refreshDreamAssessment({ force: true });
      } else {
        emit(EVENTS.DREAM_BLOCKED, {
          dream_id: result.dreamId || dreamIdFor(dreamAssessment),
          employee_id: meta.agentId,
          reason: "dream_action_not_available_before_m4",
          blockers: ["milestone_not_available"],
        });
      }
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
        allow =
          text === "a" || text === "allow" || text === "y" || text === "是";
      }
      const { id, taskRunId, resolve } = pendingConfirm;
      pendingConfirm = null;
      emit(EVENTS.APPROVAL_RESOLVED, {
        id,
        taskRunId,
        kind: "tool_authorization",
        decision: allow ? "allow" : "deny",
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
      if (result.invalidDecision) {
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
    if (isCommand(text)) {
      const result = runCommand(text, {
        name: agentName,
        model: meta.model,
        root: bridgeRoot,
        color: true,
      });
      if (result.action?.type === "exit") {
        rl.close();
        return;
      }
      const clear = result.action?.type === "clear";
      if (clear) history.length = 0; // single source of truth: engine clears, front-end mirrors
      const body = result.text || (clear ? "（上下文已清空）" : "");
      emit(EVENTS.COMMAND_OUTPUT, {
        command: text,
        clear,
        ansi_lines: body ? renderMessage(body, { color: true }) : [],
        text: body,
      });
      return;
    }
    if (busy) return; // a task is already running; ignore stray input
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
    if (!isPendingActionInput && budgetBlocksNewTask) {
      if (spend.state === SPEND_STATE_INVALID) {
        emit(EVENTS.BUDGET_WARNING, {
          level: "block",
          month: monthKey(),
          spent: null,
          cap,
          reason_code: "budget_state_unavailable",
          reason: "月度预算账本无法安全验证",
        });
        emit(EVENTS.TOKEN_DELTA, {
          text: "\n⛔ 月度预算账本无法安全验证，新任务已暂停。请先修复或恢复 SETTINGS 对应的本月预算状态。",
        });
        return;
      }
      const total = spend.total;
      emit(EVENTS.BUDGET_WARNING, {
        level: "block",
        month: monthKey(),
        spent: total,
        cap,
      });
      emit(EVENTS.TOKEN_DELTA, {
        text: `\n⛔ 本月已达预算上限（$${total.toFixed(2)}/$${cap}）。新任务已暂停——去 SETTINGS 调高月度预算上限后再派活。`,
      });
      return;
    }
    busy = true;
    // v0.15 P0-1: snapshot the pending actions BEFORE task.started wipes them. The digit the user
    // pressed matches against what was on screen; task.started clears the list for the NEXT turn.
    const pendingSnapshot = sessionPendingActions;
    const taskRunId = `task-${randomUUID()}`;
    const root = bridgeRoot;
    const turnId = "turn" + ++turnSeq;
    // 纯附件轮 text 为空——给个占位标题，避免任务标题空白。
    emit(EVENTS.TASK_STARTED, {
      id: taskRunId,
      taskRunId,
      title: text || "（附件消息）",
      mode: meta.mode,
    });
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
        runModelTurn: msg =>
          runTurn(
            messageParts && messageParts.length
              ? { text: msg, parts: messageParts }
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
      // v0.8 M2: the turn's text is complete — typeset it ONCE via the shared markdown renderer
      // and "set" it over the live token.delta stream. Non-empty guard: pure tool/memory turns
      // that streamed no prose don't emit an empty rendered block.
      if (turnText.trim()) {
        emit(EVENTS.ASSISTANT_RENDERED, {
          turn_id: turnId,
          taskRunId,
          ansi_lines: renderMessage(turnText, { color: true }),
        });
      }
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
          createdAt: Date.now(),
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
          emit(EVENTS.TOKEN_DELTA, {
            text: "\n✓ 信任后自动验收（该员工累计验收已达阈值，交付流水完整保留）。",
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
          emitApprovalRequested(emit, held);
          // do NOT emit task.completed — the accept action closes the task.
        }
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
            accepted: false,
            cost: plainCost,
            taskRunId,
          });
        }
        accrueSpend(plainCost, taskRunId); // v0.18 C3
      }
    } catch (e) {
      if (!closing) {
        emit(EVENTS.TASK_REJECTED, {
          id: taskRunId,
          taskRunId,
          status: "failed",
          reason: String((e && e.message) || e),
        });
      }
    } finally {
      busy = false;
    }
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
    createdAt: held.createdAt,
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
