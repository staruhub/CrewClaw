import type { LocalEmployeePerformance } from "@contracts/local-performance";
import { hasPublishedLabCredential, type Employee } from "@/data/employees";
import type { MarketplaceMessageKey } from "./locales/marketplace";
import type { MessageValues } from "./format";

export type MarketplaceT = (
  key: MarketplaceMessageKey,
  values?: MessageValues
) => string;

export const categoryLabelKeys = {
  "": "categoryAll",
  "ai-advisory": "categoryAiAdvisory",
  community: "categoryCommunity",
  engineering: "categoryEngineering",
  product: "categoryProduct",
  research: "categoryResearch",
  sales: "categorySales",
  operations: "categoryOperations",
  strategy: "categoryStrategy",
  "local-expert": "categoryLocalExpert",
  marketing: "categoryMarketing",
} as const satisfies Record<string, MarketplaceMessageKey>;

export const evidenceFilterLabelKeys = {
  all: "evidenceAll",
  "lab-certified": "evidenceLabCertified",
  "package-validated": "evidencePackageValidated",
  "local-ready": "evidenceLocalReady",
  "runtime-attention": "evidenceRuntimeAttention",
} as const satisfies Record<string, MarketplaceMessageKey>;

export function categoryLabel(value: string, t: MarketplaceT) {
  return t(
    categoryLabelKeys[value as keyof typeof categoryLabelKeys] ?? "categoryAll"
  );
}

export function evidenceFilterLabel(value: string, t: MarketplaceT) {
  return t(
    evidenceFilterLabelKeys[value as keyof typeof evidenceFilterLabelKeys] ??
      "evidenceAll"
  );
}

const registryStatusKeys = {
  validated: "registryStatusValidated",
  invalid: "registryStatusInvalid",
  draft: "registryStatusDraft",
  untested: "registryStatusUntested",
  insufficient: "registryStatusInsufficient",
  proven: "registryStatusProven",
  published: "registryStatusPublished",
  disabled: "registryStatusDisabled",
} as const satisfies Record<string, MarketplaceMessageKey>;

export function registryStatusLabel(value: string, t: MarketplaceT) {
  const key = registryStatusKeys[value as keyof typeof registryStatusKeys];
  return key ? t(key) : value;
}

export function employeeEvidenceBadge(employee: Employee, t: MarketplaceT) {
  if (hasPublishedLabCredential(employee)) return t("labCertifiedBadge");
  if (employee.evidence_state.package_status === "validated") {
    return t("packageValidatedBadge");
  }
  if (employee.evidence_state.package_status === "invalid") {
    return t("packageInvalidBadge");
  }
  return t("draftPackageBadge");
}

export function employeeEvidenceLevel(employee: Employee, t: MarketplaceT) {
  if (hasPublishedLabCredential(employee)) {
    return t("evidenceLevelLab", { certification: employee.certification });
  }
  if (employee.evidence_state.package_status === "validated") {
    return t("evidenceLevelPackage", {
      certification: employee.certification,
    });
  }
  return t("evidenceLevelDraft", {
    certification: employee.certification,
    status: employee.evidence_state.package_status,
  });
}

export function runtimeText(employee: Employee, t: MarketplaceT) {
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
  const ready = runtimeReady + engineService;

  return {
    adapterRequired,
    engineService,
    highestRisk,
    label:
      total === 0 ? t("noToolsDeclared") : t("runtimeBacked", { ready, total }),
    policyDisabled,
    runtimeReady,
    total,
    detail:
      adapterRequired > 0
        ? t(
            adapterRequired === 1
              ? "adapterRequiredOne"
              : "adapterRequiredMany",
            {
              count: adapterRequired,
            }
          )
        : policyDisabled > 0
          ? t(
              policyDisabled === 1 ? "policyDisabledOne" : "policyDisabledMany",
              {
                count: policyDisabled,
              }
            )
          : t("noAdapterGaps"),
  };
}

export function availabilityText(employee: Employee, t: MarketplaceT) {
  if (!employee.lifecycle.hireable) return t("notHireable");
  if (!employee.local_source) return t("packageDownloadPending");
  if (employee.evidence_state.package_status !== "validated") {
    return t("packageStatus", {
      status: employee.evidence_state.package_status,
    });
  }
  return t("hireableForLocalTrial");
}

export function kpiStateText(
  performance: LocalEmployeePerformance | null | undefined,
  t: MarketplaceT
) {
  if (!performance) return t("localKpiUnavailable");
  if (performance.kpi.state === "invalid") return t("localKpiInvalid");
  if (performance.kpi.state === "absent") return t("noLocalKpiLedger");
  return t("receiptBackedLocalKpi");
}

export function taskCountText(
  performance: LocalEmployeePerformance | null | undefined,
  t: MarketplaceT
) {
  if (performance?.kpi.state !== "available") return t("unavailable");
  return String(performance.kpi.tasks ?? 0);
}

export function acceptanceText(
  performance: LocalEmployeePerformance | null | undefined,
  t: MarketplaceT
) {
  if (performance?.kpi.state !== "available") return t("unavailable");
  const tasks = performance.kpi.tasks ?? 0;
  const accepted = performance.kpi.accepted ?? 0;
  if (tasks === 0) return t("noFormalTasks");
  return `${Math.round((accepted / tasks) * 100)}%`;
}

export function averageCostText(
  performance: LocalEmployeePerformance | null | undefined,
  t: MarketplaceT
) {
  if (performance?.kpi.state !== "available") return t("unavailable");
  return formatMoneyText(performance.kpi.average_cost, t);
}

export function reputationText(
  performance: LocalEmployeePerformance | null | undefined,
  t: MarketplaceT
) {
  if (!performance) return t("localProofUnavailable");
  if (performance.proof_pack.state === "invalid") return t("invalidProofPack");
  if (performance.proof_pack.field_status === "proven") return t("fieldProven");
  if (performance.verified_reviews.length > 0) {
    const count = performance.verified_reviews.length;
    return t(count === 1 ? "verifiedReviewOne" : "verifiedReviewMany", {
      count,
    });
  }
  return t("noVerifiedReputation");
}

export function formatPercentText(
  value: number | null | undefined,
  t: MarketplaceT
) {
  if (value === null || value === undefined) return t("unavailable");
  return `${Math.round(value * 100)}%`;
}

export function formatDurationText(
  valueMs: number | null | undefined,
  t: MarketplaceT
) {
  if (valueMs === null || valueMs === undefined) return t("unavailable");
  const seconds = Math.round(valueMs / 1000);
  if (seconds < 60) return t("durationSecondsShort", { value: seconds });
  return t("durationMinutesShort", { value: Math.round(seconds / 60) });
}

export function formatMoneyText(
  value: number | null | undefined,
  t: MarketplaceT
) {
  if (value === null || value === undefined) return t("unavailable");
  return `$${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    value
  )}`;
}

function highestRiskTier(capabilities: Employee["tool_capabilities"]) {
  const ranks = ["P0", "P1", "P2", "P3", "P4"] as const;
  return capabilities.reduce<(typeof ranks)[number]>(
    (highest, capability) =>
      ranks.indexOf(capability.risk_tier) > ranks.indexOf(highest)
        ? capability.risk_tier
        : highest,
    "P0"
  );
}
