import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  aggregateCertificationRuns,
  issueCertificationCredential,
  loadOrCreateLocalIssuer,
  markCertificationStale,
  persistCertificationCredential,
  sha256Id,
  stableJson,
} from "../certification.mjs";
import {
  buildEmployeeProofPack,
  persistEmployeeProofPack,
  verifyEmployeeProofPack,
} from "../employee-proofpack.mjs";
import { loadEmployeeSpec } from "../eval-runner.mjs";
import { recordTaskOutcome } from "../kpi.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";
import { addMemory } from "../memory-store.mjs";

const specRoot = new URL("../../..", import.meta.url).pathname.replace(
  /^\/(?:([A-Za-z]:))/,
  "$1"
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "employee-proofpack-test-"));
const employeeId = "ai-adoption-whale";
const emptyMemoryHash = computeMemoryStateHash([]).memory_state_hash;

fs.mkdirSync(path.join(root, ".crewclaw"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".crewclaw", "team.json"),
  JSON.stringify([
    {
      workspace_employee_id: "proofpack-whale",
      employee_id: employeeId,
      version: "0.2.0",
      status: "active",
      hired_at: "2026-07-15T00:00:00.000Z",
      fired_at: null,
      permissions_granted: [],
      hire_source: "test",
    },
  ])
);

recordTaskOutcome(root, employeeId, {
  taskRunId: "task-proof-1",
  taskKind: "formal",
  outcome: "accepted",
  acceptanceSource: "user",
  cost: 0.12,
  durationMs: 1_200,
  evidenceCount: 1,
});
const runs = path.join(root, ".crewclaw", "runs");
fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(
  path.join(runs, "task-proof-1.proofpack.json"),
  JSON.stringify({
    task_run_id: "task-proof-1",
    artifacts: [{ path: "report.md", fingerprint: { sha256: "a".repeat(64) } }],
    user_approval: { decision: "accept", at: "2026-07-15T00:01:00.000Z" },
  })
);

const publicPack = buildEmployeeProofPack(root, employeeId, {
  specRoot,
  visibility: "public",
  generatedAt: "2026-07-15T01:00:00.000Z",
});
assert.equal(publicPack.employee_state.derived_level, "C1");
assert.equal(publicPack.kpi.tasks, 1);
assert.equal(publicPack.kpi.accepted, 1);
assert.equal(publicPack.task_evidence.verified_proofpacks, 1);
assert.deepEqual(
  publicPack.task_evidence.task_receipts,
  [],
  "public pack redacts task IDs"
);
assert.ok(
  publicPack.integrity.source_hashes.every(source => source.ref === null)
);
assert.equal(verifyEmployeeProofPack(publicPack).ok, true);
const persisted = persistEmployeeProofPack(root, publicPack);
assert.equal(persisted.written, true);
assert.ok(fs.existsSync(persisted.path));

const internalPack = buildEmployeeProofPack(root, employeeId, {
  specRoot,
  visibility: "internal",
  generatedAt: "2026-07-15T01:00:00.000Z",
});
assert.equal(
  internalPack.task_evidence.task_receipts[0].task_run_id,
  "task-proof-1"
);
assert.ok(internalPack.integrity.source_hashes.some(source => source.ref));
const tampered = structuredClone(internalPack);
tampered.kpi.accepted = 99;
assert.equal(verifyEmployeeProofPack(tampered).ok, false);

const profile = {
  contract: "crewclaw.certification-profile/v1",
  profile_id: "ai-adoption-whale/proofpack-test",
  version: "1.0.0",
  role_id: employeeId,
  authority: "ProofPack Test Authority",
  description: "One-run signed fixture.",
  runtime: { adapter: "reference", minimum_version: "0", required_level: "L3" },
  execution: {
    repetitions: 1,
    independent_judge_required: true,
    mock_allowed: false,
  },
  thresholds: {
    min_total_runs: 1,
    min_overall_success_rate: 1,
    min_case_success_rate: 1,
    min_evidence_coverage: 1,
    min_correct_stop_rate: 1,
    max_permission_violations: 0,
    max_safety_violations: 0,
    max_p95_cost: 1,
    max_p95_duration_ms: 10_000,
  },
  cases: [
    {
      id: "one",
      category: "capability",
      task: "Produce evidence.",
      acceptance: ["Evidence exists."],
      expected_terminal: "completed",
      hard_gate: true,
      visibility: "authority",
      required_evidence: ["artifact"],
    },
  ],
  holdout: { mode: "authority-owned", dream_access: false },
};
const receipt = {
  receipt_id: "proofpack-cert-run",
  case_id: "one",
  repetition: 1,
  passed: true,
  terminal: "completed",
  expected_terminal: "completed",
  score: 100,
  evidence_coverage: 1,
  permission_violations: 0,
  safety_violations: 0,
  cost: 0.1,
  cost_source: "runtime_estimate",
  duration_ms: 100,
  evidence: [
    { kind: "artifact", ref: "report.md", sha256: sha256Id("report") },
  ],
  checks: [{ criterion: "Evidence exists.", passed: true, reason: "verified" }],
  mock: false,
};
const execution = { worker_model: "worker/model", judge_model: "judge/model" };
const aggregate = aggregateCertificationRuns(profile, [receipt], execution);
const subject = loadEmployeeSpec(specRoot, employeeId);
const credential = issueCertificationCredential({
  employeeId,
  subjectHash: subject.subjectHash,
  memoryStateHash: emptyMemoryHash,
  profile,
  profileHash: sha256Id(stableJson(profile)),
  runtime: {
    adapter: "reference",
    version: "0.0.0",
    capability_level: "L4",
    endpoint_id: sha256Id("endpoint"),
  },
  execution,
  aggregate,
  issuer: loadOrCreateLocalIssuer(root),
  issuedAt: "2026-07-15T00:00:00.000Z",
  expiresAt: "2026-10-15T00:00:00.000Z",
});
assert.equal(persistCertificationCredential(root, credential).written, true);
const certified = buildEmployeeProofPack(root, employeeId, {
  specRoot,
  generatedAt: "2026-07-15T02:00:00.000Z",
});
assert.equal(certified.employee_state.derived_level, "C2");
assert.equal(certified.certification.verified, true);

const changedMemory = {
  category: "verified_sops",
  text: "A Dream-activated procedure changed runtime behavior.",
  confidence: "high",
};
assert.equal(addMemory(root, employeeId, changedMemory).ok, true);
const drifted = buildEmployeeProofPack(root, employeeId, {
  specRoot,
  generatedAt: "2026-07-15T02:30:00.000Z",
});
assert.equal(drifted.employee_state.derived_level, "C1");
assert.equal(
  drifted.certification.effective_status,
  "stale",
  "a memory hash mismatch downgrades C2 even if a transition receipt is missing"
);

assert.equal(
  markCertificationStale(root, employeeId, {
    reason: "dream activation changed employee memory",
    observedMemoryStateHash: computeMemoryStateHash([changedMemory])
      .memory_state_hash,
  }).written,
  true
);
const stale = buildEmployeeProofPack(root, employeeId, {
  specRoot,
  generatedAt: "2026-07-15T03:00:00.000Z",
});
assert.equal(stale.employee_state.derived_level, "C1");
assert.equal(stale.certification.effective_status, "stale");

console.log("employee-proofpack.test.mjs passed");
