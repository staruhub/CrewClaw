// kpi.test.mjs — unit tests for kpi.mjs (v0.17 P2 C1: cross-session KPI persistence).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readKpi, recordTaskOutcome } from "../kpi.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kpi-test-"));
}

function readsZerosWhenNoFileExists() {
  const root = tmpRoot();
  const kpi = readKpi(root, "no-such-agent");
  assert.deepEqual(kpi, {
    tasks: 0,
    accepted: 0,
    total_cost: 0,
    first_hired_ts: null,
  });
  console.log("  ✓ readKpi returns honest zeros when no file exists yet");
}

function recordAccumulatesAcrossCalls() {
  const root = tmpRoot();
  recordTaskOutcome(root, "whale", { accepted: false, cost: 0.1, ts: 1000 });
  recordTaskOutcome(root, "whale", { accepted: true, cost: 0.4, ts: 2000 });
  const kpi = readKpi(root, "whale");
  assert.equal(kpi.tasks, 2, "two terminal outcomes recorded");
  assert.equal(
    kpi.accepted,
    1,
    "only the accepted=true call increments accepted"
  );
  assert.equal(kpi.total_cost, 0.5, "cost accumulates across calls");
  assert.equal(
    kpi.first_hired_ts,
    1000,
    "first_hired_ts locks to the FIRST recorded outcome, not the latest"
  );
  console.log(
    "  ✓ recordTaskOutcome accumulates tasks/accepted/cost and locks first_hired_ts"
  );
}

function differentAgentsDoNotShareState() {
  const root = tmpRoot();
  recordTaskOutcome(root, "whale", { accepted: true, cost: 1 });
  recordTaskOutcome(root, "octopus", { accepted: false, cost: 2 });
  assert.equal(readKpi(root, "whale").tasks, 1);
  assert.equal(readKpi(root, "octopus").tasks, 1);
  assert.equal(readKpi(root, "whale").total_cost, 1);
  assert.equal(readKpi(root, "octopus").total_cost, 2);
  console.log("  ✓ per-agent KPI files are isolated (no cross-employee bleed)");
}

function taskRunIdMakesSettlementIdempotent() {
  const root = tmpRoot();
  const outcome = {
    accepted: true,
    cost: 0.75,
    ts: 1000,
    taskRunId: "task-idempotent",
  };
  recordTaskOutcome(root, "whale", outcome);
  recordTaskOutcome(root, "whale", outcome);
  assert.deepEqual(readKpi(root, "whale"), {
    tasks: 1,
    accepted: 1,
    total_cost: 0.75,
    first_hired_ts: 1000,
  });
  console.log("  ✓ taskRunId makes crash-retried KPI settlement exactly once");
}

function noAgentIdIsANoop() {
  const root = tmpRoot();
  const result = recordTaskOutcome(root, undefined, {
    accepted: true,
    cost: 5,
  });
  assert.equal(
    result,
    null,
    "recording without an agentId is a documented no-op, not a crash"
  );
  assert.equal(
    fs.existsSync(path.join(root, ".crewclaw", "kpi")),
    false,
    "no stray file/dir created"
  );
  console.log("  ✓ missing agentId is a safe no-op");
}

function corruptFileFallsBackToZerosNotCrash() {
  const root = tmpRoot();
  const dir = path.join(root, ".crewclaw", "kpi");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "broken.json"), "{not valid json");
  const kpi = readKpi(root, "broken");
  assert.deepEqual(kpi, {
    tasks: 0,
    accepted: 0,
    total_cost: 0,
    first_hired_ts: null,
  });
  console.log(
    "  ✓ corrupt KPI file degrades to honest zeros instead of throwing"
  );
}

function main() {
  console.log("kpi.mjs: cross-session KPI persistence unit tests");
  readsZerosWhenNoFileExists();
  recordAccumulatesAcrossCalls();
  differentAgentsDoNotShareState();
  taskRunIdMakesSettlementIdempotent();
  noAgentIdIsANoop();
  corruptFileFallsBackToZerosNotCrash();
  console.log("kpi.test.mjs passed");
}

main();
