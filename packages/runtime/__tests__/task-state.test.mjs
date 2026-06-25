import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  computeEffective,
  loadTaskRun,
  newTaskRun,
  saveTaskRun,
  transition
} from "../task-state.mjs";

assert.equal(newTaskRun({ employeeId: "w", goal: "g" }).status, "created");

assert.equal(transition(newTaskRun({ employeeId: "w", goal: "g" }), "planned").status, "planned");

assert.throws(() => transition(newTaskRun({ employeeId: "w", goal: "g" }), "delivered"));

const eventRun = newTaskRun({ employeeId: "w", goal: "g" });
addEvent(eventRun, { type: "note", summary: "hi" });
const lastEvent = eventRun.events[eventRun.events.length - 1];
assert.ok(lastEvent.id);
assert.ok(lastEvent.timestamp);

const root = mkdtempSync(join(tmpdir(), "crewclaw-task-state-"));
try {
  const savedRun = newTaskRun({ employeeId: "w", goal: "g", taskId: "task:round/trip" });
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

console.log("task-state tests passed");
