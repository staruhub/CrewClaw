import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  issueCertificationCredential,
  loadOrCreateLocalIssuer,
  persistCertificationCredential,
  readLatestCertificationCredential,
  sha256Id,
} from "../certification.mjs";
import {
  activateDreamCandidate,
  approveDreamCandidate,
  assessDreamFromWorkspace,
  buildDreamMorningReport,
  generateDreamCandidate,
  inspectDreamJob,
  rollbackDreamActivation,
} from "../dream-controller.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";
import { loadMemory } from "../memory-store.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";

const root = mkdtempSync(join(tmpdir(), "crew-dream-lifecycle-"));
const employeeId = "dream-lifecycle-agent";
const now = Date.parse("2026-07-14T08:00:00.000Z");

function certifyMemory(memoryStateHash, issuedAt) {
  const run = {
    receipt_id: `run-${memoryStateHash.slice(-12)}`,
    case_id: "dream-memory-binding",
    repetition: 1,
    passed: true,
    terminal: "completed",
    expected_terminal: "completed",
    score: 100,
    evidence_coverage: 1,
    permission_violations: 0,
    safety_violations: 0,
    cost: 0.01,
    cost_source: "runtime_estimate",
    duration_ms: 100,
    evidence: [],
    checks: [{ criterion: "memory binding", passed: true, reason: "verified" }],
    mock: false,
  };
  const credential = issueCertificationCredential({
    employeeId,
    subjectHash: sha256Id("dream-lifecycle-subject"),
    memoryStateHash,
    profile: { profile_id: "dream-lifecycle/v1", version: "1.0.0" },
    runtime: {
      adapter: "reference",
      version: "1.0.0",
      capability_level: "L4",
      endpoint_id: sha256Id("dream-runtime"),
    },
    execution: { worker_model: "worker/model", judge_model: "judge/model" },
    aggregate: {
      passed: true,
      independent_judge: true,
      sample_size: 1,
      metrics: {
        success_rate: 1,
        success_confidence_low: 1,
        success_confidence_high: 1,
        correct_stop_rate: 1,
        evidence_coverage: 1,
        cost_p50: 0.01,
        cost_p95: 0.01,
        duration_p50_ms: 100,
        duration_p95_ms: 100,
      },
      permission_violations: 0,
      safety_violations: 0,
      failures: [],
      runs: [run],
    },
    issuer: loadOrCreateLocalIssuer(root),
    issuedAt,
    expiresAt: "2026-10-14T08:00:00.000Z",
  });
  assert.equal(persistCertificationCredential(root, credential).written, true);
  return credential;
}

try {
  for (let index = 1; index <= 8; index += 1) {
    const reflection = buildReflection(
      {
        id: `task-${index}`,
        employee_id: employeeId,
        status: "accepted",
        output_valid: true,
        artifact: `artifact-${index}`,
        user_feedback: "verified useful outcome",
        started_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:01:00.000Z",
      },
      {
        evidenceIds: [`evidence-${index}`],
        createdAt: new Date(now - (9 - index) * 1_000).toISOString(),
      }
    );
    assert.equal(writeReflection(root, reflection).ok, true);
  }

  const assessment = assessDreamFromWorkspace(root, employeeId, { now });
  assert.equal(assessment.recommended, true);
  const curate = async input => ({
    value: {
      summary: "将已验证的成功交付沉淀为稳定 SOP。",
      entries: [
        {
          op: "add",
          reason: "八次受信任务均支持该工作法",
          confidence: "high",
          source_task_ids: [input.reflections[0].task_id],
          evidence_ids: input.reflections[0].evidence_ids,
          item: {
            category: "verified_sops",
            text: "交付前逐项核对验收标准，并保留可复验的证据。",
            confidence: "high",
          },
        },
      ],
    },
    actual_cost_usd: 0.0123,
  });
  const evaluateCandidate = async items => ({
    score: 86,
    verdict: "PASS",
    mock: false,
    provider_status: "verified",
    memory_state_hash: computeMemoryStateHash(items).memory_state_hash,
    evaluated_at: now,
    model: "deterministic-test-evaluator",
  });

  const reviewOnly = await generateDreamCandidate(root, assessment, {
    dreamId: "dream-review-only",
    curate,
    modelId: "deterministic-test-curator",
    evaluateCandidate,
    now,
  });
  assert.equal(reviewOnly.ok, true);
  assert.equal(reviewOnly.job.state, "REVIEW_REQUIRED");
  assert.equal(
    approveDreamCandidate(root, employeeId, reviewOnly.dreamId, { now }).ok,
    true
  );
  const blocked = activateDreamCandidate(root, employeeId, reviewOnly.dreamId, {
    now,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.includes("baseline_missing"));
  assert.deepEqual(
    loadMemory(root, employeeId).items,
    [],
    "review candidate never leaks into recall"
  );

  const baseline = {
    score: 84,
    verdict: "PASS",
    mock: false,
    provider_status: "verified",
    memory_state_hash: assessment.base_memory_hash,
    evaluated_at: now,
    model: "deterministic-test-baseline",
  };
  const generated = await generateDreamCandidate(root, assessment, {
    dreamId: "dream-full-lifecycle",
    curate,
    modelId: "deterministic-test-curator",
    baseline,
    evaluateCandidate,
    now: now + 1_000,
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.validation.candidate_eval.mock, false);
  assert.equal(
    approveDreamCandidate(root, employeeId, generated.dreamId, { now }).ok,
    true
  );
  assert.equal(
    approveDreamCandidate(root, employeeId, generated.dreamId, {
      now: now + 5_000,
    }).replayed,
    true,
    "approval retry reuses the immutable receipt"
  );
  certifyMemory(assessment.base_memory_hash, "2026-07-14T07:00:00.000Z");
  const activated = activateDreamCandidate(
    root,
    employeeId,
    generated.dreamId,
    { now }
  );
  assert.equal(activated.ok, true);
  assert.equal(activated.certification.written, true);
  assert.equal(
    activated.certification.receipt.observed_memory_state_hash,
    generated.job.candidate_memory_hash
  );
  assert.equal(
    readLatestCertificationCredential(root, employeeId)?.effective_status,
    "stale",
    "Dream activation invalidates a credential bound to the previous memory"
  );
  assert.equal(
    inspectDreamJob(root, employeeId, generated.dreamId).job.state,
    "ACTIVE"
  );
  const activeMorningReport = buildDreamMorningReport(root, employeeId);
  assert.equal(activeMorningReport.ok, true);
  assert.equal(activeMorningReport.report.dream_id, generated.dreamId);
  assert.equal(activeMorningReport.report.state, "ACTIVE");
  assert.equal(activeMorningReport.report.reviewed_count, 1);
  assert.equal(activeMorningReport.report.added_count, 1);
  assert.equal(activeMorningReport.report.activated, true);
  assert.equal(loadMemory(root, employeeId).items.length, 1);
  assert.equal(
    JSON.parse(readFileSync(activated.activation.archived_to, "utf8")).length,
    0,
    "activation archives the exact pre-swap store"
  );

  certifyMemory(
    generated.job.candidate_memory_hash,
    "2026-07-14T08:00:05.000Z"
  );
  assert.equal(
    readLatestCertificationCredential(root, employeeId, {
      expectedMemoryStateHash: generated.job.candidate_memory_hash,
    })?.effective_status,
    "certified",
    "recertification on the activated memory restores C2 eligibility"
  );

  const rolledBack = rollbackDreamActivation(
    root,
    employeeId,
    generated.dreamId,
    {
      now: now + 10_000,
    }
  );
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.certification.written, true);
  assert.equal(
    rolledBack.certification.receipt.observed_memory_state_hash,
    activated.activation.previous_memory_hash
  );
  assert.equal(
    readLatestCertificationCredential(root, employeeId)?.effective_status,
    "stale",
    "rollback invalidates a credential bound to the activated memory"
  );
  assert.deepEqual(loadMemory(root, employeeId).items, []);
  assert.equal(
    inspectDreamJob(root, employeeId, generated.dreamId).job.state,
    "ROLLED_BACK"
  );
  const rolledBackMorningReport = buildDreamMorningReport(root, employeeId);
  assert.equal(rolledBackMorningReport.ok, true);
  assert.equal(rolledBackMorningReport.report.state, "ROLLED_BACK");
  assert.equal(rolledBackMorningReport.report.activated, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("dream lifecycle test passed");
