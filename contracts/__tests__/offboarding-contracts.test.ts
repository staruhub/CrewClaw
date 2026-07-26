import { describe, expect, it } from "vitest";

import { MemoryPackSchema, OffboardingReceiptSchema } from "../offboarding";
import { OffboardEmployeeRequestSchema } from "../team";

const hash = `sha256:${"a".repeat(64)}`;
const memoryItem = {
  category: "project_facts" as const,
  text: "The product uses a local JSONL runtime bridge.",
  confidence: "high" as const,
  status: "active" as const,
  source_type: "legacy" as const,
  source_task_ids: [],
  evidence_ids: [],
  created_by_model: null,
  dream_run_id: null,
  savedAt: "2026-07-19T12:00:00.000Z",
};

describe("offboarding contracts", () => {
  it("keeps the three offboarding choices explicit and successor-scoped", () => {
    expect(
      OffboardEmployeeRequestSchema.parse({ employee_id: "product-prd-crab" })
    ).toEqual({
      employee_id: "product-prd-crab",
      mode: "export_memory",
    });
    expect(
      OffboardEmployeeRequestSchema.parse({
        employee_id: "product-prd-crab",
        mode: "handoff",
        successor_employee_id: "ai-adoption-whale",
      }).mode
    ).toBe("handoff");
    expect(() =>
      OffboardEmployeeRequestSchema.parse({
        employee_id: "product-prd-crab",
        mode: "purge",
        successor_employee_id: "ai-adoption-whale",
      })
    ).toThrow(/successor_employee_id/);
  });

  it("accepts a transferable memory pack bound to one employment record", () => {
    const pack = {
      contract: "crewclaw.memory-pack/v1" as const,
      pack_id: "memory-pack-1",
      employee_id: "product-prd-crab",
      workspace_employee_id: "product-prd-crab-1784400000",
      exported_at: "2026-07-19T12:00:00.000Z",
      memory_state_hash: hash,
      item_count: 1,
      items: [memoryItem],
      provenance: { source: "active_memory" as const, source_sha256: hash },
      integrity: { content_hash: hash },
    };
    expect(MemoryPackSchema.parse(pack)).toEqual(pack);
    expect(() => MemoryPackSchema.parse({ ...pack, item_count: 2 })).toThrow(
      /item_count/
    );
  });

  it("records logical purge honestly while retaining the audit ledger", () => {
    const receipt = {
      contract: "crewclaw.offboarding/v1" as const,
      offboarding_id: "offboarding-1",
      employee_id: "product-prd-crab",
      workspace_employee_id: "product-prd-crab-1784400000",
      requested_at: "2026-07-19T12:00:00.000Z",
      completed_at: "2026-07-19T12:01:00.000Z",
      outcome: "completed" as const,
      export_memory: {
        requested: true,
        status: "exported" as const,
        pack_id: "memory-pack-1",
        pack_sha256: hash,
        relative_path: ".crewclaw/offboarding/offboarding-1/memory-pack.json",
      },
      handoff: {
        requested: true,
        status: "drafted" as const,
        draft_id: "handoff-1",
        successor_employee_id: "ai-adoption-whale",
      },
      fire: {
        status: "fired" as const,
        fired_at: "2026-07-19T12:00:30.000Z",
        permissions_active: false as const,
      },
      purge: {
        requested: true,
        status: "purged" as const,
        deleted_scopes: [
          "memory" as const,
          "memory_candidates" as const,
          "dream" as const,
          "skill_usage" as const,
        ],
        retained_audit_scopes: [
          "team" as const,
          "activity" as const,
          "task_runs" as const,
          "proofpacks" as const,
          "kpi" as const,
          "eval" as const,
        ],
        media_sanitization: "not_performed" as const,
      },
      billing: {
        status: "not_applicable" as const,
        reason: "local_runtime_has_no_billing_executor" as const,
      },
      warnings: ["Logical purge is not media sanitization."],
      integrity: { content_hash: hash },
    };
    expect(OffboardingReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(() =>
      OffboardingReceiptSchema.parse({
        ...receipt,
        billing: { status: "stopped", reason: "claimed" },
      })
    ).toThrow();
  });
});
