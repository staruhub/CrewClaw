// Generates the ecosystem-standard JSON Schema files from the Zod contracts. The Zod schemas
// stay the single source of truth; the emitted *.schema.json files are what third parties (other
// runtimes, editors, CI) validate employee packages against without a TypeScript toolchain.
//
//   pnpm run schema:generate
//
// A drift-guard test (contracts/__tests__/employee-spec.test.ts) regenerates these in memory and
// deep-equals them against disk, so a contract change without re-running this script fails CI.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { EmployeeSpecSchema } from "../employee-spec";
import { EmployeeManifestSchema } from "../manifest";

export function buildSchemas(): Record<string, unknown> {
  return {
    "employee.hire.schema.json": {
      $id: "https://crewclaw.dev/schema/employee.hire.schema.json",
      title: "CrewClaw Employee Hiring Contract (hire.yaml)",
      description:
        "Marketplace/install layer of the two-file employee standard: who to hire and what it needs to run.",
      ...z.toJSONSchema(EmployeeManifestSchema),
    },
    "employee.spec.schema.json": {
      $id: "https://crewclaw.dev/schema/employee.spec.schema.json",
      title: "CrewClaw Employee Runtime Spec (crewclaw.employee.yaml)",
      description:
        "Runtime layer of the two-file employee standard: how the employee works, is evaluated (eval_suite + outcome_rubric), and grows.",
      ...z.toJSONSchema(EmployeeSpecSchema),
    },
  };
}

function main() {
  const outDir = path.resolve(import.meta.dirname, "../schema");
  mkdirSync(outDir, { recursive: true });
  for (const [name, schema] of Object.entries(buildSchemas())) {
    const file = path.join(outDir, name);
    writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

// tsx runs this file directly; when imported by the drift-guard test, only buildSchemas is used.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
