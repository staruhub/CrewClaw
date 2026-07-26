import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KPI_CONTRACT,
  migrateKpiV1,
  readKpi,
  readKpiLedger,
  recordTaskOutcome,
} from "../kpi.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kpi-v2-test-"));
}

function hire(root, agentId, hiredAt = "2026-01-02T03:04:05.000Z") {
  const dir = path.join(root, ".crewclaw");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "team.json");
  const team = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : [];
  team.push({
    workspace_employee_id: `${agentId}-workspace`,
    employee_id: agentId,
    version: "1.0.0",
    status: "active",
    hired_at: hiredAt,
    fired_at: null,
    permissions_granted: [],
    hire_source: "cli",
  });
  fs.writeFileSync(file, `${JSON.stringify(team)}\n`);
  return Date.parse(hiredAt);
}

{
  const kpi = readKpi(tmpRoot(), "no-such-agent");
  assert.equal(kpi.contract, KPI_CONTRACT);
  assert.equal(kpi.tasks, 0);
  assert.equal(kpi.accepted, 0);
  assert.equal(kpi.evidence_coverage, null);
}

{
  const root = tmpRoot();
  const hiredAt = hire(root, "whale");
  recordTaskOutcome(root, "whale", {
    taskRunId: "formal-manual",
    taskKind: "formal",
    outcome: "accepted",
    acceptanceSource: "user",
    cost: 0.4,
    durationMs: 1_000,
    evidenceCount: 2,
  });
  recordTaskOutcome(root, "whale", {
    taskRunId: "formal-auto",
    taskKind: "formal",
    outcome: "auto_accepted",
    acceptanceSource: "policy",
    cost: 0.2,
    durationMs: 500,
    evidenceCount: 1,
  });
  recordTaskOutcome(root, "whale", {
    taskRunId: "chat-one",
    taskKind: "chat",
    outcome: "completed",
    acceptanceSource: "none",
    cost: 0.05,
  });
  const kpi = readKpi(root, "whale");
  assert.equal(kpi.tasks, 2, "chat is excluded from formal task count");
  assert.equal(kpi.accepted, 1, "only explicit user acceptance is accepted");
  assert.equal(kpi.auto_accepted, 1, "policy acceptance is separately visible");
  assert.equal(kpi.chat_turns, 1);
  assert.equal(kpi.total_cost, 0.65);
  assert.equal(kpi.average_duration_ms, 750);
  assert.equal(kpi.evidence_coverage, 1);
  assert.equal(kpi.first_hired_ts, hiredAt);
}

{
  const root = tmpRoot();
  hire(root, "skill-worker");
  for (const [index, outcome] of [
    "rejected",
    "revision_requested",
    "failed",
  ].entries()) {
    recordTaskOutcome(root, "skill-worker", {
      taskRunId: `weak-${index}`,
      taskKind: "formal",
      outcome,
      acceptanceSource: "none",
      skillUsage: [{ skill_id: "weak-skill", calls: index + 1 }],
      ts: 100 + index,
    });
  }
  recordTaskOutcome(root, "skill-worker", {
    taskRunId: "strong-one",
    taskKind: "formal",
    outcome: "accepted",
    acceptanceSource: "user",
    skillUsage: [{ skill_id: "strong-skill", calls: 2 }],
    ts: 200,
  });
  recordTaskOutcome(root, "skill-worker", {
    taskRunId: "weak-chat",
    taskKind: "chat",
    outcome: "completed",
    acceptanceSource: "none",
    skillUsage: [{ skill_id: "weak-skill", calls: 1 }],
    ts: 300,
  });

  const kpi = readKpi(root, "skill-worker");
  const weak = kpi.skills.find(skill => skill.skill_id === "weak-skill");
  const strong = kpi.skills.find(skill => skill.skill_id === "strong-skill");
  assert.deepEqual(
    {
      calls: weak.calls,
      observed_tasks: weak.observed_tasks,
      settled_tasks: weak.settled_tasks,
      successful_tasks: weak.successful_tasks,
      negative_tasks: weak.negative_tasks,
      success_rate: weak.success_rate,
      acceptance_rate: weak.acceptance_rate,
      last_used_ts: weak.last_used_ts,
      retirement_candidate: weak.retirement_candidate,
    },
    {
      calls: 7,
      observed_tasks: 4,
      settled_tasks: 3,
      successful_tasks: 0,
      negative_tasks: 3,
      success_rate: 0,
      acceptance_rate: 0,
      last_used_ts: 300,
      retirement_candidate: true,
    }
  );
  assert.equal(strong.accepted_tasks, 1);
  assert.equal(strong.success_rate, 1);
  assert.equal(strong.retirement_candidate, false);
  assert.deepEqual(kpi.skill_retirement_candidates, ["weak-skill"]);

  assert.throws(
    () =>
      recordTaskOutcome(root, "skill-worker", {
        taskRunId: "bad-skill",
        skillUsage: [{ skill_id: "../escape", calls: 1 }],
      }),
    /invalid KPI skill_usage entry/
  );
  assert.throws(
    () =>
      recordTaskOutcome(root, "skill-worker", {
        taskRunId: "duplicate-skill",
        skillUsage: [
          { skill_id: "strong-skill", calls: 1 },
          { skill_id: "strong-skill", calls: 2 },
        ],
      }),
    /duplicate KPI skill_usage entry/
  );
}

{
  const root = tmpRoot();
  const dir = path.join(root, ".crewclaw", "kpi");
  const file = path.join(dir, "whale.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      tasks: 7,
      accepted: 3,
      total_cost: 1.25,
      first_hired_ts: 123,
    })
  );
  const first = migrateKpiV1(root, "whale");
  assert.equal(first.migrated, true);
  assert.deepEqual(first.document.legacy, {
    unclassified_tasks: 7,
    accepted_claims: 3,
    total_cost: 1.25,
  });
  assert.equal(
    JSON.parse(fs.readFileSync(file, "utf8")).contract,
    KPI_CONTRACT
  );
  assert.equal(
    migrateKpiV1(root, "whale").migrated,
    false,
    "migration is one-shot"
  );
}

{
  const root = tmpRoot();
  hire(root, "whale");
  const outcome = {
    taskRunId: "idempotent",
    taskKind: "formal",
    outcome: "correctly_blocked",
    acceptanceSource: "none",
    cost: 0,
    evidenceCount: 1,
  };
  recordTaskOutcome(root, "whale", outcome);
  recordTaskOutcome(root, "whale", { ...outcome, cost: 99 });
  assert.equal(readKpi(root, "whale").tasks, 1);
  assert.equal(readKpi(root, "whale").correctly_blocked, 1);
  assert.equal(readKpi(root, "whale").total_cost, 0);
}

{
  const root = tmpRoot();
  const hiredAt = hire(root, "whale", "2025-12-31T00:00:00.000Z");
  const dir = path.join(root, ".crewclaw", "kpi");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "whale.json"),
    JSON.stringify({
      tasks: 9,
      accepted: 4,
      total_cost: 2.5,
      first_hired_ts: hiredAt + 86_400_000,
    })
  );
  recordTaskOutcome(root, "whale", {
    taskRunId: "new-v2",
    taskKind: "formal",
    outcome: "completed",
    acceptanceSource: "none",
  });
  const kpi = readKpi(root, "whale");
  assert.equal(
    kpi.tasks,
    1,
    "unclassified v1 chat-like tasks are not promoted"
  );
  assert.equal(kpi.legacy_unclassified_tasks, 9);
  assert.equal(kpi.legacy_accepted_claims, 4);
  assert.equal(kpi.legacy_total_cost, 2.5);
  assert.equal(kpi.first_hired_ts, hiredAt);
}

{
  const root = tmpRoot();
  hire(root, "whale");
  assert.throws(
    () =>
      recordTaskOutcome(root, "whale", {
        taskRunId: "bad-provenance",
        outcome: "accepted",
        acceptanceSource: "policy",
      }),
    /accepted requires user provenance/
  );
  assert.equal(recordTaskOutcome(root, "../escape", { taskRunId: "x" }), null);
  assert.equal(
    fs.existsSync(path.join(root, ".crewclaw", "kpi", "escape.json")),
    false
  );
}

{
  const root = tmpRoot();
  const dir = path.join(root, ".crewclaw", "kpi");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "broken.json"), "{not valid json");
  assert.equal(readKpi(root, "broken").tasks, 0);
  assert.equal(readKpiLedger(root, "broken"), null);
  assert.equal(
    recordTaskOutcome(root, "broken", { taskRunId: "must-not-overwrite" }),
    null,
    "corrupt evidence is never overwritten with a new zero ledger"
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "broken.json"), "utf8"),
    "{not valid json"
  );
}

console.log("kpi.test.mjs passed");
