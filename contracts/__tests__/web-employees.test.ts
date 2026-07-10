import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildWebEmployees } from "../scripts/generate-web-employees";

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
    const ids = regenerated.employees.map((employee) => employee.employee_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("ai-adoption-whale");
    expect(ids).toContain("zeneth");

    const registry = JSON.parse(
      readFileSync(path.join(repoRoot, "registry/experts.json"), "utf8"),
    ) as { experts: { status: string; local_source?: string | null }[] };
    const availableCount = registry.experts.filter(
      (entry) => entry.status === "available" && entry.local_source,
    ).length;
    expect(ids.length).toBe(availableCount);
  });

  it("never reintroduces fabricated fields", () => {
    for (const employee of regenerated.employees) {
      expect(employee).not.toHaveProperty("rating");
      expect(employee).not.toHaveProperty("hire_count");
    }
  });
});
