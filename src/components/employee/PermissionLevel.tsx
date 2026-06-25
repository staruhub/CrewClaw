import type { ComponentType } from "react";
import { AlertTriangle, Eye, FileCheck2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PermissionRiskLevel =
  | "Read-only"
  | "Write with confirmation"
  | "Autonomous write"
  | "Sensitive action";

type PermissionLevelConfig = {
  className: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

const LEVEL_CONFIG: Record<PermissionRiskLevel, PermissionLevelConfig> = {
  "Read-only": {
    className: "border-sky-300/35 bg-sky-400/10 text-sky-100",
    description: "Reads context or public information only.",
    icon: Eye,
  },
  "Write with confirmation": {
    className: "border-crew-copper/40 bg-crew-copper/12 text-crew-copper",
    description: "Can prepare a change, but a human confirms before it acts.",
    icon: FileCheck2,
  },
  "Autonomous write": {
    className: "border-amber-300/40 bg-amber-300/12 text-amber-100",
    description: "Can write automatically after the permission is enabled.",
    icon: PencilLine,
  },
  "Sensitive action": {
    className: "border-red-300/45 bg-red-400/14 text-red-100",
    description: "High-risk action such as sending, payment, or deletion.",
    icon: AlertTriangle,
  },
};

export function permissionLabel(permission: string) {
  return permission
    .replace(/:disabled_by_default/g, " (disabled by default)")
    .replace(/:human_confirmation_required/g, " (human confirmation required)")
    .replace(/:disabled/g, " (disabled)")
    .replace(/_/g, " ");
}

export function getPermissionLevel(permission: string): PermissionRiskLevel {
  const value = permission.toLowerCase();

  if (
    value.includes("delete") ||
    value.includes("payment") ||
    value.includes("billing:charge") ||
    value.includes("invoice:pay") ||
    value.includes("pay:") ||
    value.includes("付款") ||
    value.includes("支付") ||
    value === "mailbox:send" ||
    value.includes("email:send") ||
    value.includes("message:send") ||
    value.includes("contacts:write")
  ) {
    return "Sensitive action";
  }

  if (value.includes("human_confirmation_required") || value.includes("confirmation")) {
    return "Write with confirmation";
  }

  if (value.includes(":write") || value.includes(" write") || value.includes("write:")) {
    return "Autonomous write";
  }

  return "Read-only";
}

export function PermissionLevel({
  className,
  compact = false,
  permission,
  showDescription = true,
}: {
  className?: string;
  compact?: boolean;
  permission: string;
  showDescription?: boolean;
}) {
  const level = getPermissionLevel(permission);
  const config = LEVEL_CONFIG[level];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "rounded-[8px] border p-3",
        config.className,
        level === "Sensitive action" && "shadow-[0_0_0_1px_rgba(248,113,113,0.18)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{permissionLabel(permission)}</span>
            <Badge className={cn("rounded-[8px] border text-[11px]", config.className)} variant="outline">
              {level}
            </Badge>
          </div>
          {!compact && showDescription ? (
            <p className="mt-2 text-xs leading-5 opacity-85">{config.description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PermissionLevelList({
  permissions,
  compact = false,
}: {
  compact?: boolean;
  permissions: string[];
}) {
  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-2" : undefined)}>
      {permissions.map((permission) => (
        <PermissionLevel compact={compact} key={permission} permission={permission} />
      ))}
    </div>
  );
}

