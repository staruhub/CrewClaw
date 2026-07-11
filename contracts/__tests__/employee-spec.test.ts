import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_SPEC_REQUIRED_KEYS,
  EmployeeSpecSchema,
} from "../employee-spec";
// @ts-expect-error — untyped .mjs runtime module; the drift guard only reads a string array.
import { REQUIRED_FIELDS } from "../../packages/runtime/employee-package.mjs";
import yaml from "../../packages/runtime/yaml.mjs";

const repoRoot = path.resolve(__dirname, "../..");

function loadWhaleSpec(): Record<string, unknown> {
  const raw = readFileSync(
    path.join(repoRoot, "experts/ai-adoption-whale/crewclaw.employee.yaml"),
    "utf8"
  );
  return yaml.load(raw) as Record<string, unknown>;
}

describe("EmployeeSpecSchema", () => {
  it("accepts the real ai-adoption-whale spec (the v0.2.0 prototype the schema is modeled on)", () => {
    const result = EmployeeSpecSchema.safeParse(loadWhaleSpec());
    expect(
      result.success,
      JSON.stringify(result.success ? [] : result.error.issues, null, 2)
    ).toBe(true);
  });

  it("rejects a spec whose outcome_rubric weights do not sum to 1", () => {
    const spec = loadWhaleSpec() as {
      outcome_rubric: Array<{ weight: number }>;
    };
    spec.outcome_rubric[0].weight = 0.5; // 0.25 -> 0.5 pushes the sum to 1.25
    const result = EmployeeSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(issue => issue.message.includes("sum to 1"))
      ).toBe(true);
    }
  });

  it("rejects a spec missing eval_suite (an employee without a benchmark cannot be certified)", () => {
    const spec = loadWhaleSpec();
    delete (spec as Record<string, unknown>).eval_suite;
    expect(EmployeeSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects an unknown tool_needs necessity enum value (typos must not silently pass)", () => {
    const spec = loadWhaleSpec() as {
      tool_needs: Record<string, { necessity: string }>;
    };
    spec.tool_needs["web.search"].necessity = "reqired";
    expect(EmployeeSpecSchema.safeParse(spec as never).success).toBe(false);
  });

  it("keeps employee-package.mjs REQUIRED_FIELDS identical to the schema's required keys", () => {
    // Drift guard: the runtime presence-check and the Zod contract must never disagree about
    // what a spec minimally is.
    expect([...(REQUIRED_FIELDS as string[])].sort()).toEqual(
      [...EMPLOYEE_SPEC_REQUIRED_KEYS].sort()
    );
  });

  it("keeps the committed *.schema.json files in sync with the Zod contracts", async () => {
    // Drift guard: contracts changed without `pnpm run schema:generate` must fail here.
    const { buildSchemas } = await import("../scripts/generate-schemas");
    for (const [name, schema] of Object.entries(buildSchemas())) {
      const onDisk = JSON.parse(
        readFileSync(path.join(repoRoot, "contracts/schema", name), "utf8")
      );
      expect(onDisk, `${name} is stale — run pnpm run schema:generate`).toEqual(
        schema
      );
    }
  });
});
