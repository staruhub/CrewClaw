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
import { useMessages } from "@/i18n";
import { marketplaceMessages } from "@/i18n/locales/marketplace";
import type { MarketplaceT } from "@/i18n/marketplace-format";
import { cn } from "@/lib/utils";

const NECESSITY: Record<
  EmployeeToolNecessity,
  {
    labelKey: "conditional" | "optionalOff" | "policyDisabled" | "required";
    className: string;
  }
> = {
  required: {
    labelKey: "required",
    className: "border-sky-300/35 bg-sky-400/10 text-sky-100",
  },
  conditional: {
    labelKey: "conditional",
    className: "border-crew-copper/40 bg-crew-copper/12 text-crew-copper",
  },
  non_default: {
    labelKey: "optionalOff",
    className: "border-violet-300/35 bg-violet-400/10 text-violet-100",
  },
  disabled: {
    labelKey: "policyDisabled",
    className: "border-white/10 bg-white/[0.025] text-crew-muted",
  },
};

const RISK_COPY: Record<
  EmployeeToolCapability["risk_tier"],
  "p1Risk" | "p2Risk" | "p3Risk" | "p4Risk" | "readOnlyRisk"
> = {
  P0: "readOnlyRisk",
  P1: "p1Risk",
  P2: "p2Risk",
  P3: "p3Risk",
  P4: "p4Risk",
};

function invocationCopy(capability: EmployeeToolCapability, t: MarketplaceT) {
  if (capability.runtime_tool) {
    return t("modelTool", { tool: capability.runtime_tool });
  }
  if (capability.invocation === "engine") {
    return t("engineService");
  }
  const providers = capability.provider_bindings
    .map(binding => binding.provider)
    .join(", ");
  return providers
    ? t("providerAdapterList", { providers })
    : t("providerAdapter");
}

function availabilityCopy(capability: EmployeeToolCapability, t: MarketplaceT) {
  switch (capability.availability) {
    case "policy_disabled":
      return t("capabilityUnavailablePolicy");
    case "adapter_required":
      return t("capabilityAdapterRequired");
    case "engine_service":
      return t("capabilityEngineService");
    default:
      return t("capabilityRuntimeExists");
  }
}

function authorizationCopy(
  capability: EmployeeToolCapability,
  t: MarketplaceT
) {
  if (capability.permission === "disabled") {
    return t("capabilityCannotEnable");
  }
  if (capability.permission === "requires_authorization") {
    return capability.approval === "always"
      ? t("capabilityHumanEveryCall")
      : t("capabilityHumanWhenNeeded");
  }
  if (capability.permission === "write") {
    return capability.supports_preview
      ? t("capabilityMayWritePreview")
      : t("capabilityMayWriteScope");
  }
  return t("capabilityReadonlyScope");
}

function selectionCopy(
  capability: EmployeeToolCapability,
  checked: boolean,
  t: MarketplaceT
) {
  if (capability.necessity === "required") {
    return t("capabilityRequiredSelection");
  }
  if (capability.necessity === "disabled") {
    return t("capabilityBlockedSelection");
  }
  if (capability.necessity === "non_default") {
    return checked
      ? t("capabilityExplicitlyEnabled")
      : t("capabilityOptionalOff");
  }
  return checked
    ? t("capabilityConditionalEnabled")
    : t("capabilityConditionalOff");
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
  const t = useMessages(marketplaceMessages);
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
              ? t("requiredCapabilityAria", {
                  capability: capability.capability,
                })
              : capability.necessity === "disabled"
                ? t("disabledCapabilityAria", {
                    capability: capability.capability,
                  })
                : t("capabilityAria", { capability: capability.capability })
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
            {t(necessity.labelKey)}
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
            {selectionCopy(capability, checked, t)}
          </p>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs leading-5 text-crew-body sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <Boxes aria-hidden="true" className="size-3.5" />
              {t("invocation")}
            </dt>
            <dd className="mt-1 break-words">
              {invocationCopy(capability, t)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {t("availability")}
            </dt>
            <dd className="mt-1 break-words">
              {availabilityCopy(capability, t)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              {t("authorization")}
            </dt>
            <dd className="mt-1 break-words">
              {authorizationCopy(capability, t)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-crew-muted">
              <CircleAlert aria-hidden="true" className="size-3.5" />
              {t("risk")}
            </dt>
            <dd className="mt-1 break-words">
              {t(RISK_COPY[capability.risk_tier])}
              {capability.side_effects.length > 0
                ? ` ${capability.side_effects.join(" ")}`
                : ""}
            </dd>
          </div>
        </dl>
        {capability.on_unavailable ? (
          <p className="mt-3 text-xs leading-5 text-crew-muted">
            {t("ifUnavailable", {
              mode: capability.on_unavailable.replaceAll("_", " "),
            })}
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
  const t = useMessages(marketplaceMessages);

  if (capabilities.length === 0) {
    return (
      <p className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4 text-sm text-crew-muted">
        {t("noToolCapabilities")}
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
