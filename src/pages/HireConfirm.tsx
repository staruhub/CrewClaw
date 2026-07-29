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

const HIRE_INTENT_STORAGE_KEY = "crewclaw.hire-intent.v1";

type PermissionSummary = {
  permission: string;
  label: string;
  access: string;
  action: PermissionRiskLevel;
  confirmation: string;
  risk: string;
  enabledByDefault: boolean;
};

function summarizePermission(permission: string): PermissionSummary {
  const disabled = permission.includes("disabled");
  const humanConfirmation = permission.includes("human_confirmation_required");
  const write = permission.includes(":write");
  const read = permission.includes(":read");
  const action = getPermissionLevel(permission);

  if (permission.startsWith("public_web")) {
    return {
      permission,
      label: "Public web research",
      access: "Public websites and open web search results.",
      action,
      confirmation:
        "No write action. User still reviews final recommendations.",
      risk: "Public sources can be outdated, incomplete, or misleading.",
      enabledByDefault: true,
    };
  }

  if (permission.startsWith("contacts")) {
    return {
      permission,
      label: "Contacts",
      access: "Private contact context only if you enable it later.",
      action,
      confirmation: "Disabled by default. Enable only when a task needs it.",
      risk: "Contact records may contain private or sensitive relationship data.",
      enabledByDefault: false,
    };
  }

  if (permission.startsWith("crm")) {
    return {
      permission,
      label: "CRM records",
      access:
        "CRM records and fields only after explicit future authorization.",
      action,
      confirmation: "Disabled for MVP onboarding.",
      risk: "Incorrect writes could pollute lead records or create follow-up mistakes.",
      enabledByDefault: false,
    };
  }

  if (permission.startsWith("outbound_messages")) {
    return {
      permission,
      label: "Outbound messages",
      access: "Drafts for emails, direct messages, or outreach copy.",
      action,
      confirmation: "Human confirmation is required before anything is sent.",
      risk: "Poorly reviewed outreach can damage trust or contact the wrong person.",
      enabledByDefault: true,
    };
  }

  return {
    permission,
    label: permissionLabel(permission),
    access: read
      ? "Requested read access for this task area."
      : "Requested task access.",
    action,
    confirmation: humanConfirmation
      ? "Human confirmation is required before the action completes."
      : disabled
        ? "Disabled by default. Enable only when needed."
        : "No extra confirmation beyond hiring this employee.",
    risk: write
      ? "Incorrect writes could change user data."
      : "Incorrect reads or outdated data could affect recommendations.",
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

const TOOL_OPERATION_COPY: Record<EmployeeToolCapability["operation"], string> =
  {
    read: "read access",
    write: "task-scoped writes",
    send: "external sends",
    execute: "bounded execution",
  };

const listFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

type PermissionAreaKey =
  | "tools"
  | "files"
  | "browser"
  | "network"
  | "budget"
  | "approval";

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
  selected: boolean
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
  areas[key].optional.push(`${selected ? "Enabled" : "Off"}: ${item}`);
}

export function buildPermissionAreas(
  capabilities: EmployeeToolCapability[],
  selectedCapabilityIds: string[],
  planName: string,
  planPrice: string
): PermissionArea[] {
  const selected = new Set(selectedCapabilityIds);
  const areas: Record<PermissionAreaKey, PermissionArea> = {
    tools: {
      key: "tools",
      label: "Tools",
      required: [],
      optional: [],
      unavailable: [],
    },
    files: {
      key: "files",
      label: "Files and workspace",
      required: [],
      optional: [],
      unavailable: [],
    },
    browser: {
      key: "browser",
      label: "Browser",
      required: [],
      optional: [],
      unavailable: [],
    },
    network: {
      key: "network",
      label: "Network",
      required: [],
      optional: [],
      unavailable: [],
    },
    budget: {
      key: "budget",
      label: "Budget",
      required: [
        `${planName} package selected (${planPrice}); prototype checkout records intent only.`,
      ],
      optional: [],
      unavailable: [],
    },
    approval: {
      key: "approval",
      label: "Human approval",
      required: [
        "Activation requires all Doctor checks to pass and a human-accepted bounded trial.",
      ],
      optional: [],
      unavailable: [],
    },
  };

  for (const capability of capabilities) {
    const selectedForHire =
      capability.necessity === "required" ||
      (isToolCapabilitySelectable(capability) &&
        selected.has(capability.capability));
    addAreaItem(areas, "tools", capability, selectedForHire);

    if (
      /(^|\.)(files?|repo|document|artifact)(\.|$)/.test(capability.capability)
    ) {
      addAreaItem(areas, "files", capability, selectedForHire);
    }
    if (
      capability.capability.includes("browser") ||
      capability.capability.includes("render")
    ) {
      addAreaItem(areas, "browser", capability, selectedForHire);
    }
    if (
      capability.capability.includes("web.") ||
      capability.capability.includes("source.") ||
      capability.capability.includes("places.") ||
      capability.provider_bindings.length > 0 ||
      capability.side_effects.length > 0
    ) {
      addAreaItem(areas, "network", capability, selectedForHire);
    }

    if (capability.limits) {
      const limits = [
        capability.limits.max_calls_per_task
          ? `${capability.limits.max_calls_per_task} calls/task`
          : null,
        capability.limits.timeout_ms
          ? `${capability.limits.timeout_ms} ms timeout`
          : null,
      ].filter((value): value is string => value !== null);
      areas.budget[
        capability.necessity === "required" ? "required" : "optional"
      ].push(`${capability.capability}: ${limits.join(", ")}`);
    } else if (selectedForHire && capability.timeout_ms) {
      areas.budget.optional.push(
        `${capability.capability}: runtime timeout ${capability.timeout_ms} ms`
      );
    }

    if (
      capability.permission === "requires_authorization" ||
      capability.approval === "always" ||
      capability.approval === "when_needed"
    ) {
      addAreaItem(areas, "approval", capability, selectedForHire);
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
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  selectedCapabilityIds: string[];
  doctorStarted: boolean;
  planName: string;
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
      name: "Contract manifest",
      status: checkStatus(doctorStarted, packageValid),
      detail: packageValid
        ? `${employee.name} has a registry-backed hire contract and version ${employee.version}.`
        : "The package is marked invalid by the registry projection.",
      action: packageValid
        ? "No action needed."
        : "Return to the marketplace and choose a validated employee package.",
    },
    {
      id: "runtime",
      name: "Runtime compatibility",
      status: checkStatus(doctorStarted, runtimeKnown),
      detail: runtimeKnown
        ? `${employee.lifecycle.trial_period} trial is available before activation.`
        : "This employee is not currently hireable in the registry projection.",
      action: runtimeKnown
        ? "No action needed."
        : "Use CLI validation or update the package metadata before hiring.",
    },
    {
      id: "tools",
      name: "Tool availability",
      status: checkStatus(doctorStarted, blockedSelected.length === 0),
      detail:
        blockedSelected.length === 0
          ? `${selected.length} selected capabilities avoid policy-disabled or unconfigured adapter paths.`
          : `${blockedSelected.length} selected capability ${blockedSelected.length === 1 ? "needs" : "need"} configuration: ${blockedSelected.map(capability => capability.capability).join(", ")}.`,
      action:
        blockedSelected.length === 0
          ? "No action needed."
          : "Turn off optional adapter capabilities here, or configure the provider before activating.",
    },
    {
      id: "files",
      name: "File and workspace scope",
      status: checkStatus(doctorStarted, missingRequiredScope.length === 0),
      detail:
        missingRequiredScope.length === 0
          ? "Required workspace capabilities are read-only or declare a task scope."
          : `${missingRequiredScope.map(capability => capability.capability).join(", ")} lacks an explicit write scope.`,
      action:
        missingRequiredScope.length === 0
          ? "No action needed."
          : "Add a scope to the employee spec before enabling write access.",
    },
    {
      id: "network",
      name: "Browser and network preflight",
      status: checkStatus(doctorStarted, networkSelected.length > 0),
      detail:
        networkSelected.length > 0
          ? `${networkSelected.length} selected network/browser capability ${networkSelected.length === 1 ? "is" : "are"} declared for the trial.`
          : "No selected capability can gather or verify external evidence.",
      action:
        networkSelected.length > 0
          ? "No action needed."
          : "Enable a verified research capability or choose a non-research trial.",
    },
    {
      id: "budget",
      name: "Budget and duration ceiling",
      status: checkStatus(doctorStarted, budgetBounded),
      detail: `${planName} is selected; trial duration is capped at ${employee.lifecycle.trial_period}. Browser checkout is a labeled demo and charges nothing.`,
      action: budgetBounded
        ? "No action needed."
        : "Select a package before running the Doctor.",
    },
    {
      id: "approval",
      name: "Human approval wiring",
      status: checkStatus(doctorStarted, riskyWithoutApproval.length === 0),
      detail:
        riskyWithoutApproval.length === 0
          ? "Risky selected capabilities are read-only, previewable, or routed through human authorization."
          : `${riskyWithoutApproval.map(capability => capability.capability).join(", ")} needs an approval marker before activation.`,
      action:
        riskyWithoutApproval.length === 0
          ? "No action needed."
          : "Change the employee spec to require approval for high-risk writes.",
    },
    {
      id: "evidence",
      name: "Evidence and artifact capture",
      status: checkStatus(doctorStarted, hasEvidence),
      detail: hasEvidence
        ? "The trial can produce inspectable evidence and at least one deliverable artifact summary."
        : "No evidence or artifact path is declared for this employee.",
      action: hasEvidence
        ? "No action needed."
        : "Require evidence.create, artifact.report, or documented example outputs.",
    },
  ];

  if (!doctorStarted) {
    return checks.map((check, index) => ({
      ...check,
      status: index === 0 ? "progress" : "pending",
      detail:
        index === 0
          ? "Ready to validate this browser-side projection against the declared package facts."
          : check.detail,
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
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  selectedCapabilityIds: string[];
  planName: string;
  planPrice: string;
  accepted: boolean;
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
        ? evidenceCapabilities.map(
            capability => `${capability.capability}: declared trial evidence`
          )
        : [
            "Demo evidence summary: no live runtime event is available in this browser.",
          ],
    artifacts:
      artifactCapabilities.length > 0
        ? artifactCapabilities.map(
            capability => `${capability.capability}: bounded trial artifact`
          )
        : employee.examples.outputs.slice(0, 2),
    cost: `${planName} ${planPrice}; trial preview records $0 charged in this prototype.`,
    duration: `Bounded by ${employee.lifecycle.trial_period}; no long-running OpenWork task starts from this page.`,
    approval: accepted
      ? "Accepted by human reviewer in this browser session."
      : "Waiting for human review before activation.",
  };
}

function summarizeToolContract(
  capabilities: EmployeeToolCapability[],
  selectedCapabilityIds: string[],
  roleBoundary?: string
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
  ].map(operation => TOOL_OPERATION_COPY[operation]);
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
      ? `${optionalOffCount} optional ${optionalOffCount === 1 ? "capability remains" : "capabilities remain"} off`
      : null,
    conditionalOffCount > 0
      ? `${conditionalOffCount} conditional ${conditionalOffCount === 1 ? "capability is" : "capabilities are"} off`
      : null,
  ].filter((value): value is string => value !== null);

  return {
    access: `Current selection enables ${selected.length} declared ${selected.length === 1 ? "capability" : "capabilities"} (${requiredCount} required). ${scopedCount > 0 ? `${scopedCount} ${scopedCount === 1 ? "capability has" : "capabilities have"} an explicit data scope.` : "Access stays within each capability's declared task scope."}${offCopy.length > 0 ? ` ${listFormatter.format(offCopy)}.` : ""}`,
    actions: `The selected contract permits ${listFormatter.format(operations)}. ${authorizationCount > 0 ? `${authorizationCount} ${authorizationCount === 1 ? "capability pauses" : "capabilities pause"} for human authorization.` : "No selected capability requires call-time human authorization."} ${adapterCount > 0 ? `${adapterCount} ${adapterCount === 1 ? "capability depends" : "capabilities depend"} on a configured provider adapter.` : "No selected capability depends on a provider adapter."}`,
    risk: `Highest enabled risk tier: ${highestRisk}. ${sideEffects.length > 0 ? sideEffects[0] : "Selected capabilities declare no external side effects."}${sideEffects.length > 1 ? ` ${sideEffects.length - 1} additional declared ${sideEffects.length === 2 ? "side effect is" : "side effects are"} detailed below.` : ""} ${disabledCount} policy-disabled ${disabledCount === 1 ? "capability remains" : "capabilities remain"} unavailable.${roleBoundary ? ` Role boundary: ${roleBoundary}` : ""}`,
  };
}

function NotFound() {
  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Badge
          className="border-white/10 bg-white/[0.04] text-crew-muted"
          variant="outline"
        >
          Onboarding
        </Badge>
        <h1 className="mt-5 text-3xl font-light">Employee not found</h1>
        <p className="mt-4 text-sm leading-6 text-crew-body">
          This AI employee is not available in the marketplace.
        </p>
        <Button asChild className="mt-6 rounded-[8px]">
          <Link to="/marketplace">Back to marketplace</Link>
        </Button>
      </section>
    </main>
  );
}

function LegacyPermissionContext({ summary }: { summary: PermissionSummary }) {
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
          Legacy context
        </Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-crew-body">
        {summary.label}: {summary.access}
      </p>
      <p className="mt-2 text-xs leading-5 text-crew-muted">
        Declared by legacy package metadata for context only. It cannot grant a
        runtime capability and cannot be changed here.
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
  { label: string; className: string; Icon: LucideIcon }
> = {
  pending: {
    label: "Waiting",
    className: "border-white/10 bg-white/[0.025] text-crew-muted",
    Icon: Clock3,
  },
  progress: {
    label: "Progress",
    className: "border-crew-copper/40 bg-crew-copper/12 text-crew-copper",
    Icon: Hourglass,
  },
  pass: {
    label: "Pass",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    Icon: CheckCircle2,
  },
  fail: {
    label: "Action needed",
    className: "border-red-400/30 bg-red-400/10 text-red-200",
    Icon: XCircle,
  },
};

function ContractSection({
  employee,
  planName,
  planPrice,
}: {
  employee: NonNullable<ReturnType<typeof getEmployee>>;
  planName: string;
  planPrice: string;
}) {
  const expectations = [
    `Role: ${employee.role}`,
    `Runtime package: ${employee.employee_id}@${employee.version}`,
    `Expected cost: ${planName} ${planPrice}; no real payment in this prototype.`,
    `Trial before activation: ${employee.lifecycle.trial_period}`,
    `Performance proof: ${employeeEvidenceText(employee)}`,
  ];
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              Hiring contract
            </CardTitle>
            <p className="mt-2 text-sm leading-6 text-crew-body">
              Confirm the job boundary before granting any runtime status.
            </p>
          </div>
          <Badge
            className="border-white/10 bg-white/[0.04] text-crew-muted"
            variant="outline"
          >
            Contract stage
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="text-sm font-semibold text-crew-heading">
            Deliverables
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
            Expectations
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
  employee: NonNullable<ReturnType<typeof getEmployee>>
) {
  if (employee.certified_evaluation?.mock === false) {
    return `${employee.certification} certified evaluation from ${employee.certified_evaluation.source}`;
  }
  if (employee.evidence_state.package_status === "validated") {
    return "Package validation is real; certification score is not promoted as live lab proof.";
  }
  return "Registry evidence is incomplete; treat marketplace claims as draft.";
}

function PermissionAreaCard({ area }: { area: PermissionArea }) {
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
            Required
          </p>
          <ul className="mt-2 space-y-2">
            {(area.required.length > 0
              ? area.required
              : ["No required access in this area."]
            ).map(item => (
              <li className="break-words" key={`required:${item}`}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono uppercase tracking-[0.16em] text-crew-muted">
            Optional
          </p>
          <ul className="mt-2 space-y-2">
            {(area.optional.length > 0
              ? area.optional
              : ["No optional access in this area."]
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
            Policy disabled
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
}: {
  checks: DoctorCheck[];
  doctorStarted: boolean;
  doctorSuccess: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              Doctor checks
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-crew-body">
              Browser Doctor is a labeled readiness projection from package
              metadata. The CLI/runtime Doctor remains the source for live
              credentials, provider health, and workspace execution.
            </p>
          </div>
          <Button
            className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            onClick={onRun}
            type="button"
          >
            <Play className="size-4" />
            {doctorStarted ? "Re-run Doctor" : "Run Doctor"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["progress", "pass", "fail"] as const).map(status => {
            const copy = DOCTOR_STATUS_COPY[status];
            return (
              <Badge className={copy.className} key={status} variant="outline">
                {copy.label}
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
                    {copy.label}
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
              {doctorSuccess
                ? "Doctor passed for this selected contract."
                : "Doctor found activation blockers."}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {doctorSuccess
                ? "You can run the bounded trial next."
                : "Resolve the actionable failures above before trial acceptance can unlock activation."}
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
}: {
  summary: TrialSummary;
  doctorSuccess: boolean;
  trialStarted: boolean;
  trialAccepted: boolean;
  onRunTrial: () => void;
  onAcceptTrial: () => void;
}) {
  return (
    <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              Bounded trial summary
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-crew-body">
              This page does not start a live OpenWork task. It records a
              representative trial review from declared package facts and keeps
              activation locked until a human accepts it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              disabled={!doctorSuccess || trialStarted}
              onClick={onRunTrial}
              type="button"
            >
              {trialStarted ? "Trial summarized" : "Run bounded trial"}
            </Button>
            <Button
              className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
              disabled={!trialStarted || trialAccepted}
              onClick={onAcceptTrial}
              type="button"
              variant="outline"
            >
              {trialAccepted ? "Trial accepted" : "Accept trial"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">Task</h3>
            <p className="mt-2 text-sm leading-6 text-crew-body">
              {summary.task}
            </p>
          </article>
          <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
            <h3 className="text-sm font-semibold text-crew-heading">
              Cost and duration
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
              Evidence
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
              Artifacts and approval
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
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const employee = id ? getEmployee(id) : undefined;
  const team = useTeam();
  const permissionSummaries = useMemo(
    () => employee?.permissions.map(summarizePermission) ?? [],
    [employee]
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

  // 换员工时重置整套雇佣流程状态。用 React 官方的"渲染期对比上一个 key 调整 state"模式替代
  // setState-in-effect（后者多渲染一帧旧员工的状态且触发级联渲染警告）。
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
  const selectedCheckoutPlan =
    CHECKOUT_PLANS.find(plan => plan.id === selectedPlan) ?? CHECKOUT_PLANS[0];
  const toolContractOverview = summarizeToolContract(
    employee.tool_capabilities,
    toolCapabilities,
    employee.safety_notes[0] ?? employee.limitations[0]
  );
  const permissionAreas = buildPermissionAreas(
    employee.tool_capabilities,
    toolCapabilities,
    selectedCheckoutPlan.name,
    selectedCheckoutPlan.price
  );
  const doctorChecks = buildDoctorChecks({
    employee,
    selectedCapabilityIds: toolCapabilities,
    doctorStarted,
    planName: selectedCheckoutPlan.name,
  });
  const doctorSuccess = doctorPassed(doctorChecks);
  const trialSummary = buildTrialSummary({
    employee,
    selectedCapabilityIds: toolCapabilities,
    planName: selectedCheckoutPlan.name,
    planPrice: selectedCheckoutPlan.price,
    accepted: trialAccepted,
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
            {localHired ? "Hired on this machine" : "Local hire options ready"}
          </Badge>
          <h1 className="mt-5 text-4xl font-light leading-tight md:text-5xl">
            {localHired
              ? `${employee.name} is on your local roster.`
              : "Finish hiring on this machine."}
          </h1>
          <p className="mt-4 text-base leading-7 text-crew-body">
            {localHired
              ? "This browser wrote the durable local roster through the local CrewClaw API. You can still use the CLI commands below on another machine."
              : `This browser saved your ${employee.name} selection and the ${selectedCheckoutPlan.name} package. On this machine you can hire through the local API, or copy a CLI command for another machine.`}
          </p>
          {!localHired && (
            <div className="mt-6 rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ec9552]">
                Option 0 / this machine
              </p>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                When the local CrewClaw site is running against this workspace,
                hire writes <code>.crewclaw/team.json</code> the same way fire
                does — no clipboard step required.
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
                    ? "Hiring on this machine…"
                    : "Hire on this machine"}
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
                {localHired ? "Open team" : "Back to resume"}
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
              variant="outline"
            >
              <Link to="/marketplace">Keep browsing</Link>
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
            Back to resume
          </Link>
        </Button>

        <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              Hire Confirmation
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-5xl">
              Review capabilities before hiring {employee.name}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              This employee can join your durable local roster after you choose
              a package and authorize the declared capabilities. When the local
              CrewClaw API is available the site can write that roster on this
              machine; otherwise the CLI handoff performs the same validation.
              No real payment is processed in this prototype.
            </p>
          </div>

          <Card className="h-fit rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                What the website stores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-crew-body">
              <div className="flex gap-3">
                <Undo2 className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>
                  Only this hiring selection is stored in the browser. It is not
                  an employee record and does not grant runtime access.
                </p>
              </div>
              <div className="flex gap-3">
                <KeyRound className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>
                  The CLI revalidates every capability before it atomically
                  updates your local team file.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-crew-copper/25 bg-crew-copper/[0.06] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Hiring handoff
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              The marketplace carries the first task, budget label, runtime,
              and requested access into this review. These values are context,
              not runtime authorization.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  Intended task
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.task}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  Budget / runtime
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.budget} · {handoffIntent.runtime}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  Requested access
                </dt>
                <dd className="mt-1 leading-6 text-crew-body">
                  {handoffIntent.requested_access.length > 0
                    ? handoffIntent.requested_access.join(", ")
                    : "No marketplace access hint; required capabilities below remain authoritative."}
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
                  Choose a package
                </CardTitle>
                <p className="mt-2 text-sm leading-6 text-crew-body">
                  Pricing is part of the hiring preview. This checkout is
                  simulated and will not charge a real card.
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
              {CHECKOUT_PLANS.map(plan => (
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
              Simulated checkout confirmation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                      Mock checkout
                    </Badge>
                    <span className="text-sm text-crew-body">
                      {selectedCheckoutPlan.name} - {selectedCheckoutPlan.price}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-crew-body">
                    Confirming this step only records your selected package in
                    the demo flow. There is no payment processor, no card form,
                    and no real charge.
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
                    ? "Checkout simulated"
                    : "Confirm simulated checkout"}
                </Button>
              </div>
              {mockCheckoutConfirmed ? (
                <Alert className="mt-4 rounded-[8px] border-emerald-400/25 bg-emerald-400/10 text-crew-heading">
                  <CheckCircle2 className="size-4 text-emerald-200" />
                  <AlertTitle>Simulated checkout confirmed.</AlertTitle>
                  <AlertDescription className="text-crew-body">
                    Continue reviewing permissions before preparing the local
                    CLI handoff.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <ContractSection
          employee={employee}
          planName={selectedCheckoutPlan.name}
          planPrice={selectedCheckoutPlan.price}
        />

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <ShieldCheck
                aria-hidden="true"
                className="size-5 text-crew-copper"
              />
              <h2 className="mt-4 text-sm font-semibold">It wants to access</h2>
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
              <h2 className="mt-4 text-sm font-semibold">It can do</h2>
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
              <h2 className="mt-4 text-sm font-semibold">Main risk</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                {toolContractOverview.risk}
              </p>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Tool capabilities
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              Required capabilities are locked on. Conditional capabilities are
              enabled for relevant tasks and can be turned off. Optional
              capabilities require an explicit opt-in; policy-disabled ones stay
              unavailable.
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
              Required and optional access
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              CrewClaw separates required permissions from optional access
              across tools, files, browser, network, budget, and human approval.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {permissionAreas.map(area => (
              <PermissionAreaCard area={area} key={area.key} />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Declared legacy context
            </CardTitle>
            <p className="text-sm leading-6 text-crew-body">
              These hire.yaml declarations are read-only context, not runtime
              authorization. Only the capability selections above create formal
              capability tokens for this employee.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {permissionSummaries.map(summary => (
              <LegacyPermissionContext
                key={summary.permission}
                summary={summary}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Risk boundaries
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
            {activationReady
              ? "Activate local hire"
              : "Pass Doctor and accept trial first"}
          </Button>
          <Button
            asChild
            className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/marketplace">Keep browsing</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
