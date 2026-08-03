import type { LocalEmployeePerformance } from "@contracts/local-performance";
import type { Employee, EmployeeToolCapability } from "@/data/employees";
import { hasPublishedLabCredential } from "@/data/employees";

export type EmployeeEvidenceFilter =
  | "all"
  | "lab-certified"
  | "package-validated"
  | "local-ready"
  | "runtime-attention";

export const EMPLOYEE_EVIDENCE_FILTERS: {
  label: string;
  value: EmployeeEvidenceFilter;
}[] = [
  { label: "All evidence", value: "all" },
  { label: "Lab certified", value: "lab-certified" },
  { label: "Package validated", value: "package-validated" },
  { label: "Local package ready", value: "local-ready" },
  { label: "Runtime attention", value: "runtime-attention" },
];

const numberFormat = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

function isKpiAvailable(performance?: LocalEmployeePerformance | null) {
  return performance?.kpi.state === "available";
}

export function formatPercentValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unavailable";
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined) return "Unavailable";
  const seconds = Math.round(valueMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unavailable";
  return `$${numberFormat.format(value)}`;
}

export function taskCountLabel(performance?: LocalEmployeePerformance | null) {
  if (!isKpiAvailable(performance)) return "Unavailable";
  return String(performance?.kpi.tasks ?? 0);
}

export function acceptanceLabel(performance?: LocalEmployeePerformance | null) {
  if (!isKpiAvailable(performance)) return "Unavailable";
  const tasks = performance?.kpi.tasks ?? 0;
  const accepted = performance?.kpi.accepted ?? 0;
  if (tasks === 0) return "No formal tasks";
  return `${Math.round((accepted / tasks) * 100)}%`;
}

export function averageCostLabel(
  performance?: LocalEmployeePerformance | null
) {
  if (!isKpiAvailable(performance)) return "Unavailable";
  return formatMoney(performance?.kpi.average_cost);
}

export function reputationLabel(performance?: LocalEmployeePerformance | null) {
  if (!performance) return "Local proof unavailable";
  if (performance.proof_pack.state === "invalid") return "Invalid proof pack";
  if (performance.proof_pack.field_status === "proven") return "Field proven";
  if (performance.verified_reviews.length > 0) {
    return `${performance.verified_reviews.length} verified review${
      performance.verified_reviews.length === 1 ? "" : "s"
    }`;
  }
  return "No verified reputation yet";
}

export function kpiStateLabel(performance?: LocalEmployeePerformance | null) {
  if (!performance) return "Local KPI unavailable";
  if (performance.kpi.state === "invalid") return "Local KPI invalid";
  if (performance.kpi.state === "absent") return "No local KPI ledger";
  return "Receipt-backed local KPI";
}

export function runtimeSummary(employee: Employee) {
  const capabilities = employee.tool_capabilities;
  const total = capabilities.length;
  const runtimeReady = capabilities.filter(
    capability => capability.availability === "runtime_implementation"
  ).length;
  const engineService = capabilities.filter(
    capability => capability.availability === "engine_service"
  ).length;
  const adapterRequired = capabilities.filter(
    capability => capability.availability === "adapter_required"
  ).length;
  const policyDisabled = capabilities.filter(
    capability => capability.availability === "policy_disabled"
  ).length;
  const highestRisk = highestRiskTier(capabilities);

  return {
    total,
    runtimeReady,
    engineService,
    adapterRequired,
    policyDisabled,
    highestRisk,
    label:
      total === 0
        ? "No tools declared"
        : `${runtimeReady + engineService}/${total} runtime-backed`,
    detail:
      adapterRequired > 0
        ? `${adapterRequired} adapter-required ${
            adapterRequired === 1 ? "capability" : "capabilities"
          }`
        : policyDisabled > 0
          ? `${policyDisabled} policy-disabled ${
              policyDisabled === 1 ? "capability" : "capabilities"
            }`
          : "No adapter gaps declared",
  };
}

export function availabilityLabel(employee: Employee) {
  if (!employee.lifecycle.hireable) return "Not hireable";
  if (!employee.local_source) return "Package download pending";
  if (employee.evidence_state.package_status !== "validated") {
    return `${employee.evidence_state.package_status} package`;
  }
  return "Hireable for local trial";
}

export function employeeMatchesEvidenceFilter(
  employee: Employee,
  filter: EmployeeEvidenceFilter
) {
  if (filter === "all") return true;
  if (filter === "lab-certified") return hasPublishedLabCredential(employee);
  if (filter === "package-validated") {
    return employee.evidence_state.package_status === "validated";
  }
  if (filter === "local-ready") return Boolean(employee.local_source);
  return runtimeSummary(employee).adapterRequired > 0;
}

export function employeeSearchText(employee: Employee) {
  return [
    employee.name,
    employee.role,
    employee.description,
    employee.identity.title,
    employee.identity.description,
    employee.identity.location ?? "",
    employee.certification,
    employee.first_task,
    ...employee.categories,
    ...employee.tags,
    ...employee.skills,
    ...employee.permissions,
    ...employee.examples.inputs,
    ...employee.examples.outputs,
    ...employee.tool_capabilities.flatMap(capability => [
      capability.capability,
      capability.description,
      capability.runtime_tool ?? "",
      capability.availability,
      capability.risk_tier,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesEmployeeQuery(employee: Employee, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return employeeSearchText(employee).includes(normalized);
}

export function runtimeHandoffParam(employee: Employee) {
  const providers = [
    ...new Set(
      employee.tool_capabilities.flatMap(capability =>
        capability.provider_bindings.map(binding => binding.provider)
      )
    ),
  ];
  return providers[0] ?? "crewclaw.runtime";
}

export function accessHandoffParam(employee: Employee) {
  const required = employee.tool_capabilities
    .filter(capability => capability.necessity === "required")
    .map(capability => capability.capability);
  return required.slice(0, 4).join(",");
}

export function hireHandoffUrl(employee: Employee, source: string) {
  const params = new URLSearchParams({
    source,
    task: employee.first_task,
    budget: "task-scoped",
    runtime: runtimeHandoffParam(employee),
  });
  const access = accessHandoffParam(employee);
  if (access) params.set("access", access);
  return `/hire/${employee.employee_id}?${params.toString()}`;
}

function highestRiskTier(capabilities: EmployeeToolCapability[]) {
  const ranks = ["P0", "P1", "P2", "P3", "P4"] as const;
  return capabilities.reduce<(typeof ranks)[number]>(
    (highest, capability) =>
      ranks.indexOf(capability.risk_tier) > ranks.indexOf(highest)
        ? capability.risk_tier
        : highest,
    "P0"
  );
}
