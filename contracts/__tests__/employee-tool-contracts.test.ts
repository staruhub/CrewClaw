import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EmployeeSpecSchema } from "../employee-spec";
import {
  TOOL_CAPABILITIES,
  TOOL_CATALOG,
  ToolCapabilitySchema,
  ToolCatalogSchema,
} from "../tool-catalog";
import yaml from "../../packages/runtime/yaml.mjs";

const repoRoot = path.resolve(__dirname, "../..");

const expectedContracts = {
  "ai-adoption-whale": {
    active: [
      "web.search",
      "web.fetch_extract",
      "source.verify",
      "evidence.create",
      "artifact.report",
      "browser.render",
    ],
    disabled: ["shell.run", "files.write", "message.send", "email.send"],
  },
  "code-review-shrimp": {
    active: [
      "files.read",
      "repo.diff.read",
      "repo.search",
      "repo.status.read",
      "artifact.report",
      "test.run",
    ],
    disabled: ["shell.run", "files.write", "repo.push", "production.deploy"],
  },
  "product-prd-crab": {
    active: [
      "document.read",
      "artifact.report",
      "web.search",
      "web.fetch",
      "source.verify",
    ],
    disabled: ["message.send", "email.send", "production.deploy"],
  },
  "macao-networking-agent": {
    active: [
      "web.search",
      "web.fetch",
      "source.verify",
      "evidence.create",
      "artifact.report",
      "browser.render",
      "places.search",
      "contacts.read",
      "calendar.availability.read",
    ],
    disabled: ["crm.write", "message.send", "email.send"],
  },
  zeneth: {
    active: [
      "community.context.read",
      "artifact.report",
      "web.search",
      "web.fetch",
      "source.verify",
      "analytics.aggregate",
      "broadcast.draft",
    ],
    disabled: ["broadcast.send", "member_data.write", "message.send"],
  },
} as const;

describe("employee executable tool contracts", () => {
  it("loads the committed catalog as the single validated capability registry", () => {
    expect(ToolCatalogSchema.parse(TOOL_CATALOG)).toEqual(TOOL_CATALOG);
    expect(TOOL_CAPABILITIES.size).toBe(TOOL_CATALOG.capabilities.length);
    expect(
      TOOL_CATALOG.capabilities.every(
        capability =>
          capability.runtime_tool !== null ||
          capability.provider_bindings.length > 0
      )
    ).toBe(true);
  });

  it("rejects catalog entries whose invocation or P4 side effects are not executable/auditable", () => {
    const base = TOOL_CATALOG.capabilities.find(
      capability => capability.id === "web.search"
    )!;
    expect(
      ToolCapabilitySchema.safeParse({
        ...base,
        runtime_tool: null,
        provider_bindings: [
          { provider: "some.remote.provider", tools: ["search"] },
        ],
      }).success
    ).toBe(false);
    expect(
      ToolCapabilitySchema.safeParse({
        ...base,
        id: "adapter.example",
        invocation: "adapter",
        runtime_tool: null,
        provider_bindings: [],
      }).success
    ).toBe(false);
    expect(
      ToolCapabilitySchema.safeParse({
        ...base,
        id: "external.send",
        invocation: "adapter",
        operation: "send",
        risk_tier: "P4",
        runtime_tool: null,
        provider_bindings: [{ provider: "external", tools: ["send"] }],
        side_effects: [],
      }).success
    ).toBe(false);
  });

  it("rejects declarative tool limits that the runtime does not enforce", () => {
    const whale = yaml.load(
      readFileSync(
        path.join(repoRoot, "experts/ai-adoption-whale/crewclaw.employee.yaml"),
        "utf8"
      )
    ) as Record<string, unknown>;
    const needs = whale.tool_needs as Record<string, Record<string, unknown>>;
    expect(
      EmployeeSpecSchema.safeParse({
        ...whale,
        tool_needs: {
          ...needs,
          "web.search": {
            ...needs["web.search"],
            limits: { allowed_hosts: ["example.com"] },
          },
        },
      }).success
    ).toBe(false);
  });

  for (const [slug, expected] of Object.entries(expectedContracts)) {
    it(`${slug} declares only its role-scoped catalog capabilities`, () => {
      const document = yaml.load(
        readFileSync(
          path.join(repoRoot, `experts/${slug}/crewclaw.employee.yaml`),
          "utf8"
        )
      );
      const spec = EmployeeSpecSchema.parse(document);
      const entries = Object.entries(spec.tool_needs);
      const active = entries
        .filter(([, need]) => need.necessity !== "disabled")
        .map(([id]) => id);
      const disabled = entries
        .filter(([, need]) => need.necessity === "disabled")
        .map(([id]) => id);

      expect(active).toEqual(expect.arrayContaining([...expected.active]));
      expect(active).toHaveLength(expected.active.length);
      expect(disabled).toEqual(expect.arrayContaining([...expected.disabled]));
      expect(disabled).toHaveLength(expected.disabled.length);
      expect(entries.every(([id]) => TOOL_CAPABILITIES.has(id))).toBe(true);
      expect(
        entries
          .filter(([, need]) => need.necessity === "disabled")
          .every(([id]) => Object.hasOwn(spec.permission_policy.denied, id))
      ).toBe(true);
      expect(
        entries
          .filter(([, need]) => need.necessity === "disabled")
          .every(([id]) => !Object.hasOwn(spec.permission_policy.grants, id))
      ).toBe(true);
    });
  }
});
