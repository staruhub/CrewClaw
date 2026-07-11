import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { writeJsonDurably } from "./acceptance-transaction.mjs";
import { verifyGuardedArtifactFingerprint } from "./artifact-contract.mjs";
import { loadArtifact } from "./artifact-store.mjs";
import {
  MAX_STATE_FILE_BYTES,
  readStateFileGuarded,
  resolveStateDirectory,
  resolveStatePath,
  withStateLock,
} from "./state-lock.mjs";

const RECEIPT_PROTOCOL_VERSION = 1;
const RECEIPT_SUFFIX = ".task-pending-approval.json";
const DECISION_PROTOCOL_VERSION = 2;
const SETTLEMENT_SNAPSHOT_VERSION = 1;
const DECISION_SUFFIX = ".task-approval-decision.json";
const SETTLEMENT_LOCK_SUFFIX = ".task-settlement.lock";

function failure(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function runsDir(root) {
  return resolveStateDirectory(join(resolve(root), ".crewclaw", "runs"), root);
}

function artifactsDir(root) {
  return join(resolve(root), ".crewclaw", "artifacts");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function receiptFromPending(pending) {
  try {
    // protocolVersion is owned by this writer. A caller-provided spread value must never replace it.
    return {
      ok: true,
      receipt: JSON.parse(
        JSON.stringify({
          ...pending,
          protocolVersion: RECEIPT_PROTOCOL_VERSION,
        })
      ),
    };
  } catch (error) {
    return failure(
      "pending_approval_invalid",
      "待验收回执包含无法持久化的字段",
      { error: error?.message || String(error) }
    );
  }
}

function validateFingerprintShape(fingerprint) {
  if (
    fingerprint?.ok !== true ||
    !nonEmptyString(fingerprint.path) ||
    !nonEmptyString(fingerprint.realpath) ||
    !Number.isFinite(fingerprint.bytes) ||
    fingerprint.bytes <= 0 ||
    !Number.isFinite(fingerprint.mtimeMs) ||
    fingerprint.mtimeMs < 0 ||
    typeof fingerprint.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(fingerprint.sha256)
  ) {
    return failure(
      "pending_approval_corrupt",
      "待验收回执缺少完整的交付物指纹"
    );
  }
  return { ok: true };
}

function validateSettlementSnapshotShape(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    snapshot.protocolVersion !== SETTLEMENT_SNAPSHOT_VERSION ||
    !snapshot.run ||
    typeof snapshot.run !== "object" ||
    Array.isArray(snapshot.run) ||
    !Array.isArray(snapshot.run.events) ||
    !Array.isArray(snapshot.run.tool_invocations) ||
    snapshot.run.status !== "delivered" ||
    !Array.isArray(snapshot.evidence)
  ) {
    return failure(
      "task_accept_settlement_corrupt",
      "验收决策缺少完整的 pre-accept TaskRun 或 evidence 快照"
    );
  }
  const pendingShape = validateStoredReceipt(snapshot.pending);
  if (!pendingShape.ok) {
    return failure(
      "task_accept_settlement_corrupt",
      `验收决策中的 pending 快照无效：${pendingShape.reason}`
    );
  }
  const commit = snapshot.run.memory_commit;
  if (
    !commit ||
    typeof commit !== "object" ||
    Array.isArray(commit) ||
    !Array.isArray(commit.candidates) ||
    !Number.isSafeInteger(commit.lessons) ||
    commit.lessons < 0 ||
    commit.committed !== false
  ) {
    return failure(
      "task_accept_settlement_corrupt",
      "验收决策中的记忆候选快照无效"
    );
  }
  if (
    snapshot.run.id !== snapshot.pending.taskRunId ||
    snapshot.run.employee_id !== snapshot.pending.employeeId ||
    snapshot.run.requested_task_id !== snapshot.pending.requestedTaskId ||
    snapshot.run.user_goal !== snapshot.pending.goal ||
    snapshot.run.artifact !== snapshot.pending.artifact.id
  ) {
    return failure(
      "task_accept_settlement_corrupt",
      "验收决策中的 TaskRun 与 pending 快照身份不一致"
    );
  }
  return { ok: true };
}

function validateSettlementShape(settlement) {
  if (
    !settlement ||
    typeof settlement !== "object" ||
    Array.isArray(settlement) ||
    settlement.protocolVersion !== SETTLEMENT_SNAPSHOT_VERSION ||
    typeof settlement.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(settlement.sha256)
  ) {
    return failure(
      "task_accept_settlement_corrupt",
      "验收决策缺少 settlement snapshot/hash"
    );
  }
  const snapshotShape = validateSettlementSnapshotShape(settlement.snapshot);
  if (!snapshotShape.ok) return snapshotShape;
  if (canonicalSha256(settlement.snapshot) !== settlement.sha256) {
    return failure(
      "task_accept_settlement_hash_mismatch",
      "验收决策的 settlement snapshot 哈希不匹配"
    );
  }
  return { ok: true };
}

export function createTaskSettlementSnapshot({ pending, run, evidence } = {}) {
  try {
    const snapshot = canonicalClone({
      protocolVersion: SETTLEMENT_SNAPSHOT_VERSION,
      pending,
      run,
      evidence,
    });
    const shape = validateSettlementSnapshotShape(snapshot);
    if (!shape.ok) return shape;
    return {
      ok: true,
      snapshot,
      sha256: canonicalSha256(snapshot),
    };
  } catch (error) {
    return failure(
      "task_accept_settlement_corrupt",
      "无法构造可持久化的验收结算快照",
      { error: error?.message || String(error) }
    );
  }
}

function validateStoredReceipt(receipt, { file } = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return failure("pending_approval_corrupt", "待验收回执不是对象");
  }
  if (
    Number.isInteger(receipt.protocolVersion) &&
    receipt.protocolVersion > RECEIPT_PROTOCOL_VERSION
  ) {
    return failure(
      "pending_approval_future_protocol",
      `待验收回执协议版本 ${receipt.protocolVersion} 高于当前支持版本 ${RECEIPT_PROTOCOL_VERSION}`,
      { taskRunId: receipt.taskRunId }
    );
  }
  if (receipt.protocolVersion !== RECEIPT_PROTOCOL_VERSION) {
    return failure("pending_approval_corrupt", "待验收回执协议版本缺失或无效", {
      taskRunId: receipt.taskRunId,
    });
  }
  if (
    !nonEmptyString(receipt.approvalId) ||
    !nonEmptyString(receipt.taskRunId) ||
    !nonEmptyString(receipt.employeeId) ||
    !nonEmptyString(receipt.requestedTaskId) ||
    !nonEmptyString(receipt.goal) ||
    !nonEmptyString(receipt.artifact?.id) ||
    !nonEmptyString(receipt.artifact?.path) ||
    (receipt.reportPath !== null && !nonEmptyString(receipt.reportPath)) ||
    !Number.isFinite(receipt.usage?.prompt_tokens) ||
    receipt.usage.prompt_tokens < 0 ||
    !Number.isFinite(receipt.usage?.completion_tokens) ||
    receipt.usage.completion_tokens < 0 ||
    !Number.isFinite(receipt.createdAt) ||
    receipt.createdAt < 0
  ) {
    return failure(
      "pending_approval_corrupt",
      "待验收回执缺少审批、任务、员工、交付物、用量、报告路径或创建时间字段",
      { taskRunId: receipt.taskRunId }
    );
  }
  if (
    safeId(receipt.taskRunId) !== receipt.taskRunId ||
    safeId(receipt.artifact.id) !== receipt.artifact.id
  ) {
    return failure(
      "pending_approval_corrupt",
      "待验收回执包含不安全的任务或交付物 ID",
      { taskRunId: receipt.taskRunId }
    );
  }
  const fingerprint = validateFingerprintShape(receipt.fingerprint);
  if (!fingerprint.ok) {
    return { ...fingerprint, taskRunId: receipt.taskRunId };
  }
  if (file) {
    const expectedFile = `${receipt.taskRunId}${RECEIPT_SUFFIX}`;
    if (file !== expectedFile) {
      return failure(
        "pending_approval_filename_mismatch",
        "待验收回执文件名与 taskRunId 不一致",
        { file, expectedFile, taskRunId: receipt.taskRunId }
      );
    }
  }
  return { ok: true };
}

function validateStoredDecision(decision, { file } = {}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return failure("task_accept_decision_corrupt", "验收决策回执不是对象");
  }
  if (
    Number.isInteger(decision.protocolVersion) &&
    decision.protocolVersion > DECISION_PROTOCOL_VERSION
  ) {
    return failure(
      "task_accept_decision_future_protocol",
      `验收决策回执协议版本 ${decision.protocolVersion} 高于当前支持版本 ${DECISION_PROTOCOL_VERSION}`,
      { taskRunId: decision.taskRunId }
    );
  }
  if (
    decision.protocolVersion !== DECISION_PROTOCOL_VERSION ||
    decision.decision !== "accept" ||
    !nonEmptyString(decision.approvalId) ||
    !nonEmptyString(decision.taskRunId) ||
    !nonEmptyString(decision.employeeId) ||
    !nonEmptyString(decision.requestedTaskId) ||
    !nonEmptyString(decision.artifact?.id) ||
    !nonEmptyString(decision.artifact?.path) ||
    !Number.isSafeInteger(decision.pendingCreatedAt) ||
    decision.pendingCreatedAt < 0 ||
    !Number.isSafeInteger(decision.decisionAt) ||
    decision.decisionAt < decision.pendingCreatedAt
  ) {
    return failure(
      "task_accept_decision_corrupt",
      "验收决策回执缺少完整的审批、任务、员工、交付物或决策时间字段",
      { taskRunId: decision.taskRunId }
    );
  }
  if (
    safeId(decision.taskRunId) !== decision.taskRunId ||
    safeId(decision.artifact.id) !== decision.artifact.id
  ) {
    return failure(
      "task_accept_decision_corrupt",
      "验收决策回执包含不安全的任务或交付物 ID",
      { taskRunId: decision.taskRunId }
    );
  }
  const fingerprint = validateFingerprintShape(decision.fingerprint);
  if (!fingerprint.ok) {
    return failure(
      "task_accept_decision_corrupt",
      "验收决策回执缺少完整的交付物指纹",
      { taskRunId: decision.taskRunId }
    );
  }
  const settlement = validateSettlementShape(decision.settlement);
  if (!settlement.ok) {
    return { ...settlement, taskRunId: decision.taskRunId };
  }
  const frozenPending = decision.settlement.snapshot.pending;
  if (
    decision.approvalId !== frozenPending.approvalId ||
    decision.taskRunId !== frozenPending.taskRunId ||
    decision.employeeId !== frozenPending.employeeId ||
    decision.requestedTaskId !== frozenPending.requestedTaskId ||
    decision.pendingCreatedAt !== frozenPending.createdAt ||
    canonicalJson(decision.artifact) !==
      canonicalJson(frozenPending.artifact) ||
    canonicalJson(decision.fingerprint) !==
      canonicalJson(frozenPending.fingerprint)
  ) {
    return failure(
      "task_accept_settlement_corrupt",
      "验收决策头与 settlement pending 快照不一致",
      { taskRunId: decision.taskRunId }
    );
  }
  if (file) {
    const expectedFile = `${decision.taskRunId}${DECISION_SUFFIX}`;
    if (file !== expectedFile) {
      return failure(
        "task_accept_decision_filename_mismatch",
        "验收决策回执文件名与 taskRunId 不一致",
        { file, expectedFile, taskRunId: decision.taskRunId }
      );
    }
  }
  return { ok: true };
}

export function pendingTaskApprovalPath(root, taskRunId) {
  return resolveStatePath(
    join(
      resolve(root),
      ".crewclaw",
      "runs",
      `${safeId(taskRunId)}${RECEIPT_SUFFIX}`
    ),
    root
  );
}

export function taskApprovalDecisionPath(root, taskRunId) {
  return resolveStatePath(
    join(
      resolve(root),
      ".crewclaw",
      "runs",
      `${safeId(taskRunId)}${DECISION_SUFFIX}`
    ),
    root
  );
}

function taskSettlementLockPath(root, taskRunId) {
  return resolveStatePath(
    join(
      resolve(root),
      ".crewclaw",
      "runs",
      `${safeId(taskRunId)}${SETTLEMENT_LOCK_SUFFIX}`
    ),
    root
  );
}

export function withTaskSettlementLock(root, taskRunId, operation) {
  try {
    return withStateLock(taskSettlementLockPath(root, taskRunId), operation, {
      root,
    });
  } catch (error) {
    return failure(
      "task_settlement_lock_failed",
      "任务验收互斥锁不可用，拒绝继续结算",
      { taskRunId, error: error?.message || String(error) }
    );
  }
}

export function loadPendingTaskApproval(root, taskRunId) {
  let path;
  try {
    path = pendingTaskApprovalPath(root, taskRunId);
    if (!existsSync(path)) return { ok: true, pending: null, path };
    const pending = JSON.parse(
      readStateFileGuarded(path, { root }).toString("utf8")
    );
    const shape = validateStoredReceipt(pending, { file: basename(path) });
    if (!shape.ok) return { ...shape, path };
    return { ok: true, pending, path };
  } catch (error) {
    return failure("pending_approval_corrupt", "待验收回执无法安全读取", {
      path,
      taskRunId,
      error: error?.message || String(error),
    });
  }
}

function validIsoTimestampAtOrAfter(value, epochMs) {
  if (!nonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= epochMs;
}

function restoreFrozenProperty(current, frozen, key) {
  if (Object.prototype.hasOwnProperty.call(frozen, key)) {
    current[key] = structuredClone(frozen[key]);
  } else {
    delete current[key];
  }
}

function verifyAcceptedRunAgainstSnapshot(currentRun, frozenRun, decisionAt) {
  const current = canonicalClone(currentRun);
  const frozen = canonicalClone(frozenRun);
  const frozenEvents = frozen.events;
  const acceptedEvents = current.events;
  const acceptedEvent = acceptedEvents.at(-1);
  if (
    acceptedEvents.length !== frozenEvents.length + 1 ||
    canonicalJson(acceptedEvents.slice(0, -1)) !==
      canonicalJson(frozenEvents) ||
    acceptedEvent?.id !== `evt_${frozenEvents.length + 1}` ||
    acceptedEvent?.task_id !== frozen.id ||
    acceptedEvent?.type !== "state_changed" ||
    acceptedEvent?.summary !== "-> accepted" ||
    acceptedEvent?.tool_name !== null ||
    acceptedEvent?.status !== null ||
    !validIsoTimestampAtOrAfter(acceptedEvent?.timestamp, decisionAt)
  ) {
    return failure(
      "task_accept_settlement_run_mismatch",
      "accepted TaskRun 的事件序列不等于冻结事件加唯一 accepted transition"
    );
  }

  const frozenCommit = frozen.memory_commit;
  const currentCommit = current.memory_commit;
  if (
    !currentCommit ||
    typeof currentCommit !== "object" ||
    Array.isArray(currentCommit) ||
    canonicalJson(currentCommit.candidates) !==
      canonicalJson(frozenCommit.candidates) ||
    currentCommit.lessons !== frozenCommit.lessons
  ) {
    return failure(
      "task_accept_settlement_memory_mismatch",
      "accepted TaskRun 的记忆候选不等于冻结快照"
    );
  }
  const frozenCommitKeys = new Set(Object.keys(frozenCommit));
  const allowedCommitKeys = new Set([
    ...frozenCommitKeys,
    "committed_at",
    "learned",
    "errors",
  ]);
  if (Object.keys(currentCommit).some(key => !allowedCommitKeys.has(key))) {
    return failure(
      "task_accept_settlement_memory_mismatch",
      "accepted TaskRun 的记忆提交记录包含未冻结字段"
    );
  }
  if (currentCommit.committed === false) {
    if (canonicalJson(currentCommit) !== canonicalJson(frozenCommit)) {
      return failure(
        "task_accept_settlement_memory_mismatch",
        "未完成的记忆提交记录已偏离冻结快照"
      );
    }
  } else if (
    currentCommit.committed !== true ||
    !validIsoTimestampAtOrAfter(currentCommit.committed_at, decisionAt) ||
    !Number.isSafeInteger(currentCommit.learned) ||
    currentCommit.learned < 0 ||
    currentCommit.learned > frozenCommit.candidates.length ||
    !Array.isArray(currentCommit.errors) ||
    currentCommit.errors.length !== 0
  ) {
    return failure(
      "task_accept_settlement_memory_mismatch",
      "accepted TaskRun 的记忆提交状态无效"
    );
  }

  if (
    current.status !== "accepted" ||
    current.pending_approval !== null ||
    current.user_feedback !== "useful" ||
    current.effective !== (frozen.degraded !== true) ||
    !validIsoTimestampAtOrAfter(current.updated_at, decisionAt)
  ) {
    return failure(
      "task_accept_settlement_run_mismatch",
      "accepted TaskRun 的结算字段不符合唯一合法 transition"
    );
  }

  current.status = frozen.status;
  current.events = structuredClone(frozen.events);
  current.updated_at = frozen.updated_at;
  current.memory_commit = structuredClone(frozen.memory_commit);
  for (const key of [
    "pending_approval",
    "approval_decision",
    "proofpack",
    "user_feedback",
    "effective",
  ]) {
    restoreFrozenProperty(current, frozen, key);
  }
  if (canonicalJson(current) !== canonicalJson(frozen)) {
    return failure(
      "task_accept_settlement_run_mismatch",
      "accepted TaskRun 包含未绑定到 settlement snapshot 的变化"
    );
  }
  return { ok: true };
}

function verifyRunAgainstSettlement(run, frozenRun, decisionAt) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return failure(
      "task_accept_settlement_run_mismatch",
      "验收结算缺少可验证的 TaskRun"
    );
  }
  if (run.status === "delivered") {
    return canonicalJson(run) === canonicalJson(frozenRun)
      ? { ok: true }
      : failure(
          "task_accept_settlement_run_mismatch",
          "delivered TaskRun 已偏离冻结 settlement snapshot"
        );
  }
  if (run.status === "accepted") {
    return verifyAcceptedRunAgainstSnapshot(run, frozenRun, decisionAt);
  }
  return failure(
    "task_accept_settlement_run_mismatch",
    `TaskRun 状态 ${run.status} 与冻结 settlement snapshot 不兼容`
  );
}

export function verifyTaskApprovalDecisionBinding(
  decision,
  pending,
  { run, evidence } = {}
) {
  const decisionShape = validateStoredDecision(decision);
  if (!decisionShape.ok) return decisionShape;
  const pendingShape = validateStoredReceipt(pending);
  if (!pendingShape.ok) return pendingShape;
  if (
    decision.approvalId !== pending.approvalId ||
    decision.taskRunId !== pending.taskRunId ||
    decision.employeeId !== pending.employeeId ||
    decision.requestedTaskId !== pending.requestedTaskId ||
    decision.pendingCreatedAt !== pending.createdAt ||
    canonicalJson(decision.artifact) !== canonicalJson(pending.artifact) ||
    canonicalJson(decision.fingerprint) !== canonicalJson(pending.fingerprint)
  ) {
    return failure(
      "task_accept_decision_mismatch",
      "验收决策回执与待验收任务、员工或交付物指纹不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  const frozen = decision.settlement.snapshot;
  if (canonicalJson(frozen.pending) !== canonicalJson(pending)) {
    return failure(
      "task_accept_settlement_pending_mismatch",
      "当前 pending 回执不等于 accept 时冻结的完整快照",
      { taskRunId: pending.taskRunId }
    );
  }
  const runBinding = verifyRunAgainstSettlement(
    run,
    frozen.run,
    decision.decisionAt
  );
  if (!runBinding.ok) return { ...runBinding, taskRunId: pending.taskRunId };
  if (!Array.isArray(evidence)) {
    return failure(
      "task_accept_settlement_evidence_unavailable",
      "无法读取当前 evidence 以验证冻结 settlement snapshot",
      { taskRunId: pending.taskRunId }
    );
  }
  if (canonicalJson(evidence) !== canonicalJson(frozen.evidence)) {
    return failure(
      "task_accept_settlement_evidence_mismatch",
      "当前 evidence 已偏离 accept 时冻结的快照",
      { taskRunId: pending.taskRunId }
    );
  }
  return { ok: true };
}

export function loadTaskApprovalDecision(root, taskRunId) {
  let path;
  try {
    path = taskApprovalDecisionPath(root, taskRunId);
    if (!existsSync(path)) return { ok: true, decision: null, path };
    const decision = JSON.parse(
      readStateFileGuarded(path, { root }).toString("utf8")
    );
    const shape = validateStoredDecision(decision, { file: basename(path) });
    if (!shape.ok) return { ...shape, path };
    return { ok: true, decision, path };
  } catch (error) {
    return failure("task_accept_decision_corrupt", "验收决策回执无法安全读取", {
      path,
      taskRunId,
      error: error?.message || String(error),
    });
  }
}

export function persistTaskApprovalDecision(
  root,
  pending,
  { decisionAt, run, evidence } = {}
) {
  const pendingShape = validateStoredReceipt(pending);
  if (!pendingShape.ok) return pendingShape;
  const settlement = createTaskSettlementSnapshot({ pending, run, evidence });
  if (!settlement.ok) return settlement;
  const decision = {
    protocolVersion: DECISION_PROTOCOL_VERSION,
    approvalId: pending.approvalId,
    taskRunId: pending.taskRunId,
    employeeId: pending.employeeId,
    requestedTaskId: pending.requestedTaskId,
    artifact: structuredClone(pending.artifact),
    fingerprint: structuredClone(pending.fingerprint),
    decision: "accept",
    pendingCreatedAt: pending.createdAt,
    decisionAt,
    settlement: {
      protocolVersion: SETTLEMENT_SNAPSHOT_VERSION,
      sha256: settlement.sha256,
      snapshot: settlement.snapshot,
    },
  };
  const shape = validateStoredDecision(decision);
  if (!shape.ok) return shape;

  let path;
  try {
    path = taskApprovalDecisionPath(root, pending.taskRunId);
    return withStateLock(
      `${path}.write.lock`,
      () => {
        if (existsSync(path)) {
          const loaded = loadTaskApprovalDecision(root, pending.taskRunId);
          if (!loaded.ok) return loaded;
          const binding = verifyTaskApprovalDecisionBinding(
            loaded.decision,
            pending,
            { run, evidence }
          );
          if (!binding.ok) return { ...binding, path };
          if (canonicalJson(loaded.decision) !== canonicalJson(decision)) {
            return failure(
              "task_accept_decision_conflict",
              "任务已有不同内容的验收决策回执，拒绝覆盖",
              { path, taskRunId: pending.taskRunId }
            );
          }
          return {
            ok: true,
            path,
            decision: loaded.decision,
            existing: true,
          };
        }
        const payload = JSON.stringify(decision, null, 2);
        if (Buffer.byteLength(payload, "utf8") > MAX_STATE_FILE_BYTES) {
          return failure(
            "task_accept_decision_not_persisted",
            `验收决策超过 ${MAX_STATE_FILE_BYTES} 字节状态文件上限，拒绝落盘`,
            { path, taskRunId: pending.taskRunId }
          );
        }
        const written = writeJsonDurably(path, decision, { root });
        return written.ok
          ? { ...written, decision }
          : failure(
              "task_accept_decision_not_persisted",
              "验收决策无法持久化，任务不能标记为已接受",
              { path, error: written.error || written.reason }
            );
      },
      { root }
    );
  } catch (error) {
    return failure(
      "task_accept_decision_not_persisted",
      "验收决策无法安全持久化，任务不能标记为已接受",
      { path, error: error?.message || String(error) }
    );
  }
}

export function verifyPendingTaskArtifact(root, pending) {
  const shape = validateStoredReceipt({
    ...pending,
    protocolVersion: pending?.protocolVersion ?? RECEIPT_PROTOCOL_VERSION,
  });
  if (!shape.ok) return shape;

  const artifactPath = resolve(pending.artifact.path);
  const expectedArtifactPath = join(
    artifactsDir(root),
    `${pending.artifact.id}.md`
  );
  if (artifactPath !== expectedArtifactPath) {
    return failure(
      "artifact_path_changed",
      "待验收回执中的交付路径与交付物 ID 不一致",
      { path: artifactPath, expectedPath: expectedArtifactPath }
    );
  }
  if (resolve(pending.fingerprint.path) !== artifactPath) {
    return failure(
      "artifact_path_changed",
      "待验收回执中的交付路径与指纹路径不一致",
      { path: artifactPath }
    );
  }
  const verified = verifyGuardedArtifactFingerprint(root, pending.fingerprint);
  if (!verified.ok) return verified;
  const summary = { ...verified };
  delete summary.data;
  return summary;
}

export function verifyPendingTaskApprovalBinding(root, pending, run) {
  const shape = validateStoredReceipt(pending);
  if (!shape.ok) return shape;
  if (!run || typeof run !== "object") {
    return failure(
      "pending_approval_run_missing",
      "待验收回执没有可绑定的 TaskRun",
      { taskRunId: pending.taskRunId }
    );
  }
  if (run.id !== pending.taskRunId) {
    return failure(
      "pending_approval_run_mismatch",
      "待验收回执的 taskRunId 与 TaskRun.id 不一致",
      { taskRunId: pending.taskRunId, runId: run.id }
    );
  }
  if (run.employee_id !== pending.employeeId) {
    return failure(
      "pending_approval_employee_mismatch",
      "待验收回执的员工与 TaskRun 不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  if (run.requested_task_id !== pending.requestedTaskId) {
    return failure(
      "pending_approval_requested_task_mismatch",
      "待验收回执的请求任务与 TaskRun 不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  if (run.user_goal !== pending.goal) {
    return failure(
      "pending_approval_goal_mismatch",
      "待验收回执的目标与 TaskRun 不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  if (run.artifact !== pending.artifact.id) {
    return failure(
      "pending_approval_run_artifact_mismatch",
      "待验收回执的交付物与 TaskRun.artifact 不一致",
      { taskRunId: pending.taskRunId, runArtifactId: run.artifact }
    );
  }
  if (pending.reportPath) {
    const expectedReportPath = join(
      runsDir(root),
      `${pending.taskRunId}.report.md`
    );
    if (resolve(pending.reportPath) !== expectedReportPath) {
      return failure(
        "pending_approval_report_mismatch",
        "待验收回执的报告路径与 taskRunId 不一致",
        { taskRunId: pending.taskRunId }
      );
    }
  }

  const verified = verifyPendingTaskArtifact(root, pending);
  if (!verified.ok) return verified;

  const loadedArtifact = loadArtifact(root, pending.artifact.id);
  if (!loadedArtifact.ok) {
    return failure(
      "pending_approval_artifact_missing",
      "待验收回执绑定的交付物元数据缺失或损坏",
      {
        taskRunId: pending.taskRunId,
        artifactId: pending.artifact.id,
        artifactCode: loadedArtifact.code,
      }
    );
  }
  if (loadedArtifact.artifact?.id !== pending.artifact.id) {
    return failure(
      "pending_approval_artifact_id_mismatch",
      "待验收交付物元数据的 id 与回执不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  if (loadedArtifact.artifact?.task_id !== pending.taskRunId) {
    return failure(
      "pending_approval_artifact_task_mismatch",
      "待验收交付物元数据的 task_id 与回执不一致",
      { taskRunId: pending.taskRunId }
    );
  }
  return { ok: true, artifact: loadedArtifact.artifact, fingerprint: verified };
}

export function persistPendingTaskApproval(root, pending, { run } = {}) {
  const built = receiptFromPending(pending);
  if (!built.ok) return built;
  const receipt = built.receipt;
  const shape = validateStoredReceipt(receipt);
  if (!shape.ok) {
    return failure("pending_approval_invalid", shape.reason, {
      validationCode: shape.code,
    });
  }

  let path;
  try {
    path = pendingTaskApprovalPath(root, receipt.taskRunId);
  } catch (error) {
    return failure("pending_approval_path_unsafe", "待验收回执路径不安全", {
      error: error?.message || String(error),
    });
  }
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(
        readStateFileGuarded(path, { root }).toString("utf8")
      );
      const existingShape = validateStoredReceipt(existing, {
        file: basename(path),
      });
      if (!existingShape.ok) return { ...existingShape, path };
      if (canonicalJson(existing) !== canonicalJson(receipt)) {
        return failure(
          "pending_approval_conflict",
          "任务已有内容不同的待验收回执，拒绝覆盖",
          { path }
        );
      }
      const binding = verifyPendingTaskApprovalBinding(root, receipt, run);
      if (!binding.ok) return { ...binding, path };
      return { ok: true, path, existing: true };
    } catch (error) {
      return failure(
        "pending_approval_corrupt",
        "已有待验收回执无法读取，拒绝覆盖",
        { path, error: error?.message || String(error) }
      );
    }
  }

  const binding = verifyPendingTaskApprovalBinding(root, receipt, run);
  if (!binding.ok) return binding;
  const written = writeJsonDurably(path, receipt, { root });
  return written.ok
    ? written
    : failure(
        "pending_approval_not_persisted",
        "待验收状态无法持久化，不能进入审批",
        { path, error: written.error || written.reason }
      );
}

export function removePendingTaskApproval(root, taskRunId) {
  let path;
  try {
    path = pendingTaskApprovalPath(root, taskRunId);
    unlinkSync(path);
    return { ok: true, path };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, path, missing: true };
    return failure("pending_approval_remove_failed", "待验收回执删除失败", {
      path,
      error: error?.message || String(error),
    });
  }
}

export function findPendingTaskApproval(
  root,
  { employeeId, requestedTaskId } = {}
) {
  let dir;
  let files;
  try {
    dir = runsDir(root);
    files = readdirSync(dir)
      .filter(file => file.endsWith(RECEIPT_SUFFIX))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, pending: null };
    return failure("pending_approval_scan_failed", "无法扫描待验收回执", {
      error: error?.message || String(error),
    });
  }

  const candidates = [];
  for (const file of files) {
    let pending;
    try {
      const filePath = resolveStatePath(join(dir, file), root, {
        mustExist: true,
      });
      pending = JSON.parse(
        readStateFileGuarded(filePath, { root }).toString("utf8")
      );
    } catch (error) {
      return failure("pending_approval_corrupt", `待验收回执损坏：${file}`, {
        file,
        error: error?.message || String(error),
      });
    }
    const shape = validateStoredReceipt(pending, { file });
    if (!shape.ok) return { ...shape, file };
    if (employeeId && pending.employeeId !== employeeId) continue;
    if (requestedTaskId && pending.requestedTaskId !== requestedTaskId)
      continue;
    candidates.push(pending);
  }
  candidates.sort(
    (left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0)
  );
  if (candidates.length > 1) {
    return failure(
      "pending_approval_ambiguous",
      "同一任务存在多个待验收回执，拒绝猜测应恢复哪一个",
      { taskRunIds: candidates.map(candidate => candidate.taskRunId) }
    );
  }
  return { ok: true, pending: candidates[0] || null };
}
