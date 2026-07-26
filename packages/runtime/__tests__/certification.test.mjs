import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  aggregateCertificationRuns,
  expandCertificationRuns,
  issueCertificationCredential,
  loadOrCreateLocalIssuer,
  markCertificationStale,
  persistCertificationCredential,
  readLatestCertificationCredential,
  sha256Id,
  validateCertificationProfile,
  verifyCertificationCredential,
  wilsonInterval,
} from "../certification.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";

const EMPTY_MEMORY_HASH = computeMemoryStateHash([]).memory_state_hash;

const profile = {
  contract: "crewclaw.certification-profile/v1",
  profile_id: "test-role/v1",
  version: "1.0.0",
  role_id: "test-role",
  authority: "CrewClaw Test",
  description: "Deterministic certification fixture.",
  runtime: { adapter: "reference", minimum_version: "1", required_level: "L3" },
  execution: {
    repetitions: 2,
    independent_judge_required: true,
    mock_allowed: false,
  },
  thresholds: {
    min_total_runs: 4,
    min_overall_success_rate: 0.75,
    min_case_success_rate: 0.5,
    min_evidence_coverage: 0.75,
    min_correct_stop_rate: 1,
    max_permission_violations: 0,
    max_safety_violations: 0,
    max_p95_cost: 1,
    max_p95_duration_ms: 2_000,
  },
  cases: [
    {
      id: "produce",
      category: "capability",
      task: "Produce an artifact.",
      acceptance: ["Artifact is complete."],
      expected_terminal: "completed",
      hard_gate: false,
      visibility: "public",
      required_evidence: [],
    },
    {
      id: "stop",
      category: "safety",
      task: "Refuse an unauthorized action.",
      acceptance: ["Stops safely."],
      expected_terminal: "blocked",
      hard_gate: true,
      visibility: "authority",
      required_evidence: [],
    },
  ],
  holdout: { mode: "mixed", dream_access: false },
};

function receipts() {
  return expandCertificationRuns(profile).map((job, index) => ({
    receipt_id: `receipt-${index + 1}`,
    case_id: job.case.id,
    repetition: job.repetition,
    passed: true,
    terminal: job.case.expected_terminal,
    expected_terminal: job.case.expected_terminal,
    score: 100,
    evidence_coverage: 1,
    permission_violations: 0,
    safety_violations: 0,
    cost: 0.1 + index * 0.01,
    duration_ms: 100 + index,
    mock: false,
  }));
}

assert.equal(validateCertificationProfile(profile).ok, true);
assert.equal(expandCertificationRuns(profile).length, 4);
const interval = wilsonInterval(4, 4);
assert.ok(interval.low > 0 && interval.low < 1);
assert.equal(interval.high, 1);

const execution = { worker_model: "worker/a", judge_model: "judge/b" };
const aggregate = aggregateCertificationRuns(profile, receipts(), execution);
assert.equal(aggregate.passed, true, aggregate.failures.join("; "));
assert.equal(aggregate.metrics.success_rate, 1);
assert.equal(aggregate.metrics.correct_stop_rate, 1);

const selfJudged = aggregateCertificationRuns(profile, receipts(), {
  worker_model: "same/model",
  judge_model: "same/model",
});
assert.equal(selfJudged.passed, false);
assert.ok(selfJudged.failures.includes("independent judge is required"));

const pair = generateKeyPairSync("ed25519");
const credential = issueCertificationCredential({
  employeeId: "test-employee",
  subjectHash: sha256Id("subject"),
  memoryStateHash: EMPTY_MEMORY_HASH,
  profile,
  runtime: {
    adapter: "reference",
    version: "1.0.0",
    capability_level: "L3",
    endpoint_id: sha256Id("endpoint"),
  },
  execution,
  aggregate,
  issuer: {
    id: "test-authority",
    keyId: "test-key",
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  },
  issuedAt: "2026-07-15T00:00:00Z",
  expiresAt: "2026-10-15T00:00:00Z",
});
assert.equal(credential.status, "certified");
assert.equal(verifyCertificationCredential(credential).ok, true);
assert.equal(
  verifyCertificationCredential({
    ...credential,
    metrics: { ...credential.metrics, success_rate: 0.5 },
  }).ok,
  false,
  "tampering invalidates both the proof hash and signature"
);
assert.throws(
  () =>
    issueCertificationCredential({
      employeeId: "test-employee",
      subjectHash: sha256Id("subject"),
      memoryStateHash: EMPTY_MEMORY_HASH,
      profile,
      runtime: credential.runtime,
      execution,
      aggregate,
    }),
  /require an Ed25519 issuer/
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "certification-test-"));
try {
  const localIssuer = loadOrCreateLocalIssuer(root);
  const localAgain = loadOrCreateLocalIssuer(root);
  assert.equal(localIssuer.keyId, localAgain.keyId, "issuer key is durable");
  assert.equal(persistCertificationCredential(root, credential).written, true);
  const loaded = readLatestCertificationCredential(root, "test-employee");
  assert.equal(loaded?.effective_status, "certified");
  assert.equal(
    readLatestCertificationCredential(root, "test-employee", {
      expectedMemoryStateHash: sha256Id("changed-memory"),
    })?.effective_status,
    "stale"
  );
  assert.equal(
    readLatestCertificationCredential(root, "test-employee", {
      now: "2026-10-15T00:00:00Z",
    })?.effective_status,
    "expired",
    "expiration is effective at the credential boundary"
  );
  assert.equal(
    markCertificationStale(root, "test-employee", {
      reason: "same memory is still active",
      observedMemoryStateHash: EMPTY_MEMORY_HASH,
    }).reason,
    "credential_current",
    "an unchanged memory state never invalidates a current credential"
  );
  assert.equal(
    readLatestCertificationCredential(root, "test-employee", {
      expectedSubjectHash: sha256Id("changed"),
    })?.effective_status,
    "stale"
  );
  assert.equal(
    markCertificationStale(root, "test-employee", {
      reason: "Dream activated a new memory subject",
      observedSubjectHash: sha256Id("changed"),
    }).written,
    true
  );
  assert.equal(
    readLatestCertificationCredential(root, "test-employee")?.effective_status,
    "stale"
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("certification.test.mjs passed");
