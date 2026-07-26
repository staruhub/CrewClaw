import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
  writeStateFileAtomic,
} from "./state-lock.mjs";
import { resolvePathInsideRoot } from "./tool-gateway.mjs";
import yaml from "./yaml.mjs";

export const CERTIFICATION_PROFILE_CONTRACT =
  "crewclaw.certification-profile/v1";
export const CERTIFICATION_CREDENTIAL_CONTRACT =
  "crewclaw.certification-credential/v1";
export const CERTIFICATION_STATUS_CONTRACT = "crewclaw.certification-status/v1";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const TERMINALS = new Set(["completed", "blocked", "rejected", "failed"]);

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

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Id(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ratio(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function validateCertificationProfile(profile) {
  const errors = [];
  if (!isObject(profile)) {
    return { ok: false, errors: ["profile must be an object"] };
  }
  if (profile.contract !== CERTIFICATION_PROFILE_CONTRACT)
    errors.push(`contract must be ${CERTIFICATION_PROFILE_CONTRACT}`);
  for (const key of [
    "profile_id",
    "version",
    "role_id",
    "authority",
    "description",
  ]) {
    if (typeof profile[key] !== "string" || !profile[key].trim())
      errors.push(`${key} must be a non-empty string`);
  }
  if (!isObject(profile.runtime)) errors.push("runtime must be an object");
  if (!isObject(profile.execution)) errors.push("execution must be an object");
  if (profile.execution?.mock_allowed !== false)
    errors.push("execution.mock_allowed must be false");
  if (
    !Number.isInteger(profile.execution?.repetitions) ||
    profile.execution.repetitions < 1 ||
    profile.execution.repetitions > 20
  ) {
    errors.push("execution.repetitions must be within 1..20");
  }
  if (!isObject(profile.thresholds))
    errors.push("thresholds must be an object");
  for (const key of [
    "min_overall_success_rate",
    "min_case_success_rate",
    "min_evidence_coverage",
    "min_correct_stop_rate",
  ]) {
    if (
      !Number.isFinite(profile.thresholds?.[key]) ||
      profile.thresholds[key] < 0 ||
      profile.thresholds[key] > 1
    ) {
      errors.push(`thresholds.${key} must be within 0..1`);
    }
  }
  if (!Array.isArray(profile.cases) || profile.cases.length === 0) {
    errors.push("cases must be a non-empty array");
  }
  const ids = new Set();
  let configuredRuns = 0;
  for (const [index, testCase] of (profile.cases || []).entries()) {
    if (!isObject(testCase)) {
      errors.push(`cases[${index}] must be an object`);
      continue;
    }
    if (typeof testCase.id !== "string" || !SAFE_ID.test(testCase.id))
      errors.push(`cases[${index}].id is invalid`);
    else if (ids.has(testCase.id))
      errors.push(`duplicate case id: ${testCase.id}`);
    else ids.add(testCase.id);
    if (typeof testCase.task !== "string" || !testCase.task.trim())
      errors.push(`cases[${index}].task is required`);
    if (
      !Array.isArray(testCase.acceptance) ||
      testCase.acceptance.length === 0 ||
      testCase.acceptance.some(item => typeof item !== "string" || !item.trim())
    ) {
      errors.push(`cases[${index}].acceptance must be non-empty strings`);
    }
    if (
      !["completed", "blocked", "rejected"].includes(testCase.expected_terminal)
    ) {
      errors.push(`cases[${index}].expected_terminal is invalid`);
    }
    const repetitions =
      testCase.repetitions ?? profile.execution?.repetitions ?? 0;
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
      errors.push(`cases[${index}].repetitions must be within 1..20`);
    configuredRuns += repetitions;
  }
  if (
    !Number.isInteger(profile.thresholds?.min_total_runs) ||
    profile.thresholds.min_total_runs < 1 ||
    profile.thresholds.min_total_runs > configuredRuns
  ) {
    errors.push(
      `thresholds.min_total_runs must be within 1..${configuredRuns}`
    );
  }
  if (profile.holdout?.dream_access !== false)
    errors.push("holdout.dream_access must be false");
  return { ok: errors.length === 0, errors, configured_runs: configuredRuns };
}

export function loadCertificationProfile(root, profileRef) {
  if (typeof profileRef !== "string" || !SAFE_ID.test(profileRef)) {
    throw new Error(`invalid certification profile ref: ${String(profileRef)}`);
  }
  const profilesRoot = resolve(root, "certification", "profiles");
  const checked = resolvePathInsideRoot(
    join(profilesRoot, `${profileRef}.yaml`),
    profilesRoot,
    { mustExist: true, rejectSymlinks: true }
  );
  if (!checked.ok)
    throw new Error(`unsafe certification profile: ${checked.error}`);
  const profile = yaml.load(readFileSync(checked.path, "utf8")) || {};
  const validation = validateCertificationProfile(profile);
  if (!validation.ok) {
    throw new Error(
      `invalid certification profile ${profileRef}: ${validation.errors.join("; ")}`
    );
  }
  return {
    profile,
    path: checked.path,
    profileHash: sha256Id(stableJson(profile)),
    configuredRuns: validation.configured_runs,
  };
}

export function expandCertificationRuns(profile, { repetitions } = {}) {
  const validation = validateCertificationProfile(profile);
  if (!validation.ok)
    throw new Error(
      `invalid certification profile: ${validation.errors.join("; ")}`
    );
  const jobs = [];
  for (const testCase of profile.cases) {
    const count =
      repetitions ?? testCase.repetitions ?? profile.execution.repetitions;
    if (!Number.isInteger(count) || count < 1 || count > 20)
      throw new Error("certification repetitions must be within 1..20");
    for (let repetition = 1; repetition <= count; repetition += 1) {
      jobs.push({ case: testCase, repetition });
    }
  }
  return jobs;
}

export function wilsonInterval(successes, total, z = 1.96) {
  if (!Number.isInteger(total) || total <= 0) return { low: 0, high: 0 };
  const p = Math.max(0, Math.min(total, successes)) / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return {
    low: ratio((centre - margin) / denominator),
    high: ratio((centre + margin) / denominator),
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.map(value => finite(value)).sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function aggregateCertificationRuns(profile, runs, execution = {}) {
  const validation = validateCertificationProfile(profile);
  if (!validation.ok)
    throw new Error(
      `invalid certification profile: ${validation.errors.join("; ")}`
    );
  if (!Array.isArray(runs)) throw new Error("runs must be an array");
  const thresholds = profile.thresholds;
  const failures = [];
  const byCase = new Map(profile.cases.map(item => [item.id, []]));
  const receiptIds = new Set();
  for (const [index, run] of runs.entries()) {
    if (!isObject(run)) {
      failures.push(`run ${index + 1} is invalid`);
      continue;
    }
    if (run.mock !== false) failures.push(`run ${index + 1} is mock`);
    if (!TERMINALS.has(run.terminal))
      failures.push(`run ${index + 1} terminal is invalid`);
    if (!byCase.has(run.case_id))
      failures.push(`run ${index + 1} references unknown case ${run.case_id}`);
    else byCase.get(run.case_id).push(run);
    if (receiptIds.has(run.receipt_id))
      failures.push(`duplicate run receipt ${run.receipt_id}`);
    receiptIds.add(run.receipt_id);
  }
  const successes = runs.filter(run => run?.passed === true).length;
  const confidence = wilsonInterval(successes, runs.length);
  const successRate = runs.length ? successes / runs.length : 0;
  const stopRuns = runs.filter(run => run?.expected_terminal !== "completed");
  const correctStops = stopRuns.filter(
    run => run.passed && run.terminal === run.expected_terminal
  ).length;
  const correctStopRate = stopRuns.length ? correctStops / stopRuns.length : 1;
  const evidenceCoverage = runs.length
    ? runs.reduce((sum, run) => sum + ratio(run?.evidence_coverage), 0) /
      runs.length
    : 0;
  const permissionViolations = runs.reduce(
    (sum, run) => sum + Math.max(0, finite(run?.permission_violations)),
    0
  );
  const safetyViolations = runs.reduce(
    (sum, run) => sum + Math.max(0, finite(run?.safety_violations)),
    0
  );
  if (runs.length < thresholds.min_total_runs)
    failures.push(
      `sample size ${runs.length} is below ${thresholds.min_total_runs}`
    );
  if (successRate < thresholds.min_overall_success_rate)
    failures.push("overall success rate is below threshold");
  if (evidenceCoverage < thresholds.min_evidence_coverage)
    failures.push("evidence coverage is below threshold");
  if (correctStopRate < thresholds.min_correct_stop_rate)
    failures.push("correct-stop rate is below threshold");
  if (permissionViolations > thresholds.max_permission_violations)
    failures.push("permission violations exceed threshold");
  if (safetyViolations > thresholds.max_safety_violations)
    failures.push("safety violations exceed threshold");
  for (const testCase of profile.cases) {
    const caseRuns = byCase.get(testCase.id) || [];
    const expected = testCase.repetitions ?? profile.execution.repetitions;
    if (caseRuns.length < expected)
      failures.push(`${testCase.id} has ${caseRuns.length}/${expected} runs`);
    const caseRate = caseRuns.length
      ? caseRuns.filter(run => run.passed).length / caseRuns.length
      : 0;
    if (caseRate < thresholds.min_case_success_rate)
      failures.push(`${testCase.id} success rate is below threshold`);
    if (testCase.hard_gate && caseRuns.some(run => !run.passed))
      failures.push(`${testCase.id} hard gate failed`);
  }
  const independentJudge =
    Boolean(execution.worker_model) &&
    Boolean(execution.judge_model) &&
    execution.worker_model !== execution.judge_model;
  if (profile.execution.independent_judge_required && !independentJudge)
    failures.push("independent judge is required");
  const costs = runs.map(run => finite(run?.cost));
  const durations = runs.map(run => finite(run?.duration_ms));
  const metrics = {
    success_rate: ratio(successRate),
    success_confidence_low: confidence.low,
    success_confidence_high: confidence.high,
    correct_stop_rate: ratio(correctStopRate),
    evidence_coverage: ratio(evidenceCoverage),
    cost_p50: percentile(costs, 0.5),
    cost_p95: percentile(costs, 0.95),
    duration_p50_ms: percentile(durations, 0.5),
    duration_p95_ms: percentile(durations, 0.95),
    cost_currency: "USD",
  };
  if (
    Number.isFinite(thresholds.max_p95_cost) &&
    metrics.cost_p95 > thresholds.max_p95_cost
  )
    failures.push("p95 cost exceeds threshold");
  if (
    Number.isFinite(thresholds.max_p95_duration_ms) &&
    metrics.duration_p95_ms > thresholds.max_p95_duration_ms
  )
    failures.push("p95 duration exceeds threshold");
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    metrics,
    permission_violations: permissionViolations,
    safety_violations: safetyViolations,
    independent_judge: independentJudge,
    sample_size: runs.length,
    runs,
  };
}

function proofPayload(credential) {
  return {
    employee_id: credential.employee_id,
    subject_hash: credential.subject_hash,
    memory_state_hash: credential.memory_state_hash,
    profile: credential.profile,
    runtime: credential.runtime,
    execution: credential.execution,
    sample_size: credential.sample_size,
    metrics: credential.metrics,
    hard_gates: credential.hard_gates,
    runs: credential.runs,
  };
}

function signaturePayload(credential) {
  return stableJson({
    ...credential,
    issuer: credential.issuer ? { ...credential.issuer, signature: "" } : null,
  });
}

export function issueCertificationCredential({
  employeeId,
  subjectHash,
  memoryStateHash,
  profile,
  profileHash = sha256Id(stableJson(profile)),
  runtime,
  execution,
  aggregate,
  issuer = null,
  issuedAt = new Date().toISOString(),
  expiresAt = null,
}) {
  if (!SAFE_ID.test(employeeId)) throw new Error("invalid employee id");
  if (!SHA256.test(subjectHash)) throw new Error("invalid subject hash");
  if (!SHA256.test(memoryStateHash))
    throw new Error("invalid memory state hash");
  const status = aggregate.passed ? "certified" : "failed";
  const base = {
    contract: CERTIFICATION_CREDENTIAL_CONTRACT,
    credential_id: "",
    employee_id: employeeId,
    subject_hash: subjectHash,
    memory_state_hash: memoryStateHash,
    status,
    profile: {
      id: profile.profile_id,
      version: profile.version,
      hash: profileHash,
    },
    runtime,
    execution: {
      worker_model: execution.worker_model,
      judge_model: execution.judge_model,
      independent_judge: aggregate.independent_judge,
    },
    issued_at: issuedAt,
    expires_at: expiresAt,
    mock: false,
    sample_size: aggregate.sample_size,
    metrics: aggregate.metrics,
    hard_gates: {
      passed: aggregate.passed,
      permission_violations: aggregate.permission_violations,
      safety_violations: aggregate.safety_violations,
      failures: aggregate.failures,
    },
    runs: aggregate.runs,
    proof_pack_hash: "",
    issuer: null,
    status_reason: aggregate.passed ? null : aggregate.failures.join("; "),
  };
  base.proof_pack_hash = sha256Id(stableJson(proofPayload(base)));
  base.credential_id = `cred-${employeeId}-${base.proof_pack_hash.slice(-16)}`;
  if (!aggregate.passed) return base;
  if (!issuer?.privateKey || !issuer?.publicKey)
    throw new Error("certified credentials require an Ed25519 issuer");
  const publicKey = issuer.publicKey.export({ type: "spki", format: "pem" });
  base.issuer = {
    id: issuer.id || "crewclaw-local",
    key_id: issuer.keyId || sha256Id(publicKey).slice(-16),
    algorithm: "Ed25519",
    public_key: String(publicKey),
    signature: "",
  };
  base.issuer.signature = signBytes(
    null,
    Buffer.from(signaturePayload(base)),
    issuer.privateKey
  ).toString("base64");
  return base;
}

export function verifyCertificationCredential(credential) {
  const failures = [];
  if (!isObject(credential)) return { ok: false, failures: ["not an object"] };
  if (credential.contract !== CERTIFICATION_CREDENTIAL_CONTRACT)
    failures.push("credential contract is invalid");
  if (credential.mock !== false) failures.push("credential is mock");
  if (!SHA256.test(credential.subject_hash || ""))
    failures.push("subject hash is invalid");
  if (!SHA256.test(credential.memory_state_hash || ""))
    failures.push("memory state hash is invalid");
  if (!Array.isArray(credential.runs) || credential.runs.length === 0)
    failures.push("run receipts are missing");
  if (credential.sample_size !== credential.runs?.length)
    failures.push("sample size does not match run receipts");
  const expectedProofHash = sha256Id(stableJson(proofPayload(credential)));
  if (credential.proof_pack_hash !== expectedProofHash)
    failures.push("proof pack hash mismatch");
  if (credential.status === "certified") {
    if (!credential.hard_gates?.passed)
      failures.push("certified credential failed hard gates");
    if (!credential.issuer?.signature || !credential.issuer?.public_key) {
      failures.push("certified credential is unsigned");
    } else {
      try {
        const valid = verifyBytes(
          null,
          Buffer.from(signaturePayload(credential)),
          credential.issuer.public_key,
          Buffer.from(credential.issuer.signature, "base64")
        );
        if (!valid) failures.push("credential signature is invalid");
      } catch {
        failures.push("credential signature cannot be verified");
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

export function loadOrCreateLocalIssuer(root) {
  const base = join(root, ".crewclaw", "certification", "issuer");
  const privatePath = resolveStatePath(join(base, "ed25519-private.pem"), root);
  const publicPath = resolveStatePath(join(base, "ed25519-public.pem"), root);
  return withStateLock(
    `${privatePath}.lock`,
    () => {
      if (existsSync(privatePath) !== existsSync(publicPath))
        throw new Error("local certification issuer keypair is incomplete");
      if (!existsSync(privatePath)) {
        const pair = generateKeyPairSync("ed25519");
        const privatePem = pair.privateKey.export({
          type: "pkcs8",
          format: "pem",
        });
        const publicPem = pair.publicKey.export({
          type: "spki",
          format: "pem",
        });
        writeStateFileAtomic(privatePath, privatePem, { root });
        writeStateFileAtomic(publicPath, publicPem, { root });
      }
      const privatePem = readStateFileGuarded(privatePath, { root });
      const publicPem = readStateFileGuarded(publicPath, { root });
      return {
        id: "crewclaw-local",
        keyId: sha256Id(publicPem).slice(-16),
        privateKey: createPrivateKey(privatePem),
        publicKey: createPublicKey(publicPem),
      };
    },
    { root }
  );
}

function credentialDir(root, employeeId) {
  if (!SAFE_ID.test(employeeId)) throw new Error("invalid employee id");
  return join(root, ".crewclaw", "certification", employeeId);
}

export function persistCertificationCredential(root, credential) {
  const verification = verifyCertificationCredential(credential);
  if (!verification.ok)
    return { written: false, reason: verification.failures.join("; ") };
  const dir = credentialDir(root, credential.employee_id);
  const credentialPath = resolveStatePath(
    join(dir, "credentials", `${credential.credential_id}.json`),
    root
  );
  const latestPath = resolveStatePath(join(dir, "latest.json"), root);
  return withStateLock(
    `${latestPath}.lock`,
    () => {
      if (existsSync(credentialPath)) {
        const prior = JSON.parse(
          readStateFileGuarded(credentialPath, { root }).toString("utf8")
        );
        if (stableJson(prior) !== stableJson(credential))
          return { written: false, reason: "credential id conflict" };
      } else {
        writeJsonAtomic(credentialPath, credential, { root });
      }
      const pointer = {
        contract: "crewclaw.certification-latest/v1",
        employee_id: credential.employee_id,
        credential_id: credential.credential_id,
        credential_path: credentialPath,
        subject_hash: credential.subject_hash,
        memory_state_hash: credential.memory_state_hash,
        profile: credential.profile,
        status: credential.status,
        updated_at: new Date().toISOString(),
      };
      writeJsonAtomic(latestPath, pointer, { root });
      return { written: true, path: credentialPath, latestPath };
    },
    { root }
  );
}

export function markCertificationStale(
  root,
  employeeId,
  {
    reason,
    observedSubjectHash = null,
    observedMemoryStateHash = null,
    at = new Date().toISOString(),
  } = {}
) {
  if (observedSubjectHash !== null && !SHA256.test(observedSubjectHash))
    throw new Error("invalid observed subject hash");
  if (observedMemoryStateHash !== null && !SHA256.test(observedMemoryStateHash))
    throw new Error("invalid observed memory state hash");
  const current = readLatestCertificationCredential(root, employeeId);
  if (!current) return { written: false, reason: "credential_missing" };
  const hasObservedHash =
    observedSubjectHash !== null || observedMemoryStateHash !== null;
  const subjectMatches =
    observedSubjectHash === null ||
    current.subject_hash === observedSubjectHash;
  const memoryMatches =
    observedMemoryStateHash === null ||
    current.memory_state_hash === observedMemoryStateHash;
  if (hasObservedHash && subjectMatches && memoryMatches) {
    return {
      written: false,
      reason: "credential_current",
      credential_id: current.credential_id,
    };
  }
  const statusPath = resolveStatePath(
    join(
      credentialDir(root, employeeId),
      "status",
      `${current.credential_id}.json`
    ),
    root
  );
  const receiptBase = {
    contract: CERTIFICATION_STATUS_CONTRACT,
    employee_id: employeeId,
    credential_id: current.credential_id,
    status: "stale",
    reason: String(reason || "certification subject changed"),
    credential_subject_hash: current.subject_hash,
    observed_subject_hash: observedSubjectHash,
    credential_memory_state_hash: current.memory_state_hash,
    observed_memory_state_hash: observedMemoryStateHash,
    recorded_at: at,
  };
  const receipt = {
    ...receiptBase,
    receipt_id: `status-${sha256Id(stableJson(receiptBase)).slice(-16)}`,
  };
  const historyPath = resolveStatePath(
    join(
      credentialDir(root, employeeId),
      "status-history",
      `${receipt.receipt_id}.json`
    ),
    root
  );
  return withStateLock(
    `${statusPath}.lock`,
    () => {
      if (existsSync(historyPath)) {
        const prior = JSON.parse(
          readStateFileGuarded(historyPath, { root }).toString("utf8")
        );
        if (stableJson(prior) !== stableJson(receipt))
          return { written: false, reason: "status receipt id conflict" };
      } else {
        writeJsonAtomic(historyPath, receipt, { root });
      }
      writeJsonAtomic(statusPath, receipt, { root });
      return { written: true, path: statusPath, historyPath, receipt };
    },
    { root }
  );
}

export function readLatestCertificationCredential(
  root,
  employeeId,
  {
    expectedSubjectHash = null,
    expectedMemoryStateHash = null,
    now = Date.now(),
  } = {}
) {
  try {
    const dir = credentialDir(root, employeeId);
    const latestPath = resolveStatePath(join(dir, "latest.json"), root, {
      mustExist: true,
    });
    if (!existsSync(latestPath)) return null;
    const pointer = JSON.parse(
      readStateFileGuarded(latestPath, { root }).toString("utf8")
    );
    if (
      pointer.employee_id !== employeeId ||
      typeof pointer.credential_id !== "string" ||
      !SAFE_ID.test(pointer.credential_id)
    )
      return null;
    const credentialPath = resolveStatePath(pointer.credential_path, root, {
      mustExist: true,
    });
    const credential = JSON.parse(
      readStateFileGuarded(credentialPath, { root }).toString("utf8")
    );
    const verification = verifyCertificationCredential(credential);
    if (!verification.ok) return null;
    const statusPath = resolveStatePath(
      join(dir, "status", `${credential.credential_id}.json`),
      root,
      { mustExist: false }
    );
    let effectiveStatus = credential.status;
    let statusReceipt = null;
    if (existsSync(statusPath)) {
      statusReceipt = JSON.parse(
        readStateFileGuarded(statusPath, { root }).toString("utf8")
      );
      if (
        statusReceipt.contract === CERTIFICATION_STATUS_CONTRACT &&
        statusReceipt.credential_id === credential.credential_id
      )
        effectiveStatus = statusReceipt.status;
    }
    const nowMs =
      now instanceof Date
        ? now.getTime()
        : typeof now === "string"
          ? Date.parse(now)
          : Number(now);
    if (
      effectiveStatus === "certified" &&
      credential.expires_at &&
      Number.isFinite(nowMs) &&
      Date.parse(credential.expires_at) <= nowMs
    )
      effectiveStatus = "expired";
    if (
      effectiveStatus === "certified" &&
      expectedSubjectHash &&
      credential.subject_hash !== expectedSubjectHash
    )
      effectiveStatus = "stale";
    if (
      effectiveStatus === "certified" &&
      expectedMemoryStateHash &&
      credential.memory_state_hash !== expectedMemoryStateHash
    )
      effectiveStatus = "stale";
    return {
      ...credential,
      effective_status: effectiveStatus,
      status_receipt: statusReceipt,
    };
  } catch {
    return null;
  }
}
