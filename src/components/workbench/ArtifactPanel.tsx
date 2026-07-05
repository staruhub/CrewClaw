import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkbenchArtifact } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

type Props = {
  artifacts: WorkbenchArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ArtifactPanel({ artifacts, selectedId, onSelect }: Props) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Artifacts</p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">产物</h2>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => onSelect(artifact.id)}
            className={cn(
              "w-full border px-3 py-3 text-left transition",
              selectedId === artifact.id
                ? "border-crew-copper/60 bg-crew-copper/10"
                : "border-white/10 bg-black/10 hover:border-white/20",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-crew-copper" />
                  <span className="truncate text-sm font-medium text-crew-heading">{artifact.name}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-crew-body">{artifact.summary}</p>
              </div>
              <Badge className={cn("rounded-[8px] border font-mono", statusClass(artifact.status))} variant="outline">
                {statusSymbol(artifact.status)} {artifact.status}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
