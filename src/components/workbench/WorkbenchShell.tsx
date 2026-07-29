import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import type { TaskRun } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { ApprovalPanel } from "./ApprovalPanel";
import { ArtifactPanel } from "./ArtifactPanel";
import { ArtifactPreview } from "./ArtifactPreview";
import { EvidencePanel } from "./EvidencePanel";
import { InspectPanel } from "./InspectPanel";
import { OutcomeChecks } from "./OutcomeChecks";
import { TimelinePanel } from "./TimelinePanel";
import { ToolAudit } from "./ToolAudit";
import { honestRunState, statusClass, statusSymbol } from "./status";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function WorkbenchShell({ run }: { run: TaskRun }) {
  const initialArtifactId = run.artifact ?? run.artifacts[0]?.id ?? null;
  const [selectedArtifactId, setSelectedArtifactId] =
    useState(initialArtifactId);
  const [selectedEventId, setSelectedEventId] = useState(
    run.events[run.events.length - 1]?.id ?? null
  );
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(
    null
  );
  const [command, setCommand] = useState("");
  const [lastAction, setLastAction] = useState<string | null>(null);
  const selectedArtifact = useMemo(
    () =>
      run.artifacts.find(artifact => artifact.id === selectedArtifactId) ??
      run.artifacts[0] ??
      null,
    [run.artifacts, selectedArtifactId]
  );
  const selectedEvent = useMemo(
    () =>
      run.events.find(event => event.id === selectedEventId) ??
      run.events.at(-1) ??
      null,
    [run.events, selectedEventId]
  );
  const displayState = honestRunState(run.status);
  const currentQueueLabel =
    displayState === "delivered"
      ? "Delivery released"
      : displayState === "waiting"
        ? "Waiting for human approval"
        : displayState === "failed"
          ? "Needs recovery"
          : displayState === "streaming"
            ? "Employee is working"
            : "Idle / ready";

  function queueAction(message: string) {
    setLastAction(message);
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 pb-28 pt-8 text-crew-heading sm:px-6 lg:pt-4">
      <section className="mx-auto max-w-7xl">
        <nav
          aria-label="Workbench surfaces"
          className="mb-2 hidden items-center gap-5 border-b border-white/10 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted lg:flex"
        >
          <span className="bg-crew-copper px-2 py-1 font-semibold text-black">
            [1] Workbench
          </span>
          <Link className="hover:text-crew-copper" to="/marketplace">
            [2] Market
          </Link>
          <Link className="hover:text-crew-copper" to="/team">
            [3] Hire
          </Link>
          <Link className="hover:text-crew-copper" to="/performance">
            [4] Eval
          </Link>
          <Link className="hover:text-crew-copper" to="/crew">
            [5] Dream
          </Link>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5 lg:items-center lg:pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight md:text-3xl lg:text-xl">
              {run.user_goal}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-crew-body lg:mt-1 lg:text-xs">
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
                "rounded-[8px] border font-mono lg:h-6 lg:text-[10px]",
                statusClass(run.status)
              )}
              variant="outline"
            >
              {statusSymbol(run.status)} {run.status}
            </Badge>
            <Badge
              className={cn(
                "rounded-[8px] border font-mono lg:h-6 lg:text-[10px]",
                statusClass(displayState)
              )}
              variant="outline"
            >
              {statusSymbol(displayState)} {displayState}
            </Badge>
            {typeof run.cost === "number" ? (
              <Badge
                className="rounded-[8px] border border-white/10 bg-white/[0.03] font-mono text-crew-body lg:h-6 lg:text-[10px]"
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

        <div className="mt-5 grid gap-3 border-b border-white/10 pb-5 md:grid-cols-4 lg:hidden">
          {[
            ["State", `${statusSymbol(displayState)} ${displayState}`],
            ["Queue", currentQueueLabel],
            ["Artifacts", `${run.artifacts.length} tracked`],
            [
              "Evidence",
              `${(run.sources ?? []).length + (selectedArtifact?.checks.length ?? 0)} inspectable`,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="border border-white/10 bg-white/[0.025] p-3"
            >
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
                {label}
              </p>
              <p className="mt-1 text-sm text-crew-heading">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:mt-3 lg:grid-cols-[244px_minmax(0,1fr)_284px] lg:gap-3">
          <aside className="space-y-5 lg:order-1 lg:space-y-3">
            <section className="border border-white/10 bg-white/[0.025] p-5 lg:p-3">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Employee
              </p>
              <h2 className="mt-1 text-base font-semibold text-crew-heading">
                {run.employee_name ?? run.employee_id}
              </h2>
              <dl className="mt-4 space-y-2 text-sm leading-6 text-crew-body lg:mt-2 lg:space-y-1 lg:text-xs lg:leading-5">
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Role</dt>
                  <dd>{run.role ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Model</dt>
                  <dd className="break-words font-mono text-xs">
                    {run.model ?? "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Started</dt>
                  <dd>{fmtTime(run.started_at)}</dd>
                </div>
              </dl>
            </section>
            <section className="border border-white/10 bg-white/[0.025] p-5 lg:p-3">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Queue
              </p>
              <h2 className="mt-1 text-base font-semibold text-crew-heading">
                Trial task
              </h2>
              <div className="mt-4 border border-white/10 bg-black/10 p-3 lg:mt-2 lg:p-2">
                <p className="text-sm leading-6 text-crew-heading">
                  {run.user_goal}
                </p>
                <p className="mt-2 font-mono text-xs text-crew-muted">
                  {currentQueueLabel}
                </p>
              </div>
            </section>
          </aside>

          <div className="min-w-0 space-y-5 lg:order-2 lg:space-y-3">
            <TimelinePanel
              run={run}
              selectedId={selectedEvent?.id ?? null}
              onSelect={setSelectedEventId}
            />
            <section className="border border-white/10 bg-white/[0.025] p-5 lg:p-3">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Detail
              </p>
              <h2 className="mt-1 text-base font-semibold text-crew-heading">
                Event detail
              </h2>
              {selectedEvent ? (
                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 lg:mt-2 lg:gap-2 lg:text-xs">
                  <div className="border border-white/10 bg-black/10 p-3">
                    <dt className="font-mono text-xs text-crew-muted">Title</dt>
                    <dd className="mt-1 text-crew-heading">
                      {selectedEvent.summary}
                    </dd>
                  </div>
                  <div className="border border-white/10 bg-black/10 p-3">
                    <dt className="font-mono text-xs text-crew-muted">Actor</dt>
                    <dd className="mt-1 text-crew-heading">
                      {selectedEvent.tool_name ??
                        run.employee_name ??
                        run.employee_id}
                    </dd>
                  </div>
                  <div className="border border-white/10 bg-black/10 p-3">
                    <dt className="font-mono text-xs text-crew-muted">Type</dt>
                    <dd className="mt-1 font-mono text-xs">
                      {selectedEvent.type}
                    </dd>
                  </div>
                  <div className="border border-white/10 bg-black/10 p-3">
                    <dt className="font-mono text-xs text-crew-muted">
                      Status
                    </dt>
                    <dd className="mt-1 font-mono text-xs">
                      {selectedEvent.status ?? "recorded"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-crew-muted">
                  No timeline event has been emitted yet.
                </p>
              )}
            </section>
          </div>

          <div className="space-y-5 lg:order-3 lg:space-y-3">
            <ArtifactPanel
              artifacts={run.artifacts}
              selectedId={selectedArtifact?.id ?? null}
              onSelect={setSelectedArtifactId}
            />
            <OutcomeChecks run={run} artifact={selectedArtifact} />
            <EvidencePanel
              run={run}
              artifact={selectedArtifact}
              selectedId={selectedEvidenceId}
              onSelect={setSelectedEvidenceId}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <ArtifactPreview artifact={selectedArtifact} />
          <ToolAudit tools={run.tool_invocations} />
        </div>

        <div className="mt-5">
          <ApprovalPanel
            run={run}
            artifact={selectedArtifact}
            evidenceInspected={Boolean(selectedEvidenceId)}
            onAction={queueAction}
          />
        </div>

        <div className="mt-5">
          <InspectPanel run={run} />
        </div>
      </section>
      <section className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-crew-bg/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-end">
          <label className="min-w-0 flex-1">
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
              Input
            </span>
            <textarea
              value={command}
              onChange={event => setCommand(event.target.value)}
              rows={2}
              className="mt-1 w-full resize-none border border-white/10 bg-black/30 px-3 py-2 text-sm text-crew-heading outline-none focus:border-crew-copper/60"
              placeholder="/ask employee to clarify evidence, or type a review note"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {run.pending_actions.map(action => (
              <button
                key={action.key}
                type="button"
                onClick={() =>
                  queueAction(`pending.run ${action.key} ${action.command}`)
                }
                className="border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-crew-body hover:border-crew-copper/50 hover:text-crew-heading"
                aria-label={`Run pending action ${action.key}: ${action.label}`}
              >
                <span className="font-mono text-crew-copper">
                  [{action.key}]
                </span>{" "}
                {action.label}
              </button>
            ))}
            <button
              type="button"
              disabled={!command.trim()}
              onClick={() => {
                queueAction(`input.queued ${command.trim()}`);
                setCommand("");
              }}
              className="border border-crew-copper/50 bg-crew-copper/10 px-3 py-2 text-sm text-crew-heading enabled:hover:border-crew-copper disabled:cursor-not-allowed disabled:opacity-45"
            >
              Send
            </button>
          </div>
          {lastAction ? (
            <p className="break-all font-mono text-xs text-crew-muted md:max-w-xs">
              {lastAction}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
