import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildWebEmployees } from "../scripts/generate-web-employees";
import { TOOL_CAPABILITIES } from "../tool-catalog";
import { ExpertSchema } from "../../packages/registry/src/index";
import {
  isToolCapabilityEnabledByDefault,
  isToolCapabilitySelectable,
  toolCapabilitiesForHire,
} from "../../src/data/employees";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const generatedFile = path.join(repoRoot, "src/data/employees.generated.json");

describe("web employees dataset drift guard", () => {
  const onDisk = JSON.parse(readFileSync(generatedFile, "utf8"));
  const regenerated = buildWebEmployees();

  it("src/data/employees.generated.json matches regeneration from registry + hire.yaml", () => {
    // A mismatch means someone edited the registry or a hire.yaml (or the generated file by hand)
    // without running `pnpm run web:employees`.
    expect(onDisk).toEqual(regenerated);
  });

  it("projects every available registry expert (5/5, including whale and zeneth)", () => {
    const ids = regenerated.employees.map(employee => employee.employee_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("ai-adoption-whale");
    expect(ids).toContain("zeneth");

    const registry = JSON.parse(
      readFileSync(path.join(repoRoot, "registry/experts.json"), "utf8")
    ) as { experts: { status: string; local_source?: string | null }[] };
    const availableCount = registry.experts.filter(
      entry => entry.status === "available" && entry.local_source
    ).length;
    expect(ids.length).toBe(availableCount);
  });

  it("never reintroduces fabricated fields", () => {
    for (const employee of regenerated.employees) {
      expect(employee).not.toHaveProperty("rating");
      expect(employee).not.toHaveProperty("hire_count");
      expect(employee).toHaveProperty("certified_evaluation");
      expect(employee.certified_evaluation).toBeNull();
    }
  });

  it("accepts only source-backed mock:false registry evaluations", () => {
    const registry = JSON.parse(
      readFileSync(path.join(repoRoot, "registry/experts.json"), "utf8")
    ) as { experts: Record<string, unknown>[] };
    const expert = registry.experts[0];
    const evidenceState = expert.evidence_state as Record<string, unknown>;
    const hash = `sha256:${"a".repeat(64)}`;
    const realEvaluation = {
      credential_id: "credential-registry-fixture",
      profile_id: "code-review-shrimp/v1",
      profile_version: "1.0.0",
      subject_hash: hash,
      memory_state_hash: hash,
      status: "certified",
      runtime_adapter: "reference",
      runtime_version: "0.18.0",
      runtime_capability_level: "L4",
      worker_model: "worker/model",
      judge_model: "judge/model",
      success_rate: 0.92,
      success_confidence_low: 0.81,
      correct_stop_rate: 1,
      evidence_coverage: 1,
      permission_violations: 0,
      safety_violations: 0,
      cost_p50: 0.1,
      cost_p95: 0.2,
      duration_p50_ms: 1_000,
      duration_p95_ms: 2_000,
      issued_at: "2026-07-14T08:00:00Z",
      expires_at: "2026-10-14T08:00:00Z",
      proof_pack_hash: hash,
      issuer_key_id: "issuer-key-1",
      signature: "signed-fixture",
      source: "certification/code-review-shrimp/credential.json",
      sample_size: 24,
      mock: false,
    } as const;

    expect(
      ExpertSchema.parse({
        ...expert,
        certification: "C2",
        evidence_state: { ...evidenceState, lab_status: "certified" },
        evaluation: realEvaluation,
      }).evaluation
    ).toEqual(realEvaluation);
    expect(() =>
      ExpertSchema.parse({
        ...expert,
        certification: "C2",
        evidence_state: { ...evidenceState, lab_status: "certified" },
        evaluation: { ...realEvaluation, mock: true },
      })
    ).toThrow();
    expect(() =>
      ExpertSchema.parse({
        ...expert,
        certification: "C2",
        evidence_state: { ...evidenceState, lab_status: "certified" },
        evaluation: { ...realEvaluation, sample_size: 0 },
      })
    ).toThrow();
    expect(() =>
      ExpertSchema.parse({
        ...expert,
        certification: "C2",
        evidence_state: { ...evidenceState, lab_status: "certified" },
        evaluation: { ...realEvaluation, judge_model: "worker/model" },
      })
    ).toThrow();
  });

  it("projects each employee tool need with its canonical catalog contract", () => {
    for (const employee of regenerated.employees) {
      expect(employee.tool_capabilities.length).toBeGreaterThan(0);
      expect(
        new Set(employee.tool_capabilities.map(tool => tool.capability)).size
      ).toBe(employee.tool_capabilities.length);
      for (const tool of employee.tool_capabilities) {
        const catalog = TOOL_CAPABILITIES.get(tool.capability);
        expect(catalog).toBeDefined();
        expect(tool.capability_version).toBe(catalog?.version);
        expect(tool.invocation).toBe(catalog?.invocation);
        expect(tool.risk_tier).toBe(catalog?.risk_tier);
        expect(tool.runtime_tool).toBe(catalog?.runtime_tool);
        expect(tool.provider_bindings).toEqual(catalog?.provider_bindings);
      }
    }

    const whale = regenerated.employees.find(
      employee => employee.employee_id === "ai-adoption-whale"
    );
    expect(
      whale?.tool_capabilities.find(tool => tool.capability === "shell.run")
    ).toMatchObject({
      necessity: "disabled",
      permission: "disabled",
      availability: "policy_disabled",
    });

    const macao = regenerated.employees.find(
      employee => employee.employee_id === "macao-networking-agent"
    );
    expect(
      macao?.tool_capabilities.find(tool => tool.capability === "contacts.read")
    ).toMatchObject({
      necessity: "non_default",
      permission: "requires_authorization",
      availability: "adapter_required",
    });
  });

  it("locks required capabilities on and disabled capabilities off", () => {
    const capabilities = regenerated.employees.flatMap(
      employee => employee.tool_capabilities
    );
    const required = capabilities.find(tool => tool.necessity === "required");
    const disabled = capabilities.find(tool => tool.necessity === "disabled");
    expect(required).toBeDefined();
    expect(disabled).toBeDefined();
    expect(isToolCapabilityEnabledByDefault(required!)).toBe(true);
    expect(isToolCapabilitySelectable(required!)).toBe(false);
    expect(isToolCapabilityEnabledByDefault(disabled!)).toBe(false);
    expect(isToolCapabilitySelectable(disabled!)).toBe(false);
  });

  it("makes non-default capabilities explicit opt-ins", () => {
    const optional = regenerated.employees
      .flatMap(employee => employee.tool_capabilities)
      .find(tool => tool.necessity === "non_default");
    expect(optional).toBeDefined();
    expect(isToolCapabilityEnabledByDefault(optional!)).toBe(false);
    expect(isToolCapabilitySelectable(optional!)).toBe(true);
  });

  it("enables conditional capabilities by default but lets the user turn them off", () => {
    const conditional = regenerated.employees
      .flatMap(employee => employee.tool_capabilities)
      .find(tool => tool.necessity === "conditional");
    expect(conditional).toBeDefined();
    expect(isToolCapabilityEnabledByDefault(conditional!)).toBe(true);
    expect(isToolCapabilitySelectable(conditional!)).toBe(true);
  });

  it("serializes only declared, enabled, non-disabled capabilities", () => {
    const macao = regenerated.employees.find(
      employee => employee.employee_id === "macao-networking-agent"
    );
    expect(macao).toBeDefined();
    const granted = toolCapabilitiesForHire(macao!.tool_capabilities, [
      "contacts.read",
      "crm.write",
      "unknown.capability",
    ]);
    expect(granted).toContain("web.search");
    expect(granted).toContain("contacts.read");
    expect(granted).not.toContain("places.search");
    expect(granted).not.toContain("calendar.availability.read");
    expect(granted).not.toContain("crm.write");
    expect(granted).not.toContain("unknown.capability");
  });
});
