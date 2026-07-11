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

import {
  DreamApprovalSchema,
  DreamCandidateSchema,
  DreamDiffSchema,
  DreamJobSchema,
  MemoryActivationSchema,
  MemoryItemV2Schema,
  ReflectionSchema,
} from "../dream";
import { EmployeeSpecSchema } from "../employee-spec";
import { EmployeeManifestSchema } from "../manifest";

// M0（条件式 Dream）：每个 Dream/Reflect 核心制品都有版本化 Schema。文件名与契约字符串一一对应。
const DREAM_ARTIFACT_SCHEMAS: Array<[string, string, string, z.ZodType]> = [
  [
    "memory.item.schema.json",
    "CrewClaw Memory Item (crewclaw.memory-item/v2)",
    "Lifecycle + provenance for a single long-term memory entry.",
    MemoryItemV2Schema,
  ],
  [
    "dream.reflect.schema.json",
    "CrewClaw Task Reflection (crewclaw.reflect/v1)",
    "Immutable deterministic task work log — the only admissible Dream input.",
    ReflectionSchema,
  ],
  [
    "dream.job.schema.json",
    "CrewClaw Dream Job (crewclaw.dream-job/v1)",
    "One conditional-Dream run: inputs, state machine, cost, diff, validation, approval.",
    DreamJobSchema,
  ],
  [
    "dream.candidate.schema.json",
    "CrewClaw Dream Candidate Store (crewclaw.dream-candidate/v1)",
    "A complete candidate memory store; never read by recall until activated.",
    DreamCandidateSchema,
  ],
  [
    "dream.diff.schema.json",
    "CrewClaw Dream Diff (crewclaw.dream-diff/v1)",
    "Structured add/merge/replace/drop/keep entries with per-entry provenance.",
    DreamDiffSchema,
  ],
  [
    "dream.approval.schema.json",
    "CrewClaw Dream Approval (crewclaw.dream-approval/v1)",
    "Immutable human approval receipt for a dream run.",
    DreamApprovalSchema,
  ],
  [
    "memory.activation.schema.json",
    "CrewClaw Memory Activation (crewclaw.memory-activation/v1)",
    "Atomic swap record: previous store hash, activated store hash, archive location.",
    MemoryActivationSchema,
  ],
];

export function buildSchemas(): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      DREAM_ARTIFACT_SCHEMAS.map(([file, title, description, schema]) => [
        file,
        {
          $id: `https://crewclaw.dev/schema/${file}`,
          title,
          description,
          ...z.toJSONSchema(schema),
        },
      ])
    ),
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
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main();
}
