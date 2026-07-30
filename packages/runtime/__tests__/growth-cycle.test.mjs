import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approveGrowthCycle,
  awaitGrowthDelivery,
  inspectGrowthCycle,
  learnGrowthCycle,
  queueGrowthCycle,
  recommendGrowthCycle,
  recoverGrowthCycle,
  settleGrowthCycle,
  startGrowthCycle,
} from "../growth-cycle.mjs";

const root = mkdtempSync(join(tmpdir(), "crewclaw-growth-cycle-"));
const employeeId = "code-review-shrimp";

try {
  const recommended = recommendGrowthCycle(root, {
    employeeId,
    dreamId: "dream-one",
    goal: "Review the next bounded change and preserve evidence.",
    taskRunIds: ["task-a"],
    evidenceIds: ["evidence-a"],
    kpi: { accepted: 1, rejected: 0 },
    evaluation: { score: 82 },
    now: 1_750_000_000_000,
  });
  assert.equal(recommended.record.state, "RECOMMENDED");
  assert.match(recommended.record.plan_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    recommendGrowthCycle(root, {
      employeeId,
      dreamId: "dream-one",
      goal: "Review the next bounded change and preserve evidence.",
      taskRunIds: ["task-a"],
      evidenceIds: ["evidence-a"],
      kpi: { accepted: 1, rejected: 0 },
      evaluation: { score: 82 },
      now: 1_750_000_000_000,
    }).replayed,
    true,
    "recommendation is idempotent"
  );

  const cycleId = recommended.record.cycle_id;
  const approved = approveGrowthCycle(root, employeeId, cycleId, {
    decidedBy: "human",
  });
  assert.equal(approved.record.state, "APPROVED");
  assert.equal(approved.record.approved_by, "human");
  assert.equal(
    approveGrowthCycle(root, employeeId, cycleId, {
      decidedBy: "human",
    }).replayed,
    true,
    "approval replay cannot create a second receipt"
  );
  assert.equal(
    queueGrowthCycle(root, employeeId, cycleId).record.state,
    "QUEUED"
  );
  assert.equal(
    startGrowthCycle(root, employeeId, cycleId, "task-growth-1").record.state,
    "RUNNING"
  );
  assert.throws(
    () => startGrowthCycle(root, employeeId, cycleId, "another-task"),
    /illegal growth transition/,
    "an executing plan binds exactly one TaskRun"
  );
  assert.equal(
    awaitGrowthDelivery(root, employeeId, cycleId, "task-growth-1").record
      .state,
    "AWAITING_DELIVERY_APPROVAL"
  );
  assert.equal(
    settleGrowthCycle(root, employeeId, cycleId, "accepted", {
      taskRunId: "task-growth-1",
    }).record.state,
    "DELIVERED"
  );
  assert.equal(
    learnGrowthCycle(root, employeeId, cycleId).record.state,
    "LEARNED"
  );
  assert.equal(
    inspectGrowthCycle(root, employeeId, cycleId).record.outcome,
    "accepted"
  );

  const revision = recommendGrowthCycle(root, {
    employeeId,
    dreamId: "dream-two",
    kind: "dream_revision",
    goal: "Revise the rejected Dream candidate with explicit provenance.",
  });
  assert.equal(revision.record.state, "REVISION_REQUIRED");
  assert.throws(
    () =>
      startGrowthCycle(
        root,
        employeeId,
        revision.record.cycle_id,
        "task-bypass"
      ),
    /illegal growth transition/,
    "execution cannot bypass human approval"
  );

  const recovery = recommendGrowthCycle(root, {
    employeeId,
    dreamId: "dream-three",
    goal: "Recover this task after a process restart.",
  });
  approveGrowthCycle(root, employeeId, recovery.record.cycle_id);
  queueGrowthCycle(root, employeeId, recovery.record.cycle_id);
  startGrowthCycle(
    root,
    employeeId,
    recovery.record.cycle_id,
    "task-recovered"
  );
  const recovered = recoverGrowthCycle(
    root,
    employeeId,
    recovery.record.cycle_id,
    {
      loadTaskRun: taskRunId => ({
        id: taskRunId,
        status: "rejected",
      }),
    }
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.record.state, "LEARNED");
  assert.equal(recovered.record.outcome, "rejected");
  assert.equal(
    recovered.record.transitions.some(
      transition => transition.event === "dream.next_task_learned"
    ),
    true
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("growth cycle tests passed");
