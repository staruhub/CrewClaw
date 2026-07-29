import { Badge } from "@/components/ui/badge";
import type { TaskRun, WorkbenchArtifact } from "@/data/task-runs";
import { useMessages } from "@/i18n";
import { workbenchMessages } from "@/i18n/locales/workbench";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

export function OutcomeChecks({
  run,
  artifact,
}: {
  run: TaskRun;
  artifact: WorkbenchArtifact | null;
}) {
  const t = useMessages(workbenchMessages);
  const checks = artifact?.checks ?? [];

  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
            {t("checks")}
          </p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">
            {t("checksHeading")}
          </h2>
        </div>
        <Badge
          className={cn("rounded-[8px] border", statusClass(run.status))}
          variant="outline"
        >
          {statusSymbol(run.status)} {run.status}
        </Badge>
      </div>
      <div className="mt-4 space-y-2 text-sm text-crew-body">
        {checks.map(check => (
          <div
            key={check.label}
            className="flex items-center justify-between gap-3 border-b border-white/10 pb-2"
          >
            <span>{check.label}</span>
            <span
              className={cn(
                "font-mono",
                check.status === "passed"
                  ? "text-emerald-300"
                  : "text-amber-200"
              )}
            >
              {statusSymbol(check.status)} {check.status}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span>{t("effectiveTask")}</span>
          <span className={run.effective ? "text-emerald-300" : "text-red-300"}>
            {run.effective ? `✓ ${t("useful")}` : `✗ ${t("missingFeedback")}`}
          </span>
        </div>
      </div>
    </section>
  );
}
