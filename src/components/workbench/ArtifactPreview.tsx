import { Badge } from "@/components/ui/badge";
import type { WorkbenchArtifact } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

export function ArtifactPreview({
  artifact,
}: {
  artifact: WorkbenchArtifact | null;
}) {
  if (!artifact) {
    return (
      <section className="border border-white/10 bg-white/[0.025] p-5 text-sm text-crew-muted">
        选择一个 artifact 查看轻预览。
      </section>
    );
  }

  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
            Preview
          </p>
          <h2 className="mt-1 truncate text-base font-semibold text-crew-heading">
            {artifact.name}
          </h2>
          {artifact.path ? (
            <p className="mt-1 break-all font-mono text-xs text-crew-muted">
              {artifact.path}
            </p>
          ) : null}
        </div>
        <Badge
          className={cn(
            "rounded-[8px] border font-mono",
            statusClass(artifact.status)
          )}
          variant="outline"
        >
          {statusSymbol(artifact.status)} {artifact.kind}
        </Badge>
      </div>
      <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words border border-white/10 bg-black/20 p-3 font-sans text-sm leading-6 text-crew-body">
        {artifact.preview}
      </pre>
    </section>
  );
}
