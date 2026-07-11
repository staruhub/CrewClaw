import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { TaskRun } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { ArtifactPanel } from "./ArtifactPanel";
import { ArtifactPreview } from "./ArtifactPreview";
import { InspectPanel } from "./InspectPanel";
import { OutcomeChecks } from "./OutcomeChecks";
import { TimelinePanel } from "./TimelinePanel";
import { ToolAudit } from "./ToolAudit";
import { statusClass, statusSymbol } from "./status";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function WorkbenchShell({ run }: { run: TaskRun }) {
  const initialArtifactId = run.artifact ?? run.artifacts[0]?.id ?? null;
  const [selectedArtifactId, setSelectedArtifactId] =
    useState(initialArtifactId);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const selectedArtifact = useMemo(
    () =>
      run.artifacts.find(artifact => artifact.id === selectedArtifactId) ??
      run.artifacts[0] ??
      null,
    [run.artifacts, selectedArtifactId]
  );

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-8 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div className="min-w-0">
            <Badge
              className="rounded-[8px] border-crew-copper/40 bg-crew-copper/12 text-crew-copper"
              variant="outline"
            >
              TaskRun Workbench
            </Badge>
            <h1 className="mt-4 text-2xl font-semibold leading-tight md:text-3xl">
              {run.user_goal}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-crew-body">
              <span>{run.employee_name ?? run.employee_id}</span>
              {run.role ? (
                <span className="text-crew-muted">· {run.role}</span>
              ) : null}
              {run.model ? (
                <span className="font-mono text-crew-muted">· {run.model}</span>
              ) : null}
              <span className="text-crew-muted">
                · {fmtTime(run.started_at)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "rounded-[8px] border font-mono",
                statusClass(run.status)
              )}
              variant="outline"
            >
              {statusSymbol(run.status)} {run.status}
            </Badge>
            {typeof run.cost === "number" ? (
              <Badge
                className="rounded-[8px] border border-white/10 bg-white/[0.03] font-mono text-crew-body"
                variant="outline"
              >
                ${run.cost.toFixed(2)}
                {typeof run.tokens === "number"
                  ? ` · ${run.tokens.toLocaleString()} tok`
                  : ""}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-b border-white/10 pb-5">
          {run.pending_actions.map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() =>
                setLastAction(`${action.key} ${action.command ?? action.label}`)
              }
              className="border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-crew-body hover:border-crew-copper/50 hover:text-crew-heading"
              aria-label={`Run pending action ${action.key}: ${action.label}`}
            >
              <span className="font-mono text-crew-copper">[{action.key}]</span>{" "}
              {action.label}
            </button>
          ))}
          {lastAction ? (
            <span className="self-center font-mono text-xs text-crew-muted">
              pending.run {lastAction}
            </span>
          ) : null}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.9fr]">
          <TimelinePanel run={run} />
          <div className="space-y-5">
            <ArtifactPanel
              artifacts={run.artifacts}
              selectedId={selectedArtifact?.id ?? null}
              onSelect={setSelectedArtifactId}
            />
            <OutcomeChecks run={run} artifact={selectedArtifact} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
          <ArtifactPreview artifact={selectedArtifact} />
          <ToolAudit tools={run.tool_invocations} />
        </div>

        <div className="mt-5">
          <InspectPanel run={run} />
        </div>
      </section>
    </main>
  );
}
