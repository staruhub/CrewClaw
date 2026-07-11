import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  computeEffective,
  evaluateCompletionGate,
  loadTaskRun,
  newTaskRun,
  saveTaskRun,
  transition,
} from "../task-state.mjs";

assert.equal(newTaskRun({ employeeId: "w", goal: "g" }).status, "created");

assert.equal(
  transition(newTaskRun({ employeeId: "w", goal: "g" }), "planned").status,
  "planned"
);

assert.throws(() =>
  transition(newTaskRun({ employeeId: "w", goal: "g" }), "delivered")
);

const eventRun = newTaskRun({ employeeId: "w", goal: "g" });
addEvent(eventRun, { type: "note", summary: "hi" });
const lastEvent = eventRun.events[eventRun.events.length - 1];
assert.ok(lastEvent.id);
assert.ok(lastEvent.timestamp);

const root = mkdtempSync(join(tmpdir(), "crewclaw-task-state-"));
try {
  const savedRun = newTaskRun({
    employeeId: "w",
    goal: "g",
    taskId: "task:round/trip",
  });
  transition(savedRun, "planned");
  const saveResult = saveTaskRun(root, savedRun);
  assert.equal(saveResult.ok, true);
  const loadResult = loadTaskRun(root, savedRun.id);
  assert.equal(loadResult.ok, true);
  assert.equal(loadResult.run.id, savedRun.id);
  assert.equal(loadResult.run.status, savedRun.status);
} finally {
  rmSync(root, { recursive: true, force: true });
}

assert.equal(computeEffective({ status: "accepted" }), true);
assert.equal(computeEffective({ status: "delivered" }), false);

function gradingRun() {
  const run = newTaskRun({ employeeId: "w", goal: "g" });
  for (const state of [
    "planned",
    "running_tool",
    "extracting_evidence",
    "drafting_artifact",
    "grading",
  ]) {
    transition(run, state);
  }
  return run;
}

{
  const decision = evaluateCompletionGate({
    artifactId: "art_ok",
    artifactSaved: true,
    artifactPath: "/tmp/art_ok.md",
    gradingPassed: true,
  });
  assert.equal(decision.valid, true);
  assert.equal(decision.nextState, "delivered");
  assert.equal(decision.artifactId, "art_ok");
  assert.equal(
    transition(gradingRun(), decision.nextState).status,
    "delivered"
  );
}

{
  const decision = evaluateCompletionGate({
    artifactId: "art_dangling",
    artifactSaved: false,
    artifactError: "disk full",
    gradingPassed: true,
  });
  assert.equal(decision.valid, false);
  assert.equal(decision.nextState, "failed");
  assert.equal(
    decision.artifactId,
    null,
    "failed persistence never returns a dangling artifact id"
  );
  assert.deepEqual(decision.gaps, ["artifact_not_persisted"]);
  assert.equal(transition(gradingRun(), decision.nextState).status, "failed");
}

{
  const decision = evaluateCompletionGate({
    artifactId: "art_no_receipt",
    artifactSaved: true,
    gradingPassed: true,
  });
  assert.equal(
    decision.valid,
    false,
    "a saved flag without a path receipt is not a deliverable"
  );
  assert.equal(decision.nextState, "failed");
  assert.equal(decision.artifactId, null);
}

{
  const decision = evaluateCompletionGate({
    artifactId: "art_revision",
    artifactSaved: true,
    artifactPath: "/tmp/art_revision.md",
    gradingPassed: false,
    gradingFeedback: "来源不足",
    missingSections: ["建议"],
  });
  assert.equal(decision.valid, false);
  assert.equal(decision.nextState, "revision_needed");
  assert.equal(
    decision.artifactId,
    "art_revision",
    "a persisted draft remains available for revision"
  );
  assert.deepEqual(decision.gaps, ["建议"]);
  assert.equal(
    transition(gradingRun(), decision.nextState).status,
    "revision_needed"
  );
}

{
  const decision = evaluateCompletionGate({
    artifactId: "art_grade_error",
    artifactSaved: true,
    artifactPath: "/tmp/art_grade_error.md",
    gradingPassed: true,
    gradingError: "grader unavailable",
  });
  assert.equal(decision.valid, false);
  assert.equal(decision.nextState, "failed");
  assert.deepEqual(decision.gaps, ["grading_unavailable"]);
}

console.log("task-state tests passed");
