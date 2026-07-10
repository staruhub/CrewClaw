// Classification helpers live in @/lib/permissions — this file only exports components so react
// fast refresh works (react-refresh/only-export-components).
import type { ComponentType } from "react";
import { AlertTriangle, Eye, FileCheck2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getPermissionLevel, permissionLabel, type PermissionRiskLevel } from "@/lib/permissions";
import { cn } from "@/lib/utils";

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

