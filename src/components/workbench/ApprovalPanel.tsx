import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  PendingAction,
  TaskRun,
  WorkbenchArtifact,
} from "@/data/task-runs";
import { useMessages } from "@/i18n";
import { workbenchMessages } from "@/i18n/locales/workbench";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

function findAction(
  actions: PendingAction[],
  matcher: (action: PendingAction) => boolean
) {
  return actions.find(matcher) ?? null;
}

export function ApprovalPanel({
  run,
  artifact,
  evidenceInspected,
}: {
  run: TaskRun;
  artifact: WorkbenchArtifact | null;
  evidenceInspected: boolean;
}) {
  const t = useMessages(workbenchMessages);

  const actions = useMemo(() => {
    const approve = findAction(run.pending_actions, action =>
      /accept|approve/i.test(`${action.command} ${action.label}`)
    );
    const revise = findAction(run.pending_actions, action =>
      /revise|reject|复核|修订|修改/i.test(`${action.command} ${action.label}`)
    );
    return { approve, revise };
  }, [run.pending_actions]);

  const delivered = ["accepted", "delivered"].includes(run.status);
  const rejected = run.status === "rejected";
  const missingAction = !actions.approve || !actions.revise;

  return (
    <section className="border border-amber-300/25 bg-amber-300/[0.045] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber-100">
            {t("approvalTitle")}
          </p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">
            {t("approvalHeading")}
          </h2>
        </div>
        <Badge
          className={cn(
            "rounded-[8px] border font-mono",
            statusClass(run.status)
          )}
          variant="outline"
        >
          {statusSymbol(run.status)} {delivered ? t("released") : run.status}
        </Badge>
      </div>

      <p className="mt-3 text-sm leading-6 text-crew-body">
        {t("approvalBody")}
      </p>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">{t("artifact")}</p>
          <p className="mt-1 break-words text-crew-heading">
            {artifact?.name ?? t("noArtifact")}
          </p>
        </div>
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">{t("evidence")}</p>
          <p
            className={
              evidenceInspected
                ? "mt-1 text-emerald-200"
                : "mt-1 text-amber-100"
            }
          >
            {evidenceInspected
              ? t("evidenceInspected")
              : t("evidenceBeforeApproval")}
          </p>
        </div>
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">
            {t("runtimeAction")}
          </p>
          <p className="mt-1 break-words font-mono text-xs text-crew-heading">
            {actions.approve?.command ?? t("missingApprovalCommand")}
          </p>
        </div>
      </div>

      {missingAction ? (
        <p className="mt-4 border border-red-300/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          {t("missingApprovalActions")}
        </p>
      ) : null}

      <div className="mt-4 border border-sky-300/25 bg-sky-400/[0.06] p-3">
        <p className="text-sm leading-6 text-sky-100">
          This website is a read-only projection of persisted TaskRun evidence.
          Open the CrewClaw TUI to execute the runtime-emitted approval action;
          the website does not maintain a second execution engine.
        </p>
        <div className="mt-2 space-y-1 font-mono text-xs text-crew-body">
          {run.pending_actions.map(action => (
            <p className="break-all" key={action.key}>
              [{action.key}] {action.command} — {action.label}
            </p>
          ))}
        </div>
        {delivered ? (
          <span className="mt-2 block font-mono text-xs text-emerald-200">
            {t("approvalAccepted")}
          </span>
        ) : rejected ? (
          <span className="mt-2 block font-mono text-xs text-red-100">
            {t("deliveryRejected")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
