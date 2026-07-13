import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildWebEmployees } from "../scripts/generate-web-employees";
import { TOOL_CAPABILITIES } from "../tool-catalog";
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
    }
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
