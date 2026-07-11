import assert from "node:assert/strict";
import { extractSources, reviewTaskRun } from "../dream.mjs";

assert.deepEqual(
  extractSources("see https://a.com and https://a.com and http://b.org"),
  ["https://a.com", "http://b.org"]
);
assert.deepEqual(extractSources(null), []);

// Explicit mock mode: deterministic pipeline check (never seeds real memory).
const r = await reviewTaskRun({
  taskRun: {
    id: "task_1",
    user_goal: "调研X",
    output_valid: true,
    effective: true,
    tool_invocations: [{ tool_name: "web_search" }, { tool_name: "web_fetch" }],
  },
  deliverable: "来源 https://volcengine.com 置信度 高",
  mock: true,
});

assert.ok(
  r.new_memory_candidates.some(
    c =>
      c.category === "reliable_sources" && c.text === "https://volcengine.com"
  )
);
assert.deepEqual(r.new_playbook_candidates[0].steps, [
  "web_search",
  "web_fetch",
]);
assert.equal(r.confidence, "high");
assert.equal(r.mock, true);
assert.equal(r.needs_user_review, true);

// Sources already in memory are not re-proposed.
const r2 = await reviewTaskRun({
  taskRun: {
    id: "t",
    output_valid: true,
  },
  deliverable: "https://x.com",
  existingMemory: [
    {
      category: "reliable_sources",
      text: "https://x.com",
    },
  ],
  mock: true,
});

assert.ok(r2.new_memory_candidates.every(c => c.text !== "https://x.com"));

// Real mode has no heuristic fallback: refusing a model function must reject, never downgrade.
await assert.rejects(
  reviewTaskRun({ taskRun: { id: "t2" }, deliverable: "x" }),
  /real dream requires an explicit model/
);

// A real-mode model response is validated against the crewclaw.dream/v1 contract.
const real = await reviewTaskRun({
  taskRun: { id: "t3", user_goal: "验证契约" },
  deliverable: "ok",
  modelId: "test/model",
  model: () => ({
    summary: "真实模型响应经契约校验后落库。",
    new_memory_candidates: [
      { category: "verified_sops", text: "先跑测试再提交", confidence: "high" },
    ],
    new_playbook_candidates: [],
    confidence: "medium",
    needs_user_review: true,
  }),
});
assert.equal(real.mock, false);
assert.equal(real.model, "test/model");
assert.equal(real.new_memory_candidates[0].category, "verified_sops");
