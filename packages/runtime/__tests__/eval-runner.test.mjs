// eval-runner.test.mjs — unit tests for the pure pieces of the eval runner (v0.18 Milestone B):
// spec loading, the persist guard, and the defensive read. The spawn-driven scoring itself is a
// separate slow e2e (eval-runner drives the real engine), kept out of the fast unit suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmployeeSpec, persistEval, readEvalResult } from "../eval-runner.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-runner-test-"));
}

// packages/runtime/__tests__/ → repo root is three levels up (cross-platform via fileURLToPath).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function loadsRealWhaleSpec() {
  // The runner reads a real employee's eval_suite + rubric off disk.
  const spec = loadEmployeeSpec(REPO_ROOT, "ai-adoption-whale");
  assert.ok(spec.smokeTests.length >= 1, "whale has at least one smoke test");
  assert.ok(spec.rubric.length >= 1, "whale has an outcome_rubric");
  assert.equal(spec.specVersion, "0.2.0", "spec version read from identity.version");
  assert.ok(spec.passThreshold > 0 && spec.passThreshold <= 1, "pass_threshold in (0,1]");
  console.log("  ✓ loadEmployeeSpec reads a real employee's eval_suite + rubric");
}

function refusesUnknownEmployee() {
  assert.throws(() => loadEmployeeSpec(REPO_ROOT, "no-such-employee"), /no crewclaw\.employee\.yaml/);
  console.log("  ✓ loadEmployeeSpec throws for an employee with no spec file");
}

function persistGuardProtectsRealScores() {
  const root = tmpRoot();
  const real = { agent_id: "guard", mock: false, score: 88, verdict: "PASS" };
  const mock = { agent_id: "guard", mock: true, score: 100, verdict: "PASS" };

  // First real write lands.
  assert.equal(persistEval(root, real).written, true);
  // A mock run must NOT clobber the real certification score.
  const blocked = persistEval(root, mock);
  assert.equal(blocked.written, false, "mock refused over real");
  assert.match(blocked.reason, /real/);
  // --force overrides.
  assert.equal(persistEval(root, mock, { force: true }).written, true, "force overrides");
  // A mock over a mock is fine (no real score to protect).
  assert.equal(persistEval(root, { agent_id: "guard", mock: true, score: 0 }).written, true);
  console.log("  ✓ persistEval guards a real (mock:false) score from mock overwrites unless --force");
}

function readEvalResultShapeAndAbsence() {
  const root = tmpRoot();
  assert.equal(readEvalResult(root, "nobody"), null, "no file → null (never fabricated)");
  assert.equal(readEvalResult(root, undefined), null, "no agentId → null");

  persistEval(root, {
    agent_id: "shape",
    mock: true,
    score: 100,
    verdict: "PASS",
    pass_threshold: 0.8,
    model: "mock",
    graded_by: "mechanical",
    evaluated_at: 123,
    per_test: [{ id: "smoke-1", score: 100, passed: true }],
  });
  const r = readEvalResult(root, "shape");
  assert.equal(r.score, 100);
  assert.equal(r.mock, true);
  assert.equal(r.graded_by, "mechanical");
  assert.deepEqual(r.exams, [{ id: "smoke-1", score: 100, passed: true }]);
  console.log("  ✓ readEvalResult returns the compact TUI shape, null when absent");
}

function main() {
  console.log("eval-runner.mjs: spec loading + persist guard + defensive read");
  loadsRealWhaleSpec();
  refusesUnknownEmployee();
  persistGuardProtectsRealScores();
  readEvalResultShapeAndAbsence();
  console.log("eval-runner.test.mjs passed");
}

main();
