import { describe, expect, it } from "vitest";
import { capabilityOnboardingRequirements } from "@/lib/capability-onboarding";
import type { EmployeeToolCapability } from "@/data/employees";

function capability(
  capabilityId: string
): EmployeeToolCapability {
  return {
    capability: capabilityId,
    necessity: "conditional",
    permission: "requires_authorization",
    description: "Reads a task-scoped source through a configured provider.",
    scopes: ["workspace:source:read"],
    approval: "always",
    purpose: "Use only when the task needs the declared source.",
    limits: { max_calls_per_task: 3, timeout_ms: 4_000 },
    on_unavailable: "ask_user",
    capability_version: "1.0.0",
    invocation: "adapter",
    operation: "read",
    risk_tier: "P2",
    runtime_tool: null,
    provider_bindings: [{ provider: "example", tools: ["fetch"] }],
    side_effects: [],
    supports_preview: false,
    idempotent: true,
    timeout_ms: 4_000,
    error_codes: ["unavailable"],
    availability: "adapter_required",
  };
}

describe("capability-derived onboarding guidance", () => {
  it("derives setup guidance from capability metadata rather than capability IDs", () => {
    const forFirstCatalogEntry = capabilityOnboardingRequirements({
      tool_capabilities: [capability("future.source.read")],
    });
    const forRenamedCatalogEntry = capabilityOnboardingRequirements({
      tool_capabilities: [capability("renamed.source.read")],
    });

    expect(forFirstCatalogEntry).toEqual(forRenamedCatalogEntry);
    expect(forFirstCatalogEntry.join(" ")).toContain("declared read scope");
    expect(forFirstCatalogEntry.join(" ")).toContain("provider adapter");
    expect(forFirstCatalogEntry.join(" ")).toContain("human available");
    expect(forFirstCatalogEntry.join(" ")).toContain("declared task limits");
  });
});
