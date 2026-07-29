import { Badge } from "@/components/ui/badge";
import type { TaskRun, WorkbenchArtifact } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

export type EvidenceItem = {
  id: string;
  title: string;
  source: string;
  confidence: string;
  status: "passed" | "warning" | "failed";
  detail: string;
};

function evidenceFromRun(run: TaskRun, artifact: WorkbenchArtifact | null) {
  const items: EvidenceItem[] = [];

  for (const [index, source] of (run.sources ?? []).entries()) {
    items.push({
      id: `source-${index}`,
      title: "Source evidence",
      source,
      confidence: "source-linked",
      status: "passed",
      detail:
        "Runtime source captured for reviewer inspection before approval.",
    });
  }

  if (artifact) {
    for (const check of artifact.checks) {
      items.push({
        id: `check-${check.label}`,
        title: check.label,
        source: artifact.name,
        confidence: check.status === "passed" ? "high" : "review",
        status: check.status,
        detail: `${artifact.name}: ${check.label}`,
      });
    }
  }

  if (items.length === 0 && artifact) {
    items.push({
      id: `artifact-${artifact.id}`,
      title: "Artifact summary",
      source: artifact.name,
      confidence: "summary-only",
      status: artifact.status === "rejected" ? "failed" : "warning",
      detail: artifact.summary,
    });
  }

  return items;
}

export function EvidencePanel({
  run,
  artifact,
  selectedId,
  onSelect,
}: {
  run: TaskRun;
  artifact: WorkbenchArtifact | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const evidence = evidenceFromRun(run, artifact);
  const selected =
    evidence.find(item => item.id === selectedId) ?? evidence[0] ?? null;

  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
            Evidence
          </p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">
            审批前证据
          </h2>
        </div>
        <span className="font-mono text-xs text-crew-muted">
          {evidence.length} items
        </span>
      </div>

      {evidence.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-crew-muted">
          No evidence has been emitted yet. Delivery cannot be approved
          honestly.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            {evidence.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  "w-full border px-3 py-3 text-left transition",
                  selected?.id === item.id
                    ? "border-crew-copper/60 bg-crew-copper/10"
                    : "border-white/10 bg-black/10 hover:border-white/20"
                )}
                aria-label={`Inspect evidence: ${item.title}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-crew-heading">
                      {item.title}
                    </p>
                    <p className="mt-1 break-words font-mono text-xs text-crew-muted">
                      {item.source}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      "rounded-[8px] border font-mono",
                      statusClass(item.status)
                    )}
                    variant="outline"
                  >
                    {statusSymbol(item.status)} {item.status}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
          <div className="border border-white/10 bg-black/10 p-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
              Inspect selected evidence
            </p>
            {selected ? (
              <dl className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Title</dt>
                  <dd className="text-crew-heading">{selected.title}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Source</dt>
                  <dd className="break-words font-mono text-xs">
                    {selected.source}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-xs text-crew-muted">
                    Confidence
                  </dt>
                  <dd>{selected.confidence}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs text-crew-muted">Detail</dt>
                  <dd>{selected.detail}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-crew-muted">
                Select evidence before approving delivery.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
