import { describe, expect, it } from "vitest";

import {
  DREAM_APPROVAL_CONTRACT,
  DREAM_CANDIDATE_CONTRACT,
  DREAM_DIFF_CONTRACT,
  DREAM_JOB_CONTRACT,
  DreamJobSchema,
  DreamPolicySchema,
  MEMORY_ACTIVATION_CONTRACT,
  MEMORY_ITEM_CONTRACT,
  MEMORY_STATE_HASH_SCHEMA,
  MemoryItemV2Schema,
  REFLECT_CONTRACT,
  ReflectionSchema,
} from "../dream";
import { EmployeeSpecSchema } from "../employee-spec";

describe("M0 frozen contract names", () => {
  it("never drift silently", () => {
    expect(MEMORY_ITEM_CONTRACT).toBe("crewclaw.memory-item/v2");
    expect(REFLECT_CONTRACT).toBe("crewclaw.reflect/v1");
    expect(DREAM_JOB_CONTRACT).toBe("crewclaw.dream-job/v1");
    expect(DREAM_CANDIDATE_CONTRACT).toBe("crewclaw.dream-candidate/v1");
    expect(DREAM_DIFF_CONTRACT).toBe("crewclaw.dream-diff/v1");
    expect(DREAM_APPROVAL_CONTRACT).toBe("crewclaw.dream-approval/v1");
    expect(MEMORY_ACTIVATION_CONTRACT).toBe("crewclaw.memory-activation/v1");
    expect(MEMORY_STATE_HASH_SCHEMA).toBe("crewclaw.memory-state-hash/v1");
  });
});

describe("dream_policy formal schema", () => {
  it("accepts the pre-M0 legacy shape shipped by all five employees", () => {
    expect(() =>
      DreamPolicySchema.parse({
        after_task: ["记录可靠来源", "不保存密钥"],
        retention: "只保留抽象经验和用户批准保存的偏好。",
      })
    ).not.toThrow();
  });

  it("accepts the full conditional-dream knob set", () => {
    expect(() =>
      DreamPolicySchema.parse({
        mode: "recommended",
        triggers: {
          min_accepted_tasks: 8,
          memory_pressure_ratio: 0.7,
          duplicate_ratio: 0.15,
          stale_ratio: 0.1,
          conflict_count: 2,
          repeat_task_count: 3,
          recommendation_score: 0.7,
        },
        eligibility: { trusted_input_ratio: 0.9 },
        budget: { memory_budget_tokens: 8000 },
        input_policy: { forbid_sensitive: true },
        promotion_policy: { require_baseline: true, require_candidate_eval: true },
        cooldown: { hours: 24 },
        limits: { max_batch_tasks: 32 },
        extensions: { "vendor.x": { anything: true } },
      })
    ).not.toThrow();
  });

  it("rejects unknown top-level fields — experiments go in extensions", () => {
    expect(() => DreamPolicySchema.parse({ nightly_daemon: true })).toThrow();
    expect(() =>
      DreamPolicySchema.parse({ triggers: { unknown_knob: 1 } })
    ).toThrow();
    expect(() =>
      DreamPolicySchema.parse({ limits: { max_batch_tasks: 101 } })
    ).toThrow();
  });

  it("is enforced through EmployeeSpecSchema (no more passthrough)", () => {
    const base = {
      identity: { id: "x", version: "0.1.0" },
    };
    // Only checking the dream_policy branch: an invalid policy must fail even when embedded.
    const parsed = EmployeeSpecSchema.safeParse({
      ...base,
      dream_policy: { arbitrary_top_level: 1 },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some(issue => issue.path[0] === "dream_policy")
      ).toBe(true);
    }
  });
});

describe("memory-item/v2", () => {
  const item = {
    category: "reliable_sources",
    text: "https://www.volcengine.com/product/ark",
    confidence: "high",
    status: "active",
    source_type: "legacy",
    source_task_ids: [],
    evidence_ids: [],
    created_by_model: null,
    dream_run_id: null,
  };

  it("accepts a backfilled legacy item", () => {
    expect(() => MemoryItemV2Schema.parse(item)).not.toThrow();
  });

  it("rejects unknown fields and invalid lifecycle values", () => {
    expect(() => MemoryItemV2Schema.parse({ ...item, rating: 5 })).toThrow();
    expect(() =>
      MemoryItemV2Schema.parse({ ...item, status: "pending" })
    ).toThrow();
    expect(() =>
      MemoryItemV2Schema.parse({ ...item, source_type: "guess" })
    ).toThrow();
  });
});

describe("reflect/v1", () => {
  it("accepts an immutable task work log (facts only)", () => {
    expect(() =>
      ReflectionSchema.parse({
        contract: "crewclaw.reflect/v1",
        task_id: "task_1",
        employee_id: "ai-adoption-whale",
        outcome: "accepted",
        output_valid: true,
        accepted_artifact_ids: ["artifact_1"],
        evidence_ids: ["ev_1"],
        verified_failures: [
          { code: "JS_SHELL", tool: "web.fetch", verification: "doctor_confirmed" },
        ],
        user_feedback: { useful: true },
        created_at: "2026-07-11T00:00:00.000Z",
      })
    ).not.toThrow();
  });

  it("rejects unverified failure claims", () => {
    expect(() =>
      ReflectionSchema.parse({
        contract: "crewclaw.reflect/v1",
        task_id: "t",
        employee_id: "e",
        outcome: "accepted",
        output_valid: true,
        accepted_artifact_ids: [],
        evidence_ids: [],
        verified_failures: [{ code: "X", verification: "my_gut_feeling" }],
        user_feedback: { useful: null },
        created_at: "2026-07-11T00:00:00.000Z",
      })
    ).toThrow();
  });
});

describe("dream-job/v1", () => {
  it("accepts a full job record and enforces the state enum", () => {
    const job = {
      contract: "crewclaw.dream-job/v1",
      dream_id: "dream_1",
      employee_id: "product-prd-crab",
      model: "anthropic/claude-opus-4.8",
      created_at: "2026-07-11T00:00:00.000Z",
      state: "REVIEW_REQUIRED",
      base_memory_hash: `sha256:${"a".repeat(64)}`,
      candidate_memory_hash: `sha256:${"b".repeat(64)}`,
      input: {
        task_run_ids: ["run_1"],
        reflection_ids: ["task_1"],
        evidence_ids: [],
        input_snapshot_hash: `sha256:${"c".repeat(64)}`,
      },
      cost: { estimated_usd: 0.4, actual_usd: null },
    };
    expect(() => DreamJobSchema.parse(job)).not.toThrow();
    expect(() => DreamJobSchema.parse({ ...job, state: "SLEEPING" })).toThrow();
    expect(() =>
      DreamJobSchema.parse({ ...job, base_memory_hash: "a".repeat(64) })
    ).toThrow();
  });
});
