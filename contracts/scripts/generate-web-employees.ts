// Generates the website's employee dataset from the real sources of truth: registry/experts.json,
// each expert package's two standard files, and the canonical ToolCatalog. This retires the
// hand-copied src/data/employees.ts literals — the website is a projection, never a second place
// where employee facts or tool policy are typed by hand.
//
//   pnpm run web:employees
//
// A drift-guard test (contracts/__tests__/web-employees.test.ts) regenerates the dataset in memory
// and deep-equals it against disk, so editing a hire.yaml without re-running this script fails CI.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  loadRegistry,
  resolveExpertSourceFile,
} from "../../packages/registry/src/index";
import yaml from "../../packages/runtime/yaml.mjs";
import { EmployeeSpecSchema } from "../employee-spec";
import { EmployeeManifestSchema } from "../manifest";
import { getToolCapability } from "../tool-catalog";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export type GeneratedToolCapability = {
  capability: string;
  necessity: "required" | "conditional" | "non_default" | "disabled";
  permission: "readonly" | "write" | "requires_authorization" | "disabled";
  description: string;
  scopes: string[];
  approval: "never" | "when_needed" | "always" | null;
  purpose: string | null;
  limits: {
    max_calls_per_task?: number;
    timeout_ms?: number;
  } | null;
  on_unavailable: "fail" | "degrade" | "ask_user" | "skip" | null;
  capability_version: string;
  invocation: "model" | "engine" | "adapter";
  operation: "read" | "write" | "send" | "execute";
  risk_tier: "P0" | "P1" | "P2" | "P3" | "P4";
  runtime_tool: string | null;
  provider_bindings: { provider: string; tools: string[] }[];
  side_effects: string[];
  supports_preview: boolean;
  idempotent: boolean;
  timeout_ms: number;
  error_codes: string[];
  availability:
    | "runtime_implementation"
    | "engine_service"
    | "adapter_required"
    | "policy_disabled";
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
  tool_capabilities: GeneratedToolCapability[];
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

export function buildWebEmployees(root = repoRoot): GeneratedDataset {
  const registry = loadRegistry(path.join(root, "registry/experts.json"));

  const employees = registry.experts
    .filter(entry => entry.status === "available")
    .map(entry => {
      const hire = EmployeeManifestSchema.parse(
        yaml.load(
          readFileSync(
            resolveExpertSourceFile(root, entry, "hire.yaml"),
            "utf8"
          )
        )
      );
      const spec = EmployeeSpecSchema.parse(
        yaml.load(
          readFileSync(
            resolveExpertSourceFile(root, entry, "crewclaw.employee.yaml"),
            "utf8"
          )
        )
      );
      const toolCapabilities = Object.entries(spec.tool_needs).map(
        ([capability, need]) => {
          const catalog = getToolCapability(capability);
          if (!catalog) {
            throw new Error(
              `${entry.name}: tool_needs references unknown capability ${capability}`
            );
          }
          const availability =
            need.necessity === "disabled"
              ? "policy_disabled"
              : catalog.invocation === "adapter"
                ? "adapter_required"
                : catalog.runtime_tool
                  ? "runtime_implementation"
                  : "engine_service";
          return {
            capability,
            necessity: need.necessity,
            permission: need.permission,
            description: need.description,
            scopes: need.scopes ?? [],
            approval: need.approval ?? null,
            purpose: need.purpose ?? null,
            limits: need.limits ?? null,
            on_unavailable: need.on_unavailable ?? null,
            capability_version: catalog.version,
            invocation: catalog.invocation,
            operation: catalog.operation,
            risk_tier: catalog.risk_tier,
            runtime_tool: catalog.runtime_tool,
            provider_bindings: catalog.provider_bindings,
            side_effects: catalog.side_effects,
            supports_preview: catalog.supports_preview,
            idempotent: catalog.idempotent,
            timeout_ms: catalog.timeout_ms,
            error_codes: catalog.error_codes,
            availability,
          } satisfies GeneratedToolCapability;
        }
      );

      if (hire.metadata.id !== entry.name) {
        throw new Error(
          `hire.yaml id ${hire.metadata.id} != registry name ${entry.name}`
        );
      }
      if (entry.version && hire.metadata.version !== entry.version) {
        throw new Error(
          `${entry.name}: hire.yaml version ${hire.metadata.version} != registry ${entry.version}`
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
        tool_capabilities: toolCapabilities,
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
    $comment:
      "GENERATED — do not edit. Run `pnpm run web:employees` after changing the registry, an employee package, or ToolCatalog.",
    generated_by: "contracts/scripts/generate-web-employees.ts",
    sources: [
      "registry/experts.json",
      "experts/*/hire.yaml",
      "experts/*/crewclaw.employee.yaml",
      "contracts/tool-catalog.json",
    ],
    employees,
  };
}

function main() {
  const outFile = path.join(repoRoot, "src/data/employees.generated.json");
  const dataset = buildWebEmployees();
  writeFileSync(outFile, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(process.cwd(), outFile)} (${dataset.employees.length} employees)`
  );
}

// tsx runs this file directly; when imported by the drift-guard test, only buildWebEmployees is used.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main();
}
