import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assessDream,
  assessDreamFromWorkspace,
  persistDreamRecommendation,
} from "../dream-controller.mjs";
import { dreamJobPath } from "../dream-paths.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";

const employeeId = "ai-adoption-whale";
const now = Date.parse("2026-07-11T12:00:00.000Z");
const accepted = index =>
  buildReflection(
    {
      id: `task-${index}`,
      employee_id: employeeId,
      status: "accepted",
      output_valid: true,
      artifact: `artifact-${index}`,
      user_feedback: "useful",
      started_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:01:00.000Z",
    },
    {
      evidenceIds: [`ev-${index}`],
      createdAt: new Date(now - (10 - index) * 1000).toISOString(),
    }
  );

const reflections = Array.from({ length: 8 }, (_, index) =>
  accepted(index + 1)
);
const currentMemory = [];
const baseline = {
  mock: false,
  provider_status: "verified",
  memory_state_hash:
    "sha256:220ad790cbf47e8dc290182fc5148ad8b3b0f1276a6e37e59318e5bdb337806b",
};

// Eight accepted, trusted, non-legacy tasks cross the accumulation trigger.
const automatic = assessDream({
  employeeId,
  reflections,
  memoryItems: currentMemory,
  baseline,
  now,
});
assert.equal(automatic.curation.eligible, true);
assert.equal(automatic.recommended, true);
assert.ok(automatic.trigger_reasons.includes("accepted_tasks"));
assert.equal(automatic.metrics.accepted_tasks, 8);
assert.equal(automatic.input.reflection_ids.length, 8);
assert.ok(
  automatic.cost.estimated_usd > 0,
  "recommendation cost is an honest estimate, not zero"
);

// Baseline is an activation-only gate: curation remains possible and explicit about the block.
const noBaseline = assessDream({
  employeeId,
  reflections,
  memoryItems: [],
  now,
});
assert.equal(noBaseline.curation.eligible, true);
assert.equal(noBaseline.recommended, true);
assert.equal(noBaseline.activation.eligible, false);
assert.ok(noBaseline.activation.blockers.includes("baseline_missing"));

// Manual mode is quiet until dream.run, then bypasses soft threshold/cooldown only.
const one = [accepted(1)];
const manualQuiet = assessDream({
  employeeId,
  reflections: one,
  policy: { mode: "manual" },
  lastDreamAt: "2026-07-11T11:30:00.000Z",
  now,
});
assert.equal(manualQuiet.recommended, false);
const manualRun = assessDream({
  employeeId,
  reflections: one,
  policy: { mode: "manual" },
  lastDreamAt: "2026-07-11T11:30:00.000Z",
  manualTrigger: true,
  now,
});
assert.equal(manualRun.curation.eligible, true);
assert.equal(manualRun.recommended, true);
assert.ok(manualRun.trigger_reasons.includes("manual_trigger"));

// Manual trigger never bypasses safety/trust/budget gates.
const blocked = assessDream({
  employeeId,
  reflections: [{ ...accepted(1), mock: true }],
  manualTrigger: true,
  budgetAvailable: false,
  now,
});
assert.equal(blocked.curation.eligible, false);
assert.equal(blocked.recommended, false);
assert.ok(blocked.curation.blockers.includes("budget_unavailable"));
assert.ok(blocked.curation.blockers.includes("no_trusted_input"));

// M1 legacy writes are excluded from the new pool, preventing double absorption on flag flip.
const legacyOnly = assessDream({
  employeeId,
  reflections: reflections.map(record => ({
    ...record,
    legacy_committed: true,
  })),
  manualTrigger: true,
  now,
});
assert.equal(legacyOnly.metrics.accepted_tasks, 0);
assert.ok(legacyOnly.curation.blockers.includes("no_trusted_input"));

// Workspace scan + immutable RECOMMENDED job persistence.
const root = mkdtempSync(join(tmpdir(), "crew-dream-controller-"));
try {
  for (const reflection of reflections)
    assert.equal(writeReflection(root, reflection).ok, true);
  const scanned = assessDreamFromWorkspace(root, employeeId, { now });
  assert.equal(scanned.recommended, true);
  assert.deepEqual(scanned.input_errors, []);
  const persisted = persistDreamRecommendation(root, scanned, {
    dreamId: "dream-m2-test",
  });
  assert.equal(persisted.ok, true);
  assert.equal(persisted.written, true);
  assert.ok(existsSync(dreamJobPath(root, employeeId, "dream-m2-test")));
  const replay = persistDreamRecommendation(root, scanned, {
    dreamId: "dream-m2-test",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.written, false);
  const laterAssessment = assessDreamFromWorkspace(root, employeeId, {
    now: now + 60_000,
  });
  const laterReplay = persistDreamRecommendation(root, laterAssessment, {
    dreamId: "dream-m2-test",
  });
  assert.equal(
    laterReplay.ok,
    true,
    "same immutable input reuses its recommendation across restarts"
  );
  assert.equal(laterReplay.written, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("dream-controller.test.mjs passed");
