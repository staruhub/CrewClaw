import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  PendingAction,
  TaskRun,
  WorkbenchArtifact,
} from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

function findAction(
  actions: PendingAction[],
  matcher: (action: PendingAction) => boolean
) {
  return actions.find(matcher) ?? null;
}

function pendingActionMessage(payload: {
  key: string;
  command: string;
  artifactId: string | null;
  reason?: string;
  revisionTask?: string;
}) {
  return `pending.run ${JSON.stringify({
    type: "pending.run",
    ...payload,
  })}`;
}

export function ApprovalPanel({
  run,
  artifact,
  evidenceInspected,
  onAction,
}: {
  run: TaskRun;
  artifact: WorkbenchArtifact | null;
  evidenceInspected: boolean;
  onAction: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [revisionTask, setRevisionTask] = useState("");

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
  const canApprove =
    Boolean(artifact) && evidenceInspected && Boolean(actions.approve);
  const canReject =
    Boolean(artifact) &&
    reason.trim().length > 0 &&
    revisionTask.trim().length > 0 &&
    Boolean(actions.revise);

  return (
    <section className="border border-amber-300/25 bg-amber-300/[0.045] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber-100">
            Approval
          </p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">
            人工交付门禁
          </h2>
        </div>
        <Badge
          className={cn(
            "rounded-[8px] border font-mono",
            statusClass(run.status)
          )}
          variant="outline"
        >
          {statusSymbol(run.status)} {delivered ? "released" : run.status}
        </Badge>
      </div>

      <p className="mt-3 text-sm leading-6 text-crew-body">
        Delivery is mandatory-gated: inspect evidence, then explicitly accept or
        reject. Rejecting requires a reason and creates a revision task command.
      </p>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">Artifact</p>
          <p className="mt-1 break-words text-crew-heading">
            {artifact?.name ?? "No artifact emitted"}
          </p>
        </div>
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">Evidence</p>
          <p
            className={
              evidenceInspected
                ? "mt-1 text-emerald-200"
                : "mt-1 text-amber-100"
            }
          >
            {evidenceInspected ? "inspected" : "inspect before approval"}
          </p>
        </div>
        <div className="border border-white/10 bg-black/10 p-3">
          <p className="font-mono text-xs text-crew-muted">Runtime action</p>
          <p className="mt-1 break-words font-mono text-xs text-crew-heading">
            {actions.approve?.command ?? "Missing explicit approval command"}
          </p>
        </div>
      </div>

      {missingAction ? (
        <p className="mt-4 border border-red-300/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          Approval controls are disabled because the runtime did not emit both
          explicit approval and revision pending actions.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canApprove || delivered || missingAction}
          onClick={() => {
            if (!actions.approve) return;
            onAction(
              pendingActionMessage({
                key: actions.approve.key,
                command: actions.approve.command,
                artifactId: artifact?.id ?? null,
              })
            );
          }}
          className="border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 transition enabled:hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Accept delivery
        </button>
        {delivered ? (
          <span className="self-center font-mono text-xs text-emerald-200">
            approval accepted; artifact release allowed
          </span>
        ) : rejected ? (
          <span className="self-center font-mono text-xs text-red-100">
            delivery rejected; revision required
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="block">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
            Rejection reason
          </span>
          <input
            value={reason}
            onChange={event => setReason(event.target.value)}
            className="mt-2 w-full border border-white/10 bg-black/20 px-3 py-2 text-sm text-crew-heading outline-none focus:border-crew-copper/60"
            placeholder="Missing source, wrong scope, unclear claim..."
          />
        </label>
        <label className="block">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
            Revision task
          </span>
          <input
            value={revisionTask}
            onChange={event => setRevisionTask(event.target.value)}
            className="mt-2 w-full border border-white/10 bg-black/20 px-3 py-2 text-sm text-crew-heading outline-none focus:border-crew-copper/60"
            placeholder="Ask employee to revise pricing section..."
          />
        </label>
        <button
          type="button"
          disabled={!canReject || missingAction}
          onClick={() => {
            if (!actions.revise) return;
            onAction(
              pendingActionMessage({
                key: actions.revise.key,
                command: actions.revise.command,
                artifactId: artifact?.id ?? null,
                reason: reason.trim(),
                revisionTask: revisionTask.trim(),
              })
            );
          }}
          className="self-end border border-red-300/40 bg-red-400/10 px-3 py-2 text-sm text-red-100 transition enabled:hover:border-red-200 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Create revision
        </button>
      </div>
    </section>
  );
}
