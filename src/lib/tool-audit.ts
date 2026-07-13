import type { ToolInvocation } from "@/data/task-runs";

const elapsedFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
});

/** Prefer runtime audit timestamps; keep elapsed_ms as a compatibility fallback. */
export function elapsedMsForToolInvocation(tool: ToolInvocation) {
  if (tool.started_at && tool.ended_at) {
    const elapsed = Date.parse(tool.ended_at) - Date.parse(tool.started_at);
    if (Number.isFinite(elapsed) && elapsed >= 0) return elapsed;
  }

  return Number.isFinite(tool.elapsed_ms) && (tool.elapsed_ms ?? -1) >= 0
    ? tool.elapsed_ms
    : undefined;
}

export function formatToolElapsed(tool: ToolInvocation) {
  const elapsedMs = elapsedMsForToolInvocation(tool);
  if (elapsedMs === undefined) return "—";
  if (elapsedMs < 1_000) return `${elapsedMs} ms`;
  return `${elapsedFormatter.format(elapsedMs / 1_000)} s`;
}
