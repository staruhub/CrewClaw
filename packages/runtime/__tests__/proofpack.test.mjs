import assert from "node:assert/strict";

import { assembleProofPack, costSummary, validateCompletion } from "../proofpack.mjs";

const proofPackKeys = [
  "task_run_id",
  "plan_snapshot",
  "timeline_events",
  "tool_calls",
  "artifacts",
  "evidence_cards",
  "outcome_checks",
  "user_approval",
  "cost_summary",
];

{
  const taskRun = {
    task_run_id: "task-1",
    plan: { steps: ["write", "check"] },
    timeline_events: [
      { type: "plan.created" },
      { type: "artifact.created" },
      { type: "outcome.checked" },
      { type: "approval.requested" },
    ],
    tool_calls: [{ name: "artifact.write" }],
    artifacts: [{ artifact_id: "artifact-1", status: "ready" }],
    evidence: [{ evidence_id: "evidence-1", claim: "source verified" }],
    outcome_checks: [{ key: "rubric", passed: true }],
    approval: { status: "accepted" },
    usage: { prompt_tokens: 1_000, completion_tokens: 500 },
  };

  const pack = assembleProofPack(taskRun);

  assert.deepEqual(Object.keys(pack), proofPackKeys);
  assert.equal(pack.task_run_id, "task-1");
  assert.deepEqual(pack.plan_snapshot, taskRun.plan);
  assert.deepEqual(pack.timeline_events, taskRun.timeline_events);
  assert.deepEqual(pack.tool_calls, taskRun.tool_calls);
  assert.deepEqual(pack.artifacts, taskRun.artifacts);
  assert.deepEqual(pack.evidence_cards, taskRun.evidence);
  assert.deepEqual(pack.outcome_checks, taskRun.outcome_checks);
  assert.deepEqual(pack.user_approval, taskRun.approval);
  assert.equal(pack.cost_summary.prompt_tokens, 1_000);
  assert.equal(pack.cost_summary.completion_tokens, 500);
  assert.ok(pack.cost_summary.cost > 0);
}

{
  const pack = assembleProofPack({});

  assert.deepEqual(Object.keys(pack), proofPackKeys);
  assert.equal(pack.task_run_id, null);
  assert.equal(pack.plan_snapshot, null);
  assert.deepEqual(pack.timeline_events, []);
  assert.deepEqual(pack.tool_calls, []);
  assert.deepEqual(pack.artifacts, []);
  assert.deepEqual(pack.evidence_cards, []);
  assert.deepEqual(pack.outcome_checks, []);
  assert.equal(pack.user_approval, null);
  assert.equal(pack.cost_summary, null);
}

{
  const chatOnly = {
    task_run_id: "chat-only",
    timeline_events: [{ type: "plan.created" }, { type: "approval.requested" }],
  };

  const result = validateCompletion(chatOnly);

  assert.equal(result.valid, false);
  assert.ok(result.missing.includes("artifact.created"));
  assert.ok(result.missing.includes("outcome.checked"));
}

{
  const result = validateCompletion({
    timeline_events: [
      { type: "plan.created" },
      { type: "artifact.created" },
      { type: "outcome.checked" },
      { type: "approval.requested" },
    ],
  });

  assert.deepEqual(result, { valid: true, missing: [] });
}

{
  const summary = costSummary({ prompt_tokens: 1_000, completion_tokens: 500 });

  assert.deepEqual(Object.keys(summary), ["prompt_tokens", "completion_tokens", "cost"]);
  assert.equal(summary.prompt_tokens, 1_000);
  assert.equal(summary.completion_tokens, 500);
  assert.equal(typeof summary.cost, "number");
  assert.ok(summary.cost > 0);
}

console.log("proofpack.test.mjs passed");
