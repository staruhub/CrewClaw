// Generates the website's employee dataset from the real sources of truth: registry/experts.json
// plus each expert package's two standard files (hire.yaml + crewclaw.employee.yaml). This retires
// the hand-copied src/data/employees.ts literals — the website is a projection of the registry,
// never a second place where employee facts are typed by hand.
//
//   pnpm run web:employees
//
// A drift-guard test (contracts/__tests__/web-employees.test.ts) regenerates the dataset in memory
// and deep-equals it against disk, so editing a hire.yaml without re-running this script fails CI.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import yaml from "../../packages/runtime/yaml.mjs";
import { EmployeeSpecSchema } from "../employee-spec";
import { EmployeeManifestSchema } from "../manifest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

type RegistryExpert = {
  name: string;
  display_name: string;
  status: string;
  certification: string;
  category: string;
  description: string;
  repo?: string | null;
  local_source?: string | null;
  version?: string;
  pricing: string;
  tags: string[];
  install_command?: string | null;
  first_task?: string;
};

type Registry = {
  updated_at: string;
  experts: RegistryExpert[];
};

export type GeneratedEmployee = {
  employee_id: string;
  name: string;
  role: string;
  creator_id: string;
  description: string;
  status: "published";
  verified: boolean;
  categories: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  version: string;
  certification: string;
  pricing: string;
  repo: string | null;
  local_source: string | null;
  install_command: string | null;
  first_task: string;
  mascot: string;
  identity: {
    title: string;
    description: string;
    reports_to?: string;
    location?: string;
  };
  skills: string[];
  tools: string[];
  permissions: string[];
  examples: { inputs: string[]; outputs: string[] };
  limitations: string[];
  lifecycle: { hireable: boolean; fireable: boolean; trial_period: string };
  demo_tasks: string[];
  changelog: string[];
  safety_notes: string[];
};

export type GeneratedDataset = {
  $comment: string;
  generated_by: string;
  sources: string[];
  employees: GeneratedEmployee[];
};

export function buildWebEmployees(): GeneratedDataset {
  const registry = JSON.parse(
    readFileSync(path.join(repoRoot, "registry/experts.json"), "utf8"),
  ) as Registry;

  const employees = registry.experts
    .filter((entry) => entry.status === "available" && entry.local_source)
    .map((entry) => {
      const packageDir = path.join(repoRoot, entry.local_source as string);
      const hire = EmployeeManifestSchema.parse(
        yaml.load(readFileSync(path.join(packageDir, "hire.yaml"), "utf8")),
      );
      // The runtime spec is not projected onto the website yet, but parsing it here enforces
      // that every published employee ships a valid two-file standard, not just a hire contract.
      EmployeeSpecSchema.parse(
        yaml.load(readFileSync(path.join(packageDir, "crewclaw.employee.yaml"), "utf8")),
      );

      if (hire.metadata.id !== entry.name) {
        throw new Error(`hire.yaml id ${hire.metadata.id} != registry name ${entry.name}`);
      }
      if (entry.version && hire.metadata.version !== entry.version) {
        throw new Error(
          `${entry.name}: hire.yaml version ${hire.metadata.version} != registry ${entry.version}`,
        );
      }
      if (!entry.first_task) {
        throw new Error(`${entry.name}: registry entry is missing first_task`);
      }

      return {
        employee_id: entry.name,
        name: entry.display_name,
        role: hire.identity.title,
        creator_id: "chaogeek",
        description: hire.identity.description,
        status: "published",
        verified: hire.metadata.certification === "C2",
        categories: hire.categories ?? [entry.category],
        tags: hire.tags ?? entry.tags,
        created_at: registry.updated_at,
        updated_at: registry.updated_at,
        version: hire.metadata.version,
        certification: hire.metadata.certification,
        pricing: hire.pricing ?? entry.pricing,
        repo: entry.repo ?? null,
        local_source: entry.local_source ?? null,
        install_command: entry.install_command ?? null,
        first_task: entry.first_task,
        mascot: hire.metadata.mascot,
        identity: hire.identity,
        skills: hire.skills,
        tools: hire.tools,
        permissions: hire.permissions,
        examples: hire.examples,
        limitations: hire.limitations,
        lifecycle: hire.lifecycle,
        demo_tasks: hire.demo_tasks ?? [],
        changelog: hire.changelog ?? [],
        safety_notes: hire.safety_notes ?? [],
      } satisfies GeneratedEmployee;
    });

  return {
    $comment: "GENERATED — do not edit. Run `pnpm run web:employees` after changing the registry or any hire.yaml.",
    generated_by: "contracts/scripts/generate-web-employees.ts",
    sources: ["registry/experts.json", "experts/*/hire.yaml", "experts/*/crewclaw.employee.yaml"],
    employees,
  };
}

function main() {
  const outFile = path.join(repoRoot, "src/data/employees.generated.json");
  const dataset = buildWebEmployees();
  writeFileSync(outFile, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), outFile)} (${dataset.employees.length} employees)`);
}

// tsx runs this file directly; when imported by the drift-guard test, only buildWebEmployees is used.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
