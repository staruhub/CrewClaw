import {
  Ban,
  Boxes,
  CheckCircle2,
  CircleAlert,
  LockKeyhole,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  EmployeeToolCapability,
  EmployeeToolNecessity,
} from "@/data/employees";
import {
  isToolCapabilityEnabledByDefault,
  isToolCapabilitySelectable,
} from "@/data/employees";
import { cn } from "@/lib/utils";

const NECESSITY: Record<
  EmployeeToolNecessity,
  { label: string; className: string }
> = {
  required: {
    label: "Required",
    className: "border-sky-300/35 bg-sky-400/10 text-sky-100",
  },
  conditional: {
    label: "Conditional",
    className: "border-crew-copper/40 bg-crew-copper/12 text-crew-copper",
  },
  non_default: {
    label: "Optional · Off by default",
    className: "border-violet-300/35 bg-violet-400/10 text-violet-100",
  },
  disabled: {
    label: "Policy disabled",
    className: "border-white/10 bg-white/[0.025] text-crew-muted",
  },
};

const RISK_COPY: Record<EmployeeToolCapability["risk_tier"], string> = {
  P0: "Read-only or no meaningful side effect.",
  P1: "Writes only task-scoped CrewClaw records or artifacts.",
  P2: "May execute bounded work or contact a configured service.",
  P3: "May access private context or execute a workspace action.",
  P4: "Can change external state or send data outside the workspace.",
};

function invocationCopy(capability: EmployeeToolCapability) {
  if (capability.runtime_tool) {
    return `Model tool: ${capability.runtime_tool}`;
  }
  if (capability.invocation === "engine") {
    return "CrewClaw engine service";
  }
  const providers = capability.provider_bindings
    .map(binding => binding.provider)
    .join(", ");
  return providers ? `Provider adapter: ${providers}` : "Provider adapter";
}

function availabilityCopy(capability: EmployeeToolCapability) {
  switch (capability.availability) {
    case "policy_disabled":
      return "Unavailable: this employee's role policy blocks it.";
    case "adapter_required":
      return "Available only after its provider adapter is configured and authorized.";
    case "engine_service":
      return "Implemented by CrewClaw's task engine; runtime preflight verifies readiness.";
    default:
      return "Runtime implementation exists; preflight still checks credentials and provider health.";
  }
}

function authorizationCopy(capability: EmployeeToolCapability) {
  if (capability.permission === "disabled") {
    return "Cannot be enabled or called by this employee.";
  }
  if (capability.permission === "requires_authorization") {
    return capability.approval === "always"
      ? "Human approval is required for every call."
      : "CrewClaw pauses for human approval when the capability is needed.";
  }
  if (capability.permission === "write") {
    return capability.supports_preview
      ? "May write within its declared scope; a preview is supported."
      : "May write only within its declared task scope.";
  }
  return "Read-only within the declared scope.";
}

function selectionCopy(capability: EmployeeToolCapability, checked: boolean) {
  if (capability.necessity === "required") {
    return "Required by the role and always enabled.";
  }
  if (capability.necessity === "disabled") {
    return "Blocked by role policy and cannot be selected.";
  }
  if (capability.necessity === "non_default") {
    return checked
      ? "Explicitly enabled for this hire."
      : "Optional capability; opt in only when you need it.";
  }
  return checked
    ? "Enabled, but called only for relevant tasks."
    : "Disabled for this hire; tasks that need it may degrade or ask you.";
}

function CapabilityBody({
  capability,
  checked,
  selectable,
  onToggle,
}: {
  capability: EmployeeToolCapability;
  checked: boolean;
  selectable: boolean;
  onToggle?: (capability: EmployeeToolCapability) => void;
}) {
  const necessity = NECESSITY[capability.necessity];
  const Icon =
    capability.necessity === "disabled"
      ? Ban
      : capability.availability === "adapter_required"
        ? PlugZap
        : capability.permission === "requires_authorization"
          ? LockKeyhole
          : ShieldCheck;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {onToggle ? (
        <Checkbox
          aria-label={
            capability.necessity === "required"
              ? `${capability.capability} required capability`
              : capability.necessity === "disabled"
                ? `${capability.capability} policy-disabled capability`
                : `${capability.capability} capability`
          }
          checked={checked}
          className="mt-1 border-white/25 data-[state=checked]:border-crew-copper data-[state=checked]:bg-crew-copper"
          disabled={!selectable}
          name={`capability:${capability.capability}`}
          onCheckedChange={() => {
            if (selectable) onToggle(capability);
          }}
        />
      ) : (
        <Icon
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-crew-copper"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="break-all font-mono text-sm font-semibold text-crew-heading"
            translate="no"
          >
            {capability.capability}
          </code>
          <Badge className={necessity.className} variant="outline">
            {necessity.label}
          </Badge>
          <Badge
            className="border-white/10 bg-white/[0.04] font-mono text-crew-muted"
            variant="outline"
          >
            {capability.risk_tier} ·{" "}
            {capability.permission.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-crew-body">
          {capability.description}
        </p>
        {onToggle ? (
          <p className="mt-2 text-xs leading-5 text-crew-muted">
            {selectionCopy(capability, checked)}
          </p>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs leading-5 text-crew-body sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <Boxes aria-hidden="true" className="size-3.5" />
              Invocation
            </dt>
            <dd className="mt-1 break-words">{invocationCopy(capability)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Availability
            </dt>
            <dd className="mt-1 break-words">{availabilityCopy(capability)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              Authorization
            </dt>
            <dd className="mt-1 break-words">
              {authorizationCopy(capability)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <CircleAlert aria-hidden="true" className="size-3.5" />
              Risk
            </dt>
            <dd className="mt-1 break-words">
              {RISK_COPY[capability.risk_tier]}
              {capability.side_effects.length > 0
                ? ` ${capability.side_effects.join(" ")}`
                : ""}
            </dd>
          </div>
        </dl>
        {capability.on_unavailable ? (
          <p className="mt-3 text-xs leading-5 text-crew-muted">
            If unavailable: {capability.on_unavailable.replaceAll("_", " ")}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ToolCapabilityList({
  capabilities,
  enabledCapabilities,
  onToggle,
}: {
  capabilities: EmployeeToolCapability[];
  enabledCapabilities?: string[];
  onToggle?: (capability: EmployeeToolCapability) => void;
}) {
  if (capabilities.length === 0) {
    return (
      <p className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4 text-sm text-crew-muted">
        No tool capabilities are declared for this employee.
      </p>
    );
  }

  const selectionMode = Array.isArray(enabledCapabilities) && !!onToggle;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {capabilities.map(capability => {
        const checked = selectionMode
          ? capability.necessity === "required"
            ? true
            : capability.necessity === "disabled"
              ? false
              : enabledCapabilities.includes(capability.capability)
          : isToolCapabilityEnabledByDefault(capability);
        const selectable =
          selectionMode && isToolCapabilitySelectable(capability);
        const content = (
          <CapabilityBody
            capability={capability}
            checked={checked}
            onToggle={selectionMode ? onToggle : undefined}
            selectable={selectable}
          />
        );
        return (
          <li key={capability.capability}>
            {selectionMode ? (
              <label
                className={cn(
                  "block h-full rounded-[8px] border p-4 transition-colors",
                  selectable ? "cursor-pointer" : "cursor-not-allowed",
                  checked
                    ? "border-crew-copper/45 bg-crew-copper/10"
                    : "border-white/10 bg-white/[0.025]",
                  capability.necessity === "disabled" && "opacity-70"
                )}
              >
                {content}
              </label>
            ) : (
              <article className="h-full rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                {content}
              </article>
            )}
          </li>
        );
      })}
    </ul>
  );
}
