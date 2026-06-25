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
import {
  getPermissionLevel,
  PermissionLevel,
  permissionLabel,
  type PermissionRiskLevel,
} from "@/components/employee/PermissionLevel";
import {
  CHECKOUT_PLANS,
  PricingBadge,
  PricingBulletList,
  PricingPlanIcon,
  pricingTone,
  type CheckoutPlanId,
} from "@/components/PricingInfo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getEmployee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";

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
      confirmation: "No write action. User still reviews final recommendations.",
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
      access: "CRM records and fields only after explicit future authorization.",
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
    access: read ? "Requested read access for this task area." : "Requested task access.",
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

function NotFound() {
  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Badge className="border-white/10 bg-white/[0.04] text-crew-muted" variant="outline">
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

function PermissionCard({
  summary,
  checked,
  onToggle,
}: {
  summary: PermissionSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "block cursor-pointer rounded-[8px] border p-4 transition",
        checked
          ? "border-crew-copper/45 bg-crew-copper/10"
          : "border-white/10 bg-white/[0.025] hover:border-white/20",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={checked}
          className="mt-1 border-white/25 data-[state=checked]:border-crew-copper data-[state=checked]:bg-crew-copper"
          onCheckedChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-crew-heading">{summary.label}</span>
            {!summary.enabledByDefault ? (
              <Badge className="border-white/10 bg-white/[0.04] text-crew-muted" variant="outline">
                Not default
              </Badge>
            ) : null}
          </div>
          <div className="mt-3">
            <PermissionLevel permission={summary.permission} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm leading-6 text-crew-body md:grid-cols-2">
            <div>
              <dt className="text-crew-muted">It wants to access</dt>
              <dd>{summary.access}</dd>
            </div>
            <div>
              <dt className="text-crew-muted">Confirmation point</dt>
              <dd>{summary.confirmation}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-crew-muted">Risk</dt>
              <dd>{summary.risk}</dd>
            </div>
          </dl>
        </div>
      </div>
    </label>
  );
}

export default function HireConfirm() {
  const { id } = useParams();
  const employee = id ? getEmployee(id) : undefined;
  const team = useTeam();
  const permissionSummaries = useMemo(
    () => employee?.permissions.map(summarizePermission) ?? [],
    [employee],
  );
  const defaultPermissions = useMemo(
    () =>
      permissionSummaries
        .filter((summary) => summary.enabledByDefault)
        .map((summary) => summary.permission),
    [permissionSummaries],
  );
  const [permissions, setPermissions] = useState<string[]>(defaultPermissions);
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlanId>("free");
  const [mockCheckoutConfirmed, setMockCheckoutConfirmed] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    setPermissions(defaultPermissions);
    setSelectedPlan(employee ? defaultPlanForPricing(employee.pricing) : "free");
    setMockCheckoutConfirmed(false);
    setResultMessage(null);
    setHasJoined(false);
  }, [defaultPermissions, employee]);

  useEffect(() => {
    if (!employee) return;

    track("permission_viewed", {
      employee_id: employee.employee_id,
      employee_name: employee.name,
      permission_count: employee.permissions.length,
    });
  }, [employee]);

  if (!employee) return <NotFound />;

  const alreadyHired = team.isHired(employee.employee_id);
  const selectedCheckoutPlan =
    CHECKOUT_PLANS.find((plan) => plan.id === selectedPlan) ?? CHECKOUT_PLANS[0];

  const togglePermission = (permission: string) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    );
  };

  if (hasJoined) {
    return (
      <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
        <section className="mx-auto max-w-3xl">
          <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
            Onboarding complete
          </Badge>
          <h1 className="mt-5 text-4xl font-light leading-tight md:text-5xl">
            Your new AI employee has joined the crew.
          </h1>
          <p className="mt-4 text-base leading-7 text-crew-body">
            {employee.name} is active in your team with the {selectedCheckoutPlan.name}
            package and the permissions you confirmed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/team">View team</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
              variant="outline"
            >
              <Link to={`/employee/${employee.employee_id}`}>Back to resume</Link>
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
              Confirm permissions before hiring {employee.name}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              This employee can join your local demo team after you choose a package,
              confirm the simulated checkout, and review what it can access. No real
              payment is processed in this prototype.
            </p>

            {alreadyHired ? (
              <Alert className="mt-6 rounded-[8px] border-crew-copper/35 bg-crew-copper/10 text-crew-heading">
                <CheckCircle2 className="size-4 text-crew-copper" />
                <AlertTitle>This employee has already joined your crew.</AlertTitle>
                <AlertDescription className="text-crew-body">
                  Go to the team dashboard to inspect health, permissions, or fire the
                  employee when they leave your crew.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <Card className="h-fit rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader>
              <CardTitle className="text-base font-semibold">How to revoke</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-crew-body">
              <div className="flex gap-3">
                <Undo2 className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>Fire the employee from the team dashboard. History will be kept.</p>
              </div>
              <div className="flex gap-3">
                <KeyRound className="mt-1 size-4 shrink-0 text-crew-copper" />
                <p>Keep optional or disabled permissions off until a task needs them.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Choose a package</CardTitle>
                <p className="mt-2 text-sm leading-6 text-crew-body">
                  Pricing is part of the hiring preview. This checkout is simulated and
                  will not charge a real card.
                </p>
              </div>
              <PricingBadge pricing={employee.pricing} />
            </div>
          </CardHeader>
          <CardContent>
            <RadioGroup
              className="grid gap-4 md:grid-cols-2"
              onValueChange={(plan) => {
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
              {CHECKOUT_PLANS.map((plan) => (
                <label
                  className={cn(
                    "block cursor-pointer rounded-[8px] border p-4 transition",
                    selectedPlan === plan.id
                      ? "border-crew-copper/45 bg-crew-copper/10"
                      : "border-white/10 bg-white/[0.025] hover:border-white/20",
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
                        <span className="text-sm text-crew-muted">{plan.cadence}</span>
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
                    Confirming this step only records your selected package in the demo
                    flow. There is no payment processor, no card form, and no real charge.
                  </p>
                </div>
                <Button
                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                  disabled={alreadyHired || mockCheckoutConfirmed}
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
                  {mockCheckoutConfirmed ? "Checkout simulated" : "Confirm simulated checkout"}
                </Button>
              </div>
              {mockCheckoutConfirmed ? (
                <Alert className="mt-4 rounded-[8px] border-emerald-400/25 bg-emerald-400/10 text-crew-heading">
                  <CheckCircle2 className="size-4 text-emerald-200" />
                  <AlertTitle>Simulated checkout confirmed.</AlertTitle>
                  <AlertDescription className="text-crew-body">
                    Continue reviewing permissions before this employee joins your crew.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <ShieldCheck className="size-5 text-crew-copper" />
              <h2 className="mt-4 text-sm font-semibold">It wants to access</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                Public web sources by default. Private contact or CRM access remains off
                unless explicitly enabled.
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <CircleAlert className="size-5 text-crew-copper" />
              <h2 className="mt-4 text-sm font-semibold">It can do</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                Read research sources and draft recommendations. Sending or external
                writes require human review.
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="pt-6">
              <AlertTriangle className="size-5 text-crew-copper" />
              <h2 className="mt-4 text-sm font-semibold">Main risk</h2>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                Sources may be stale and outreach drafts can be wrong. Review names,
                facts, and messages before acting.
              </p>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Permissions requested</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {permissionSummaries.map((summary) => (
              <PermissionCard
                checked={permissions.includes(summary.permission)}
                key={summary.permission}
                onToggle={() => togglePermission(summary.permission)}
                summary={summary}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Risk boundaries</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-crew-body">
              {employee.limitations.concat(employee.safety_notes).map((item) => (
                <li className="flex gap-3" key={item}>
                  <AlertTriangle className="mt-1 size-4 shrink-0 text-crew-copper" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {resultMessage ? (
          <Alert className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <AlertTitle>Hire status</AlertTitle>
            <AlertDescription className="text-crew-body">{resultMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Separator className="mt-8 bg-white/10" />

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            className="rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze"
            disabled={alreadyHired || !mockCheckoutConfirmed}
            onClick={() => {
              track("hire_confirmed", {
                employee_id: employee.employee_id,
                employee_name: employee.name,
                permission_count: permissions.length,
                permissions,
                checkout_plan: selectedPlan,
                simulated_checkout: true,
              });
              const result = team.hire(employee.employee_id, permissions);
              setResultMessage(result.message);
              track(result.ok ? "hire_succeeded" : "hire_failed", {
                employee_id: employee.employee_id,
                employee_name: employee.name,
                message: result.message,
                permission_count: permissions.length,
                checkout_plan: selectedPlan,
                simulated_checkout: true,
              });
              if (result.ok) setHasJoined(true);
            }}
          >
            {mockCheckoutConfirmed ? "Confirm and hire" : "Confirm simulated checkout first"}
          </Button>
          <Button
            asChild
            className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/team">View team</Link>
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
