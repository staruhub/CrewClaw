/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileText,
  Globe2,
  Hourglass,
  KeyRound,
  Network,
  Play,
  ReceiptText,
  ShieldCheck,
  Undo2,
  UserCheck,
  WalletCards,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ToolCapabilityList } from "@/components/employee/ToolCapabilityList";
import {
  PricingBadge,
  PricingBulletList,
  PricingPlanIcon,
} from "@/components/PricingInfo";
import {
  getPermissionLevel,
  permissionLabel,
  type PermissionRiskLevel,
} from "@/lib/permissions";
import {
  CHECKOUT_PLANS,
  pricingTone,
  type CheckoutPlanId,
} from "@/lib/pricing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  getEmployee,
  isToolCapabilityEnabledByDefault,
  isToolCapabilitySelectable,
  toolCapabilitiesForHire,
  type EmployeeToolCapability,
} from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";
import { HireCliHandoff } from "@/components/HireCliHandoff";
import { capabilityGrantTokensForHire } from "@/lib/capability-grants";
import {
  formatMessage,
  useI18n,
  useMessages,
  type LocalizedCatalog,
} from "@/i18n";
import { localizeEmployeeContent } from "@/i18n/employee-content";
import { hireEn, type HireMessageKey } from "@/i18n/locales/en/hire";
import { hireZhCN } from "@/i18n/locales/zh-CN/hire";

const HIRE_INTENT_STORAGE_KEY = "crewclaw.hire-intent.v1";

const hireMessages = {
  en: hireEn,
  "zh-CN": hireZhCN,
} as const satisfies LocalizedCatalog;

type HireTranslator = (
  key: HireMessageKey,
  values?: Record<string, string | number>
) => string;

const defaultHireT: HireTranslator = (key, values) =>
  formatMessage(hireEn[key], values);

type PermissionSummary = {
  permission: string;
  label: string;
  access: string;
  action: PermissionRiskLevel;
  confirmation: string;
  risk: string;
  enabledByDefault: boolean;
};

function summarizePermission(
  permission: string,
  t: HireTranslator = defaultHireT
): PermissionSummary {
  const disabled = permission.includes("disabled");
  const humanConfirmation = permission.includes("human_confirmation_required");
  const write = permission.includes(":write");
  const read = permission.includes(":read");
  const action = getPermissionLevel(permission);

  if (permission.startsWith("public_web")) {
    return {
      permission,
      label: t("permissionPublicWebLabel"),
      access: t("permissionPublicWebAccess"),
      action,
      confirmation: t("permissionPublicWebConfirmation"),
      risk: t("permissionPublicWebRisk"),
      enabledByDefault: true,
    };
  }

  if (permission.startsWith("contacts")) {
    return {
      permission,
      label: t("permissionContactsLabel"),
      access: t("permissionContactsAccess"),
      action,
      confirmation: t("permissionContactsConfirmation"),
      risk: t("permissionContactsRisk"),
      enabledByDefault: false,
    };
  }

  if (permission.startsWith("crm")) {
    return {
      permission,
      label: t("permissionCrmLabel"),
      access: t("permissionCrmAccess"),
      action,
      confirmation: t("permissionCrmConfirmation"),
      risk: t("permissionCrmRisk"),
      enabledByDefault: false,
    };
  }

  if (permission.startsWith("outbound_messages")) {
    return {
      permission,
      label: t("permissionOutboundLabel"),
      access: t("permissionOutboundAccess"),
      action,
      confirmation: t("permissionOutboundConfirmation"),
      risk: t("permissionOutboundRisk"),
      enabledByDefault: true,
    };
  }

  return {
    permission,
    label: permissionLabel(permission),
    access: read ? t("permissionReadAccess") : t("permissionTaskAccess"),
    action,
    confirmation: humanConfirmation
      ? t("permissionHumanConfirmation")
      : disabled
        ? t("permissionDisabledConfirmation")
        : t("permissionNoExtraConfirmation"),
    risk: write ? t("permissionWriteRisk") : t("permissionReadRisk"),
    enabledByDefault: !disabled && action !== "Sensitive action",
  };
}

function defaultPlanForPricing(pricing: string): CheckoutPlanId {
  return pricingTone(pricing) === "Pro" ? "pro" : "free";
}

const TOOL_RISK_RANK: Record<EmployeeToolCapability["risk_tier"], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

function operationCopy(
  operation: EmployeeToolCapability["operation"],
  t: HireTranslator
) {
  const keys: Record<EmployeeToolCapability["operation"], HireMessageKey> = {
    read: "operationRead",
    write: "operationWrite",
    send: "operationSend",
    execute: "operationExecute",
  };
  return t(keys[operation]);
}

function formatList(items: string[], locale = "en") {
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(items);
}

type PermissionAreaKey =
  "tools" | "files" | "browser" | "network" | "budget" | "approval";

type PermissionArea = {
  key: PermissionAreaKey;
  label: string;
  required: string[];
  optional: string[];
  unavailable: string[];
};

type DoctorStatus = "pending" | "progress" | "pass" | "fail";

export type DoctorCheck = {
  id:
    | "contract"
    | "runtime"
    | "tools"
    | "files"
    | "network"
    | "budget"
    | "approval"
    | "evidence";
  name: string;
  status: DoctorStatus;
  detail: string;
  action: string;
};

export type TrialSummary = {
  task: string;
  evidence: string[];
  artifacts: string[];
  cost: string;
  duration: string;
  approval: string;
};

function capabilityTitle(capability: EmployeeToolCapability) {
  return `${capability.capability} - ${capability.description}`;
}

function addAreaItem(
  areas: Record<PermissionAreaKey, PermissionArea>,
  key: PermissionAreaKey,
  capability: EmployeeToolCapability,
  selected: boolean,
  t: HireTranslator
) {
  const item = capabilityTitle(capability);
  if (capability.necessity === "disabled") {
    areas[key].unavailable.push(item);
    return;
  }
  if (capability.necessity === "required") {
    areas[key].required.push(item);
    return;
  }
  areas[key].optional.push(
    `${selected ? t("capabilityEnabled") : t("capabilityOff")}: ${item}`
  );
}

export function buildPermissionAreas(
  capabilities: EmployeeToolCapability[],
  selectedCapabilityIds: string[],
  planName: string,
  planPrice: string,
  t: HireTranslator = defaultHireT
): PermissionArea[] {
  const selected = new Set(selectedCapabilityIds);
  const areas: Record<PermissionAreaKey, PermissionArea> = {
    tools: {
      key: "tools",
      label: t("areaTools"),
      required: [],
      optional: [],
      unavailable: [],
    },
    files: {
      key: "files",
      label: t("areaFiles"),
      required: [],
      optional: [],
      unavailable: [],
    },
    browser: {
      key: "browser",
      label: t("areaBrowser"),
      required: [],
      optional: [],
      unavailable: [],
    },
    network: {
      key: "network",
      label: t("areaNetwork"),
      required: [],
      optional: [],
      unavailable: [],
    },
    budget: {
      key: "budget",
      label: t("areaBudget"),
      required: [t("budgetPackageSelected", { planName, planPrice })],
      optional: [],
      unavailable: [],
    },
    approval: {
      key: "approval",
      label: t("areaApproval"),
      required: [t("approvalRequired")],
      optional: [],
      unavailable: [],
    },
  };

  for (const capability of capabilities) {
    const selectedForHire =
      capability.necessity === "required" ||
      (isToolCapabilitySelectable(capability) &&
        selected.has(capability.capability));
    addAreaItem(areas, "tools", capability, selectedForHire, t);

    if (
      /(^|\.)(files?|repo|document|artifact)(\.|$)/.test(capability.capability)
    ) {
      addAreaItem(areas, "files", capability, selectedForHire, t);
    }
    if (
      capability.capability.includes("browser") ||
      capability.capability.includes("render")
    ) {
      addAreaItem(areas, "browser", capability, selectedForHire, t);
    }
    if (
      capability.capability.includes("web.") ||
      capability.capability.includes("source.") ||
      capability.capability.includes("places.") ||
      capability.provider_bindings.length > 0 ||
      capability.side_effects.length > 0
    ) {
      addAreaItem(areas, "network", capability, selectedForHire, t);
    }

    if (capability.limits) {
      const limits = [
        capability.limits.max_calls_per_task
          ? t("limitCallsPerTask", {
              count: capability.limits.max_calls_per_task,
            })
          : null,
        capability.limits.timeout_ms
          ? t("limitTimeout", { ms: capability.limits.timeout_ms })
          : null,
      ].filter((value): value is string => value !== null);
      areas.budget[
        capability.necessity === "required" ? "required" : "optional"
      ].push(`${capability.capability}: ${limits.join(", ")}`);
    } else if (selectedForHire && capability.timeout_ms) {
      areas.budget.optional.push(
        t("runtimeTimeout", {
          capability: capability.capability,
          ms: capability.timeout_ms,
        })
      );
    }

    if (
      capability.permission === "requires_authorization" ||
      capability.approval === "always" ||
      capability.approval === "when_needed"
    ) {
      addAreaItem(areas, "approval", capability, selectedForHire, t);
    }
  }

  return Object.values(areas);
}

function selectedCapabilities(
  capabilities: EmployeeToolCapability[],
  selectedCapabilityIds: string[]
) {
  const granted = new Set(
    toolCapabilitiesForHire(capabilities, selectedCapabilityIds)
  );
  return capabilities.filter(capability => granted.has(capability.capability));
}

function checkStatus(started: boolean, passed: boolean): DoctorStatus {
  if (!started) return "pending";
  return passed ? "pass" : "fail";
}

export function buildDoctorChecks({
  employee,
  selectedCapabilityIds,
  doctorStarted,
  planName,
  t = defaultHireT,
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  selectedCapabilityIds: string[];
  doctorStarted: boolean;
  planName: string;
  t?: HireTranslator;
}): DoctorCheck[] {
  const selected = selectedCapabilities(
    employee.tool_capabilities,
    selectedCapabilityIds
  );
  const blockedSelected = selected.filter(capability =>
    ["adapter_required", "policy_disabled"].includes(capability.availability)
  );
  const missingRequiredScope = selected.filter(
    capability =>
      capability.necessity === "required" &&
      /(^|\.)(files?|repo|document)(\.|$)/.test(capability.capability) &&
      capability.operation !== "read" &&
      capability.scopes.length === 0
  );
  const networkSelected = selected.filter(
    capability =>
      capability.capability.includes("web.") ||
      capability.capability.includes("source.") ||
      capability.provider_bindings.length > 0
  );
  const riskyWithoutApproval = selected.filter(
    capability =>
      ["P3", "P4"].includes(capability.risk_tier) &&
      capability.permission !== "requires_authorization" &&
      capability.approval !== "always" &&
      capability.operation !== "read"
  );
  const hasEvidence =
    selected.some(capability =>
      ["evidence.create", "artifact.report"].includes(capability.capability)
    ) || employee.examples.outputs.length > 0;
  const packageValid = employee.evidence_state.package_status !== "invalid";
  const runtimeKnown = employee.lifecycle.hireable && Boolean(employee.version);
  const budgetBounded = Boolean(planName) && selected.length > 0;

  const checks: DoctorCheck[] = [
    {
      id: "contract",
      name: t("doctorContractName"),
      status: checkStatus(doctorStarted, packageValid),
      detail: packageValid
        ? t("doctorContractPass", {
            employeeName: employee.name,
            version: employee.version,
          })
        : t("doctorContractFail"),
      action: packageValid
        ? t("doctorContractPassAction")
        : t("doctorContractFailAction"),
    },
    {
      id: "runtime",
      name: t("doctorRuntimeName"),
      status: checkStatus(doctorStarted, runtimeKnown),
      detail: runtimeKnown
        ? t("doctorRuntimePass", {
            trialPeriod: employee.lifecycle.trial_period,
          })
        : t("doctorRuntimeFail"),
      action: runtimeKnown
        ? t("doctorContractPassAction")
        : t("doctorRuntimeFailAction"),
    },
    {
      id: "tools",
      name: t("doctorToolsName"),
      status: checkStatus(doctorStarted, blockedSelected.length === 0),
      detail:
        blockedSelected.length === 0
          ? t("doctorToolsPass", { count: selected.length })
          : t("doctorToolsFail", {
              count: blockedSelected.length,
              capabilityWord:
                blockedSelected.length === 1
                  ? t("capabilityWordSingular")
                  : t("capabilityWordPlural"),
              needWord:
                blockedSelected.length === 1
                  ? t("needsSingular")
                  : t("needsPlural"),
              capabilities: blockedSelected
                .map(capability => capability.capability)
                .join(", "),
            }),
      action:
        blockedSelected.length === 0
          ? t("doctorContractPassAction")
          : t("doctorToolsFailAction"),
    },
    {
      id: "files",
      name: t("doctorFilesName"),
      status: checkStatus(doctorStarted, missingRequiredScope.length === 0),
      detail:
        missingRequiredScope.length === 0
          ? t("doctorFilesPass")
          : t("doctorFilesFail", {
              capabilities: missingRequiredScope
                .map(capability => capability.capability)
                .join(", "),
            }),
      action:
        missingRequiredScope.length === 0
          ? t("doctorContractPassAction")
          : t("doctorFilesFailAction"),
    },
    {
      id: "network",
      name: t("doctorNetworkName"),
      status: checkStatus(doctorStarted, networkSelected.length > 0),
      detail:
        networkSelected.length > 0
          ? t("doctorNetworkPass", {
              count: networkSelected.length,
              capabilityWord:
                networkSelected.length === 1
                  ? t("capabilityWordSingular")
                  : t("capabilityWordPlural"),
              beWord:
                networkSelected.length === 1 ? t("beSingular") : t("bePlural"),
            })
          : t("doctorNetworkFail"),
      action:
        networkSelected.length > 0
          ? t("doctorContractPassAction")
          : t("doctorNetworkFailAction"),
    },
    {
      id: "budget",
      name: t("doctorBudgetName"),
      status: checkStatus(doctorStarted, budgetBounded),
      detail: t("doctorBudgetDetail", {
        planName,
        trialPeriod: employee.lifecycle.trial_period,
      }),
      action: budgetBounded
        ? t("doctorContractPassAction")
        : t("doctorBudgetFailAction"),
    },
    {
      id: "approval",
      name: t("doctorApprovalName"),
      status: checkStatus(doctorStarted, riskyWithoutApproval.length === 0),
      detail:
        riskyWithoutApproval.length === 0
          ? t("doctorApprovalPass")
          : t("doctorApprovalFail", {
              capabilities: riskyWithoutApproval
                .map(capability => capability.capability)
                .join(", "),
            }),
      action:
        riskyWithoutApproval.length === 0
          ? t("doctorContractPassAction")
          : t("doctorApprovalFailAction"),
    },
    {
      id: "evidence",
      name: t("doctorEvidenceName"),
      status: checkStatus(doctorStarted, hasEvidence),
      detail: hasEvidence ? t("doctorEvidencePass") : t("doctorEvidenceFail"),
      action: hasEvidence
        ? t("doctorContractPassAction")
        : t("doctorEvidenceFailAction"),
    },
  ];

  if (!doctorStarted) {
    return checks.map((check, index) => ({
      ...check,
      status: index === 0 ? "progress" : "pending",
      detail: index === 0 ? t("doctorReadyDetail") : check.detail,
    }));
  }

  return checks;
}

export function doctorPassed(checks: DoctorCheck[]) {
  return checks.every(check => check.status === "pass");
}

export function buildTrialSummary({
  employee,
  selectedCapabilityIds,
  planName,
  planPrice,
  accepted,
  t = defaultHireT,
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  selectedCapabilityIds: string[];
  planName: string;
  planPrice: string;
  accepted: boolean;
  t?: HireTranslator;
}): TrialSummary {
  const selected = selectedCapabilities(
    employee.tool_capabilities,
    selectedCapabilityIds
  );
  const evidenceCapabilities = selected.filter(capability =>
    ["source.verify", "evidence.create", "web.search", "web.fetch"].includes(
      capability.capability
    )
  );
  const artifactCapabilities = selected.filter(
    capability =>
      capability.capability.includes("artifact") ||
      capability.capability.includes("report")
  );
  return {
    task: employee.demo_tasks[0] ?? employee.first_task,
    evidence:
      evidenceCapabilities.length > 0
        ? evidenceCapabilities.map(capability =>
            t("trialEvidenceDeclared", {
              capability: capability.capability,
            })
          )
        : [t("trialEvidenceDemo")],
    artifacts:
      artifactCapabilities.length > 0
        ? artifactCapabilities.map(capability =>
            t("trialArtifactDeclared", {
              capability: capability.capability,
            })
          )
        : employee.examples.outputs.slice(0, 2),
    cost: t("trialCost", { planName, planPrice }),
    duration: t("trialDuration", {
      trialPeriod: employee.lifecycle.trial_period,
    }),
    approval: accepted ? t("trialApprovalAccepted") : t("trialApprovalWaiting"),
  };
}

function summarizeToolContract(
  capabilities: EmployeeToolCapability[],
  selectedCapabilityIds: string[],
  roleBoundary?: string,
  t: HireTranslator = defaultHireT,
  locale = "en"
) {
  const granted = new Set(
    toolCapabilitiesForHire(capabilities, selectedCapabilityIds)
  );
  const selected = capabilities.filter(capability =>
    granted.has(capability.capability)
  );
  const requiredCount = selected.filter(
    capability => capability.necessity === "required"
  ).length;
  const scopedCount = selected.filter(
    capability => capability.scopes.length > 0
  ).length;
  const optionalOffCount = capabilities.filter(
    capability =>
      capability.necessity === "non_default" &&
      !granted.has(capability.capability)
  ).length;
  const conditionalOffCount = capabilities.filter(
    capability =>
      capability.necessity === "conditional" &&
      !granted.has(capability.capability)
  ).length;
  const operations = [
    ...new Set(selected.map(capability => capability.operation)),
  ].map(operation => operationCopy(operation, t));
  const authorizationCount = selected.filter(
    capability => capability.permission === "requires_authorization"
  ).length;
  const adapterCount = selected.filter(
    capability => capability.availability === "adapter_required"
  ).length;
  const disabledCount = capabilities.filter(
    capability => capability.necessity === "disabled"
  ).length;
  const highestRisk = selected.reduce<EmployeeToolCapability["risk_tier"]>(
    (highest, capability) =>
      TOOL_RISK_RANK[capability.risk_tier] > TOOL_RISK_RANK[highest]
        ? capability.risk_tier
        : highest,
    "P0"
  );
  const sideEffects = [
    ...new Set(selected.flatMap(capability => capability.side_effects)),
  ];

  const offCopy = [
    optionalOffCount > 0
      ? t(
          optionalOffCount === 1
            ? "optionalCapabilityRemains"
            : "optionalCapabilitiesRemain",
          { count: optionalOffCount }
        )
      : null,
    conditionalOffCount > 0
      ? t(
          conditionalOffCount === 1
            ? "conditionalCapabilityOff"
            : "conditionalCapabilitiesOff",
          { count: conditionalOffCount }
        )
      : null,
  ].filter((value): value is string => value !== null);
  const scopeSentence =
    scopedCount > 0
      ? t(scopedCount === 1 ? "capabilityHasScope" : "capabilitiesHaveScope", {
          count: scopedCount,
        })
      : t("accessWithinScope");
  const offSentence =
    offCopy.length > 0 ? ` ${formatList(offCopy, locale)}.` : "";
  const authorizationSentence =
    authorizationCount > 0
      ? t(
          authorizationCount === 1
            ? "authorizationCapabilityPauses"
            : "authorizationCapabilitiesPause",
          { count: authorizationCount }
        )
      : t("noCallTimeAuthorization");
  const adapterSentence =
    adapterCount > 0
      ? t(
          adapterCount === 1
            ? "adapterCapabilityDepends"
            : "adapterCapabilitiesDepend",
          { count: adapterCount }
        )
      : t("noProviderAdapter");
  const sideEffect =
    sideEffects.length > 0 ? sideEffects[0] : t("noExternalSideEffects");
  const extraSideEffects =
    sideEffects.length > 1
      ? ` ${t(
          sideEffects.length === 2
            ? "additionalSideEffect"
            : "additionalSideEffects",
          { count: sideEffects.length - 1 }
        )}`
      : "";
  const disabledSentence = t(
    disabledCount === 1
      ? "policyDisabledCapabilityRemains"
      : "policyDisabledCapabilitiesRemain",
    { count: disabledCount }
  );
  const roleBoundarySentence = roleBoundary
    ? ` ${t("roleBoundary", { roleBoundary })}`
    : "";

  return {
    access: t("overviewAccess", {
      selectedCount: selected.length,
      capabilityWord:
        selected.length === 1
          ? t("capabilityWordSingular")
          : t("capabilityWordPlural"),
      requiredCount,
      scopeSentence,
      offSentence,
    }),
    actions: t("overviewActions", {
      operations: formatList(operations, locale),
      authorizationSentence,
      adapterSentence,
    }),
    risk: t("overviewRisk", {
      highestRisk,
      sideEffect,
      extraSideEffects,
      disabledSentence,
      roleBoundarySentence,
    }),
  };
}

function NotFound() {
  const t = useMessages(hireMessages);
  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Badge
          className="border-white/10 bg-white/[0.04] text-crew-muted"
          variant="outline"
        >
          {t("notFoundBadge")}
        </Badge>
        <h1 className="mt-5 text-3xl font-light">{t("notFoundTitle")}</h1>
        <p className="mt-4 text-sm leading-6 text-crew-body">
          {t("notFoundBody")}
        </p>
        <Button asChild className="mt-6 rounded-[8px]">
          <Link to="/marketplace">{t("backToMarketplace")}</Link>
        </Button>
      </section>
    </main>
  );
}

function LegacyPermissionContext({
  summary,
  t,
}: {
  summary: PermissionSummary;
  t: HireTranslator;
}) {
  return (
    <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all font-mono text-sm text-crew-heading">
          {summary.permission}
        </code>
        <Badge
          className="border-white/10 bg-white/[0.04] text-crew-muted"
          variant="outline"
        >
          {t("legacyContext")}
        </Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-crew-body">
        {summary.label}: {summary.access}
      </p>
      <p className="mt-2 text-xs leading-5 text-crew-muted">
        {t("legacyContextDetail")}
      </p>
    </article>
  );
}

const AREA_ICONS: Record<PermissionAreaKey, LucideIcon> = {
  tools: ShieldCheck,
  files: FileText,
  browser: Globe2,
  network: Network,
  budget: WalletCards,
  approval: UserCheck,
};

const DOCTOR_STATUS_COPY: Record<
  DoctorStatus,
  { labelKey: HireMessageKey; className: string; Icon: LucideIcon }
> = {
  pending: {
    labelKey: "statusWaiting",
    className: "border-white/10 bg-white/[0.025] text-crew-muted",
    Icon: Clock3,
  },
  progress: {
    labelKey: "statusProgress",
    className: "border-crew-copper/40 bg-crew-copper/12 text-crew-copper",
    Icon: Hourglass,
  },
  pass: {
    labelKey: "statusPass",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    Icon: CheckCircle2,
  },
  fail: {
    labelKey: "statusActionNeeded",
    className: "border-red-400/30 bg-red-400/10 text-red-200",
    Icon: XCircle,
  },
};

function ContractSection({
  employee,
  planName,
  planPrice,
  t,
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  planName: string;
  planPrice: string;
  t: HireTranslator;
}) {
  const expectations = [
    t("expectationRole", { role: employee.role }),
    t("expectationRuntimePackage", {
      employeeId: employee.employee_id,
      version: employee.version,
    }),
    t("expectationCost", { planName, planPrice }),
    t("expectationTrial", { trialPeriod: employee.lifecycle.trial_period }),
    t("expectationProof", { proof: employeeEvidenceText(employee, t) }),
  ];
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              {t("contractTitle")}
            </CardTitle>
            <p className="mt-2 text-sm leading-6 text-crew-body">
              {t("contractBody")}
            </p>
          </div>
          <Badge
            className="border-white/10 bg-white/[0.04] text-crew-muted"
            variant="outline"
          >
            {t("contractStage")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="text-sm font-semibold text-crew-heading">
            {t("deliverables")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
            {employee.examples.outputs.slice(0, 4).map(item => (
              <li className="flex gap-2" key={item}>
                <ReceiptText className="mt-1 size-4 shrink-0 text-crew-copper" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-crew-heading">
            {t("expectations")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
            {expectations.map(item => (
              <li className="flex gap-2" key={item}>
                <ClipboardCheck className="mt-1 size-4 shrink-0 text-crew-copper" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function employeeEvidenceText(
  employee: NonNullable<ReturnType<typeof getEmployee>>,
  t: HireTranslator = defaultHireT
) {
  if (employee.certified_evaluation?.mock === false) {
    return t("evidenceCertified", {
      certification: employee.certification,
      source: employee.certified_evaluation.source,
    });
  }
  if (employee.evidence_state.package_status === "validated") {
    return t("evidenceValidated");
  }
  return t("evidenceIncomplete");
}

function PermissionAreaCard({
  area,
  t,
}: {
  area: PermissionArea;
  t: HireTranslator;
}) {
  const Icon = AREA_ICONS[area.key];
  return (
    <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-crew-copper" />
        <h3 className="text-sm font-semibold text-crew-heading">
          {area.label}
        </h3>
      </div>
      <div className="mt-4 grid gap-4 text-xs leading-5 text-crew-body sm:grid-cols-2">
        <div>
          <p className="font-mono uppercase tracking-[0.16em] text-crew-muted">
            {t("required")}
          </p>
          <ul className="mt-2 space-y-2">
            {(area.required.length > 0
              ? area.required
              : [t("noRequiredAccess")]
            ).map(item => (
              <li className="break-words" key={`required:${item}`}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono uppercase tracking-[0.16em] text-crew-muted">
            {t("optional")}
          </p>
          <ul className="mt-2 space-y-2">
            {(area.optional.length > 0
              ? area.optional
              : [t("noOptionalAccess")]
            ).map(item => (
              <li className="break-words" key={`optional:${item}`}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {area.unavailable.length > 0 ? (
        <div className="mt-4 rounded-[8px] border border-white/10 bg-black/10 p-3 text-xs leading-5 text-crew-muted">
          <p className="font-mono uppercase tracking-[0.16em]">
            {t("policyDisabled")}
          </p>
          <ul className="mt-2 space-y-1">
            {area.unavailable.map(item => (
              <li className="break-words" key={`unavailable:${item}`}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function DoctorSection({
  checks,
  doctorStarted,
  doctorSuccess,
  onRun,
  t,
}: {
  checks: DoctorCheck[];
  doctorStarted: boolean;
  doctorSuccess: boolean;
  onRun: () => void;
  t: HireTranslator;
}) {
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              {t("doctorTitle")}
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-crew-body">
              {t("doctorBody")}
            </p>
          </div>
          <Button
            className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            onClick={onRun}
            type="button"
          >
            <Play className="size-4" />
            {doctorStarted ? t("rerunDoctor") : t("runDoctor")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["progress", "pass", "fail"] as const).map(status => {
            const copy = DOCTOR_STATUS_COPY[status];
            return (
              <Badge className={copy.className} key={status} variant="outline">
                {t(copy.labelKey)}
              </Badge>
            );
          })}
        </div>
        <ol className="grid gap-3 lg:grid-cols-2">
          {checks.map(check => {
            const copy = DOCTOR_STATUS_COPY[check.status];
            const Icon = copy.Icon;
            return (
              <li
                className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
                key={check.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Icon
                    aria-hidden="true"
                    className="size-4 text-crew-copper"
                  />
                  <h3 className="text-sm font-semibold text-crew-heading">
                    {check.name}
                  </h3>
                  <Badge className={copy.className} variant="outline">
                    {t(copy.labelKey)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-crew-body">
                  {check.detail}
                </p>
                <p
                  className={cn(
                    "mt-2 text-xs leading-5",
                    check.status === "fail" ? "text-red-200" : "text-crew-muted"
                  )}
                >
                  {check.action}
                </p>
              </li>
            );
          })}
        </ol>
        {doctorStarted ? (
          <Alert
            className={cn(
              "mt-5 rounded-[8px] text-crew-heading",
              doctorSuccess
                ? "border-emerald-400/25 bg-emerald-400/10"
                : "border-red-400/25 bg-red-400/10"
            )}
          >
            {doctorSuccess ? (
              <CheckCircle2 className="size-4 text-emerald-200" />
            ) : (
              <XCircle className="size-4 text-red-200" />
            )}
            <AlertTitle>
              {doctorSuccess ? t("doctorPassedTitle") : t("doctorFailedTitle")}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {doctorSuccess ? t("doctorPassedBody") : t("doctorFailedBody")}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrialSection({
  summary,
  doctorSuccess,
  trialStarted,
  trialAccepted,
  onRunTrial,
  onAcceptTrial,
  t,
}: {
  summary: TrialSummary;
  doctorSuccess: boolean;
  trialStarted: boolean;
  trialAccepted: boolean;
  onRunTrial: () => void;
  onAcceptTrial: () => void;
  t: HireTranslator;
}) {
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              {t("trialTitle")}
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-crew-body">
              {t("trialBody")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              disabled={!doctorSuccess || trialStarted}
              onClick={onRunTrial}
              type="button"
            >
              {trialStarted ? t("trialSummarized") : t("runBoundedTrial")}
            </Button>
            <Button
              className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
              disabled={!trialStarted || trialAccepted}
              onClick={onAcceptTrial}
              type="button"
              variant="outline"
            >
              {trialAccepted ? t("trialAccepted") : t("acceptTrial")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">
              {t("task")}
            </h3>
            <p className="mt-2 text-sm leading-6 text-crew-body">
              {summary.task}
            </p>
          </article>
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">
              {t("costAndDuration")}
            </h3>
            <p className="mt-2 text-sm leading-6 text-crew-body">
              {summary.cost}
            </p>
            <p className="mt-1 text-sm leading-6 text-crew-body">
              {summary.duration}
            </p>
          </article>
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">
              {t("evidence")}
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-crew-body">
              {summary.evidence.map(item => (
                <li className="break-words" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </article>
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">
              {t("artifactsAndApproval")}
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-crew-body">
              {summary.artifacts.map(item => (
                <li className="break-words" key={item}>
                  {item}
                </li>
              ))}
            </ul>
            <p
              className={cn(
                "mt-3 text-sm leading-6",
                trialAccepted ? "text-emerald-200" : "text-crew-muted"
              )}
            >
              {summary.approval}
            </p>
          </article>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HireConfirm() {
  const t = useMessages(hireMessages);
  const { locale } = useI18n();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const rawEmployee = id ? getEmployee(id) : undefined;
  const employee = rawEmployee
    ? localizeEmployeeContent(rawEmployee, locale)
    : undefined;
  const team = useTeam();
  const permissionSummaries = useMemo(
    () =>
      employee?.permissions.map(permission =>
        summarizePermission(permission, t)
      ) ?? [],
    [employee, t]
  );
  const defaultToolCapabilities = useMemo(
    () =>
      employee?.tool_capabilities
        .filter(isToolCapabilityEnabledByDefault)
        .map(capability => capability.capability) ?? [],
    [employee]
  );
  const [toolCapabilities, setToolCapabilities] = useState<string[]>(
    defaultToolCapabilities
  );
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlanId>(
    employee ? defaultPlanForPricing(employee.pricing) : "free"
  );
  const [mockCheckoutConfirmed, setMockCheckoutConfirmed] = useState(false);
  const [handoffPrepared, setHandoffPrepared] = useState(false);
  const [doctorStarted, setDoctorStarted] = useState(false);
  const [trialStarted, setTrialStarted] = useState(false);
  const [trialAccepted, setTrialAccepted] = useState(false);
  const [localHireState, setLocalHireState] = useState<
    "idle" | "loading" | "hired" | "error"
  >("idle");
  const [localHireMessage, setLocalHireMessage] = useState<string | null>(null);

  // Reset the hire flow when the employee changes. This uses React's render-time
  // previous-key comparison pattern instead of setState-in-effect, which would
  // render one stale frame and trigger cascading render warnings.
  const [prevEmployeeId, setPrevEmployeeId] = useState(employee?.employee_id);
  if (employee?.employee_id !== prevEmployeeId) {
    setPrevEmployeeId(employee?.employee_id);
    setToolCapabilities(defaultToolCapabilities);
    setSelectedPlan(
      employee ? defaultPlanForPricing(employee.pricing) : "free"
    );
    setMockCheckoutConfirmed(false);
    setHandoffPrepared(false);
    setDoctorStarted(false);
    setTrialStarted(false);
    setTrialAccepted(false);
    setLocalHireState("idle");
    setLocalHireMessage(null);
  }

  useEffect(() => {
    if (!employee) return;

    track("permission_viewed", {
      employee_id: employee.employee_id,
      employee_name: employee.name,
      legacy_context_count: employee.permissions.length,
      tool_capability_count: employee.tool_capabilities.length,
    });
  }, [employee]);

  if (!employee) return <NotFound />;

  const handoffIntent = {
    source: searchParams.get("source") ?? "direct",
    task: searchParams.get("task") ?? employee.first_task,
    budget: searchParams.get("budget") ?? employee.pricing,
    runtime: searchParams.get("runtime") ?? "crewclaw.runtime",
    requested_access: (searchParams.get("access") ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
  };
  const localizedCheckoutPlans = CHECKOUT_PLANS.map(plan => ({
    ...plan,
    name: plan.id === "pro" ? t("planProName") : t("planFreeName"),
    cadence: plan.id === "pro" ? t("planProCadence") : t("planFreeCadence"),
    description:
      plan.id === "pro" ? t("planProDescription") : t("planFreeDescription"),
    bullets:
      plan.id === "pro"
        ? [
            t("planProBulletMock"),
            t("planProBulletNoCard"),
            t("planProBulletSameLocal"),
          ]
        : [
            t("planFreeBulletNoPayment"),
            t("planFreeBulletLocalRecord"),
            t("planFreeBulletManualReview"),
          ],
  }));
  const localizedCheckoutPlan =
    localizedCheckoutPlans.find(plan => plan.id === selectedPlan) ??
    localizedCheckoutPlans[0];
  const toolContractOverview = summarizeToolContract(
    employee.tool_capabilities,
    toolCapabilities,
    employee.safety_notes[0] ?? employee.limitations[0],
    t,
    locale
  );
  const permissionAreas = buildPermissionAreas(
    employee.tool_capabilities,
    toolCapabilities,
    localizedCheckoutPlan.name,
    localizedCheckoutPlan.price,
    t
  );
  const doctorChecks = buildDoctorChecks({
    employee,
    selectedCapabilityIds: toolCapabilities,
    doctorStarted,
    planName: localizedCheckoutPlan.name,
    t,
  });
  const doctorSuccess = doctorPassed(doctorChecks);
  const trialSummary = buildTrialSummary({
    employee,
    selectedCapabilityIds: toolCapabilities,
    planName: localizedCheckoutPlan.name,
    planPrice: localizedCheckoutPlan.price,
    accepted: trialAccepted,
    t,
  });
  const activationReady =
    mockCheckoutConfirmed && doctorSuccess && trialStarted && trialAccepted;

  const toggleToolCapability = (capabilityId: string) => {
    const capability = employee.tool_capabilities.find(
      candidate => candidate.capability === capabilityId
    );
    if (!capability || !isToolCapabilitySelectable(capability)) return;
    setToolCapabilities(current =>
      current.includes(capabilityId)
        ? current.filter(item => item !== capabilityId)
        : [...current, capabilityId]
    );
    setDoctorStarted(false);
    setTrialStarted(false);
    setTrialAccepted(false);
  };

  if (handoffPrepared) {
    const grantedToolCapabilities = toolCapabilitiesForHire(
      employee.tool_capabilities,
      toolCapabilities
    );
    const grantedCapabilityTokens = capabilityGrantTokensForHire(
      employee.tool_capabilities,
      toolCapabilities
    );
    const localHired =
      localHireState === "hired" || team.isHired(employee.employee_id);
    return (
      <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
        <section className="mx-auto max-w-3xl">
          <Badge
            className={
              localHired
                ? "border-emerald-400/40 bg-emerald-400/12 text-emerald-300"
                : "border-crew-copper/40 bg-crew-copper/12 text-crew-copper"
            }
          >
            {localHired ? t("hiredBadge") : t("readyBadge")}
          </Badge>
          <h1 className="mt-5 text-4xl font-light leading-tight md:text-5xl">
            {localHired
              ? t("hiredTitle", { employeeName: employee.name })
              : t("readyTitle")}
          </h1>
          <p className="mt-4 text-base leading-7 text-crew-body">
            {localHired
              ? t("hiredBody")
              : t("readyBody", {
                  employeeName: employee.name,
                  planName: localizedCheckoutPlan.name,
                })}
          </p>
          {!localHired && (
            <div className="mt-6 rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ec9552]">
                {t("optionThisMachine")}
              </p>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                {t("thisMachineBody")}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                  disabled={localHireState === "loading"}
                  onClick={async () => {
                    setLocalHireState("loading");
                    setLocalHireMessage(null);
                    const result = await team.hire(
                      employee.employee_id,
                      grantedCapabilityTokens
                    );
                    if (result.ok) {
                      setLocalHireState("hired");
                      setLocalHireMessage(result.message);
                      track("hire_local_api_succeeded", {
                        employee_id: employee.employee_id,
                        employee_name: employee.name,
                        tool_capability_count: grantedToolCapabilities.length,
                      });
                    } else {
                      setLocalHireState("error");
                      setLocalHireMessage(result.message);
                      track("hire_local_api_failed", {
                        employee_id: employee.employee_id,
                        employee_name: employee.name,
                        message: result.message,
                      });
                    }
                  }}
                >
                  {localHireState === "loading"
                    ? t("hiringOnThisMachine")
                    : t("hireOnThisMachine")}
                </Button>
                {localHireMessage && (
                  <p
                    className={
                      localHireState === "error"
                        ? "text-sm text-red-300"
                        : "text-sm text-crew-muted"
                    }
                  >
                    {localHireMessage}
                  </p>
                )}
              </div>
            </div>
          )}
          {localHired && localHireMessage && (
            <p className="mt-4 text-sm leading-6 text-emerald-300">
              {localHireMessage}
            </p>
          )}
          <HireCliHandoff
            slug={employee.employee_id}
            capabilities={grantedToolCapabilities}
            intent={handoffIntent}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link
                to={localHired ? "/team" : `/employee/${employee.employee_id}`}
              >
                {localHired ? t("openTeam") : t("backToResume")}
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
              variant="outline"
            >
              <Link to="/marketplace">{t("keepBrowsing")}</Link>
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-5xl">
        <Button
          asChild
          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
          variant="outline"
        >
          <Link to={`/employee/${employee.employee_id}`}>
            <ArrowLeft className="size-4" />
            {t("backToResume")}
          </Link>
        </Button>

        <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              {t("hireConfirmation")}
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-5xl">
              {t("reviewTitle", { employeeName: employee.name })}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              {t("reviewBody")}
            </p>
          </div>

          <Card className="h-fit rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("websiteStoresTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-crew-body">
              <div className="flex gap-3">
                <Undo2 className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>{t("websiteStoresSelection")}</p>
              </div>
              <div className="flex gap-3">
                <KeyRound className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>{t("websiteStoresCli")}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-crew-copper/25 bg-crew-copper/[0.06] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("handoffTitle")}
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              {t("handoffBody")}
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("intendedTask")}
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.task}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("budgetRuntime")}
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.budget} · {handoffIntent.runtime}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("requestedAccess")}
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.requested_access.length > 0
                    ? handoffIntent.requested_access.join(", ")
                    : t("noMarketplaceAccess")}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  {t("choosePackage")}
                </CardTitle>
                <p className="mt-2 text-sm leading-6 text-crew-body">
                  {t("choosePackageBody")}
                </p>
              </div>
              <PricingBadge pricing={employee.pricing} />
            </div>
          </CardHeader>
          <CardContent>
            <RadioGroup
              className="grid gap-4 md:grid-cols-2"
              onValueChange={plan => {
                const nextPlan = plan as CheckoutPlanId;
                setSelectedPlan(nextPlan);
                setMockCheckoutConfirmed(false);
                setDoctorStarted(false);
                setTrialStarted(false);
                setTrialAccepted(false);
                track("hire_clicked", {
                  employee_id: employee.employee_id,
                  employee_name: employee.name,
                  source: "pricing_plan_selected",
                  checkout_plan: nextPlan,
                });
              }}
              value={selectedPlan}
            >
              {localizedCheckoutPlans.map(plan => (
                <label
                  className={cn(
                    "block cursor-pointer rounded-[8px] border p-4 transition-colors",
                    selectedPlan === plan.id
                      ? "border-crew-copper/45 bg-crew-copper/10"
                      : "border-white/10 bg-white/[0.025] hover:border-white/20"
                  )}
                  key={plan.id}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem
                      className="mt-1 border-white/25 text-crew-copper"
                      value={plan.id}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PricingPlanIcon plan={plan.id} />
                        <h2 className="text-base font-semibold text-crew-heading">
                          {plan.name}
                        </h2>
                      </div>
                      <div className="mt-3 flex flex-wrap items-baseline gap-2">
                        <span className="text-2xl font-semibold text-crew-heading">
                          {plan.price}
                        </span>
                        <span className="text-sm text-crew-muted">
                          {plan.cadence}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-crew-body">
                        {plan.description}
                      </p>
                      <div className="mt-4">
                        <PricingBulletList bullets={plan.bullets} />
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("checkoutTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                      {t("mockCheckout")}
                    </Badge>
                    <span className="text-sm text-crew-body">
                      {localizedCheckoutPlan.name} -{" "}
                      {localizedCheckoutPlan.price}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-crew-body">
                    {t("checkoutBody")}
                  </p>
                </div>
                <Button
                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                  disabled={mockCheckoutConfirmed}
                  onClick={() => {
                    setMockCheckoutConfirmed(true);
                    track("hire_confirmed", {
                      employee_id: employee.employee_id,
                      employee_name: employee.name,
                      step: "mock_checkout_confirmed",
                      checkout_plan: selectedPlan,
                      simulated_checkout: true,
                    });
                  }}
                  type="button"
                >
                  {mockCheckoutConfirmed
                    ? t("checkoutSimulated")
                    : t("confirmCheckout")}
                </Button>
              </div>
              {mockCheckoutConfirmed ? (
                <Alert className="mt-4 rounded-[8px] border-emerald-400/25 bg-emerald-400/10 text-crew-heading">
                  <CheckCircle2 className="size-4 text-emerald-200" />
                  <AlertTitle>{t("checkoutConfirmedTitle")}</AlertTitle>
                  <AlertDescription className="text-crew-body">
                    {t("checkoutConfirmedBody")}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <ContractSection
          employee={employee}
          planName={localizedCheckoutPlan.name}
          planPrice={localizedCheckoutPlan.price}
          t={t}
        />

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <ShieldCheck
                aria-hidden="true"
                className="size-5 text-crew-copper"
              />
              <h2 className="mt-4 text-sm font-semibold">{t("wantsAccess")}</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                {toolContractOverview.access}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <CircleAlert
                aria-hidden="true"
                className="size-5 text-crew-copper"
              />
              <h2 className="mt-4 text-sm font-semibold">{t("canDo")}</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                {toolContractOverview.actions}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <AlertTriangle
                aria-hidden="true"
                className="size-5 text-crew-copper"
              />
              <h2 className="mt-4 text-sm font-semibold">{t("mainRisk")}</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                {toolContractOverview.risk}
              </p>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("toolCapabilitiesTitle")}
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              {t("toolCapabilitiesBody")}
            </p>
          </CardHeader>
          <CardContent>
            <ToolCapabilityList
              capabilities={employee.tool_capabilities}
              enabledCapabilities={toolCapabilities}
              onToggle={capability =>
                toggleToolCapability(capability.capability)
              }
            />
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("requiredOptionalAccessTitle")}
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              {t("requiredOptionalAccessBody")}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {permissionAreas.map(area => (
              <PermissionAreaCard area={area} key={area.key} t={t} />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("legacyContextTitle")}
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              {t("legacyContextBody")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {permissionSummaries.map(summary => (
              <LegacyPermissionContext
                key={summary.permission}
                summary={summary}
                t={t}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {t("riskBoundaries")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-crew-body">
              {employee.limitations.concat(employee.safety_notes).map(item => (
                <li className="flex gap-3" key={item}>
                  <AlertTriangle className="mt-1 size-4 shrink-0 text-crew-copper" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <DoctorSection
          checks={doctorChecks}
          doctorStarted={doctorStarted}
          doctorSuccess={doctorSuccess}
          onRun={() => {
            setDoctorStarted(true);
            setTrialStarted(false);
            setTrialAccepted(false);
            track("hire_confirmed", {
              employee_id: employee.employee_id,
              employee_name: employee.name,
              checkout_plan: selectedPlan,
              step: "doctor_run",
            });
          }}
          t={t}
        />

        <TrialSection
          doctorSuccess={doctorSuccess}
          onAcceptTrial={() => {
            setTrialAccepted(true);
            track("hire_confirmed", {
              employee_id: employee.employee_id,
              employee_name: employee.name,
              checkout_plan: selectedPlan,
              step: "trial_accepted",
            });
          }}
          onRunTrial={() => {
            setTrialStarted(true);
            setTrialAccepted(false);
            track("hire_confirmed", {
              employee_id: employee.employee_id,
              employee_name: employee.name,
              checkout_plan: selectedPlan,
              step: "trial_run",
              simulated_trial: true,
            });
          }}
          summary={trialSummary}
          t={t}
          trialAccepted={trialAccepted}
          trialStarted={trialStarted}
        />

        <Separator className="mt-8 bg-white/10" />

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            className="rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze"
            disabled={!activationReady}
            onClick={() => {
              const grantedToolCapabilities = toolCapabilitiesForHire(
                employee.tool_capabilities,
                toolCapabilities
              );
              track("hire_confirmed", {
                employee_id: employee.employee_id,
                employee_name: employee.name,
                tool_capability_count: grantedToolCapabilities.length,
                tool_capabilities: grantedToolCapabilities,
                legacy_context_count: employee.permissions.length,
                checkout_plan: selectedPlan,
                simulated_checkout: true,
              });
              window.localStorage.setItem(
                HIRE_INTENT_STORAGE_KEY,
                JSON.stringify({
                  schema_version: "hire-intent/v1",
                  employee_id: employee.employee_id,
                  checkout_plan: selectedPlan,
                  capabilities: grantedToolCapabilities,
                  handoff: handoffIntent,
                  doctor_checks: doctorChecks.map(check => ({
                    id: check.id,
                    status: check.status,
                  })),
                  trial: trialSummary,
                  created_at: new Date().toISOString(),
                })
              );
              track("hire_handoff_prepared", {
                employee_id: employee.employee_id,
                employee_name: employee.name,
                tool_capability_count: grantedToolCapabilities.length,
                checkout_plan: selectedPlan,
              });
              setHandoffPrepared(true);
            }}
          >
            {activationReady ? t("activateLocalHire") : t("passDoctorFirst")}
          </Button>
          <Button
            asChild
            className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/marketplace">{t("keepBrowsing")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
