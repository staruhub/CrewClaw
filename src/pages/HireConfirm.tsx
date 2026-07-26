import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  ShieldCheck,
  Undo2,
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

export default function HireConfirm() {
  const { id } = useParams();
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

  const selectedCheckoutPlan =
    CHECKOUT_PLANS.find(plan => plan.id === selectedPlan) ?? CHECKOUT_PLANS[0];
  const toolContractOverview = summarizeToolContract(
    employee.tool_capabilities,
    toolCapabilities,
    employee.safety_notes[0] ?? employee.limitations[0]
  );

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
  };

  if (handoffPrepared) {
    const grantedToolCapabilities = toolCapabilitiesForHire(
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
                      grantedToolCapabilities
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

        <HireCliHandoff
          slug={employee.employee_id}
          capabilities={toolCapabilitiesForHire(
            employee.tool_capabilities,
            toolCapabilities
          )}
        />

        <Separator className="mt-8 bg-white/10" />

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            className="rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze"
            disabled={!mockCheckoutConfirmed}
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
            {mockCheckoutConfirmed
              ? "Prepare local hire"
              : "Confirm simulated checkout first"}
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
