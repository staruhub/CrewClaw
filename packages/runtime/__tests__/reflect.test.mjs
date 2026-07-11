import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REFLECT_CONTRACT,
  buildReflection,
  isTrustedReflection,
  writeReflection,
} from "../reflect.mjs";
import { reflectionPath } from "../dream-paths.mjs";

const acceptedRun = {
  id: "task_1",
  employee_id: "ai-adoption-whale",
  user_goal: "调研 Seed 2.1",
  status: "accepted",
  output_valid: true,
  artifact: "artifact_1",
  user_feedback: "useful",
  cost: 0.12,
  started_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:01:00.000Z",
  tool_invocations: [
    { tool_name: "web_search", status: "success", decision: "allow" },
    { tool_name: "web_fetch", status: "success", decision: "allow" },
  ],
};

// ── pure builder ──────────────────────────────────────────────────────────────────────────
const r = buildReflection(acceptedRun, {
  evidenceIds: ["ev_1", "ev_2"],
  createdAt: "2026-07-11T00:02:00.000Z",
});
assert.equal(r.contract, REFLECT_CONTRACT);
assert.equal(r.task_id, "task_1");
assert.equal(r.employee_id, "ai-adoption-whale");
assert.equal(r.outcome, "accepted");
assert.equal(r.output_valid, true);
assert.deepEqual(r.accepted_artifact_ids, ["artifact_1"]);
assert.deepEqual(r.evidence_ids, ["ev_1", "ev_2"]);
assert.deepEqual(r.user_feedback, { useful: true });
assert.equal(r.cost_usd, 0.12);
assert.equal(r.duration_ms, 60_000);
assert.equal(r.tool_stats.length, 2);
assert.equal(r.legacy_committed, false);

// builder is deterministic (Reflect never hallucinates cross-task rules — facts only).
const r2 = buildReflection(acceptedRun, {
  evidenceIds: ["ev_1", "ev_2"],
  createdAt: "2026-07-11T00:02:00.000Z",
});
assert.deepEqual(r, r2);

// missing identity throws (a corrupt reflection must never reach disk).
assert.throws(() => buildReflection({ status: "accepted" }), /settled TaskRun/);

// only enum verification sources survive.
const withFailures = buildReflection(
  { ...acceptedRun, status: "rejected", output_valid: false },
  {
    verifiedFailures: [
      { code: "MISSING_SECTION", verification: "outcome_grader" },
      { code: "BOGUS", verification: "my_gut" },
    ],
    createdAt: "2026-07-11T00:02:00.000Z",
  }
);
assert.equal(withFailures.verified_failures.length, 1);
assert.equal(withFailures.verified_failures[0].verification, "outcome_grader");
assert.deepEqual(withFailures.accepted_artifact_ids, []); // rejected → no accepted artifact

// ── idempotent write ──────────────────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), "crew-reflect-"));
try {
  const first = writeReflection(root, r);
  assert.equal(first.ok, true);
  assert.equal(first.written, true);
  assert.ok(existsSync(reflectionPath(root, r.employee_id, r.task_id)));

  // replay same content → no-op success (crash-replay settlement safe).
  const replay = writeReflection(root, r);
  assert.equal(replay.ok, true);
  assert.equal(replay.written, false);

  // divergent content for same task → rejected as corruption.
  const tampered = { ...r, outcome: "rejected" };
  const conflict = writeReflection(root, tampered);
  assert.equal(conflict.ok, false);
  assert.match(conflict.reason, /different content/);

  // on-disk file is the original, untouched.
  const onDisk = JSON.parse(readFileSync(reflectionPath(root, r.employee_id, r.task_id), "utf8"));
  assert.equal(onDisk.outcome, "accepted");
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ── trusted-pool admission ──────────────────────────────────────────────────────────────────
assert.equal(isTrustedReflection(r), true, "accepted+valid is trusted");
assert.equal(
  isTrustedReflection({ ...r, outcome: "rejected", output_valid: false }),
  false,
  "rejected is not trusted"
);
assert.equal(
  isTrustedReflection({ ...r, mock: true }),
  false,
  "mock is never trusted"
);
assert.equal(
  isTrustedReflection({ ...withFailures, evidence_ids: ["ev_1"] }),
  true,
  "verified failure + evidence is admissible (teaches what not to do)"
);
assert.equal(
  isTrustedReflection({ ...withFailures, evidence_ids: [] }),
  false,
  "verified failure without evidence is not admissible"
);
assert.equal(isTrustedReflection(null), false);
assert.equal(isTrustedReflection({ contract: "other" }), false);

console.log("reflect.test.mjs passed");
