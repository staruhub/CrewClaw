// Thin adapter over the generated dataset. The employee facts live in registry/experts.json and
// each expert package's hire.yaml / crewclaw.employee.yaml — regenerate with `pnpm run
// web:employees` (drift-guarded by contracts/__tests__/web-employees.test.ts). Never hand-edit
// employee data here or in employees.generated.json.
import type { AgentEmployee } from "@contracts/types";
import type { GeneratedEmployee } from "@contracts/scripts/generate-web-employees";

import generated from "./employees.generated.json";

export type EmployeeExamples = {
  inputs: string[];
  outputs: string[];
};

export type EmployeeLifecycle = {
  hireable: boolean;
  fireable: boolean;
  trial_period: string;
};

export type EmployeeIdentity = {
  title: string;
  description: string;
  reports_to?: string;
  location?: string;
};

export type CertifiedEmployeeEvaluation = NonNullable<
  GeneratedEmployee["certified_evaluation"]
>;

export type EmployeeToolNecessity =
  | "required"
  | "conditional"
  | "non_default"
  | "disabled";
export type EmployeeToolPermission =
  | "readonly"
  | "write"
  | "requires_authorization"
  | "disabled";
export type EmployeeToolAvailability =
  | "runtime_implementation"
  | "engine_service"
  | "adapter_required"
  | "policy_disabled";

export type EmployeeToolCapability = {
  capability: string;
  necessity: EmployeeToolNecessity;
  permission: EmployeeToolPermission;
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
  availability: EmployeeToolAvailability;
};

export function isToolCapabilityEnabledByDefault(
  capability: EmployeeToolCapability
) {
  return ["required", "conditional"].includes(capability.necessity);
}

export function isToolCapabilitySelectable(capability: EmployeeToolCapability) {
  return ["conditional", "non_default"].includes(capability.necessity);
}

export function toolCapabilitiesForHire(
  capabilities: EmployeeToolCapability[],
  selectedCapabilities: string[]
) {
  const selected = new Set(selectedCapabilities);
  return capabilities
    .filter(
      capability =>
        capability.necessity === "required" ||
        (isToolCapabilitySelectable(capability) &&
          selected.has(capability.capability))
    )
    .map(capability => capability.capability);
}

export type Employee = AgentEmployee & {
  mascot?: string;
  version: string;
  certification: string;
  evidence_state: GeneratedEmployee["evidence_state"];
  certified_evaluation: CertifiedEmployeeEvaluation | null;
  pricing: string;
  repo: string | null;
  local_source: string | null;
  install_command: string | null;
  first_task: string;
  identity: EmployeeIdentity;
  skills: string[];
  tools: string[];
  tool_capabilities: EmployeeToolCapability[];
  permissions: string[];
  examples: EmployeeExamples;
  limitations: string[];
  lifecycle: EmployeeLifecycle;
  demo_tasks: string[];
  changelog: string[];
  safety_notes: string[];
};

/**
 * A formal lab badge is derived from the published credential, never from the
 * legacy `verified` boolean or the C-level string alone. The generated registry
 * projection already validates the credential; these checks keep the UI
 * fail-closed if a stale or hand-edited dataset reaches the browser.
 */
export function hasPublishedLabCredential(employee: Employee) {
  return (
    employee.evidence_state.lab_status === "certified" &&
    employee.certified_evaluation?.mock === false &&
    Boolean(employee.certified_evaluation.signature) &&
    Boolean(employee.certified_evaluation.source)
  );
}

export function employeeEvidenceBadge(employee: Employee) {
  if (hasPublishedLabCredential(employee)) return "Lab certified · registry";
  if (employee.evidence_state.package_status === "validated") {
    return "Package validated · registry";
  }
  if (employee.evidence_state.package_status === "invalid") {
    return "Package invalid · registry";
  }
  return "Draft package · registry";
}

export function employeeEvidenceLevel(employee: Employee) {
  if (hasPublishedLabCredential(employee)) {
    return `${employee.certification} · lab · registry`;
  }
  if (employee.evidence_state.package_status === "validated") {
    return `${employee.certification} · package · registry`;
  }
  return `${employee.certification} · ${employee.evidence_state.package_status} package · registry`;
}

// JSON widens literals (status: string), so a cast is needed; the generator Zod-validates every
// package and the drift guard keeps disk in sync with the sources.
export const employees = generated.employees as unknown as Employee[];

export const availableEmployees = employees;

export function getEmployee(id: string) {
  return employees.find(employee => employee.employee_id === id);
}

export function searchEmployees(keyword: string) {
  const query = keyword.trim().toLowerCase();

  if (!query) return employees;

  return employees.filter(employee => {
    const searchable = [
      employee.name,
      employee.role,
      employee.description,
      employee.pricing,
      ...employee.categories,
      ...employee.tags,
      ...employee.skills,
      ...employee.tools,
      ...employee.tool_capabilities.flatMap(capability => [
        capability.capability,
        capability.description,
        capability.runtime_tool ?? "",
      ]),
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  });
}

export function byCategory(): Record<string, Employee[]>;
export function byCategory(category: string): Employee[];
export function byCategory(category?: string) {
  if (category) {
    const normalized = category.toLowerCase();
    return employees.filter(employee =>
      employee.categories.some(item => item.toLowerCase() === normalized)
    );
  }

  return employees.reduce<Record<string, Employee[]>>((groups, employee) => {
    for (const item of employee.categories) {
      groups[item] = groups[item] ?? [];
      groups[item].push(employee);
    }

    return groups;
  }, {});
}
