import type { ToolInvocation } from "@/data/task-runs";

const elapsedFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
});

/**
 * Provenance-aware reading of a tool invocation's elapsed time.
 *
 * - `measured`: computed from the runtime audit window
 *   (`started_at` → `ended_at`), the only verified source.
 * - `claimed`: the persisted compatibility field `elapsed_ms`, a
 *   self-reported number that nothing verified. It is still displayed, but
 *   must never look identical to a measured value.
 * - `invalid_window`: both timestamps parse but `ended_at` precedes
 *   `started_at` (clock skew or a tampered/rewritten audit record). The
 *   record is suspect, so the claimed `elapsed_ms` is not laundered in as a
 *   fallback.
 * - `unknown`: no usable timing source at all.
 */
export type ToolElapsed =
  | { source: "measured"; elapsedMs: number }
  | { source: "claimed"; elapsedMs: number }
  | { source: "invalid_window" }
  | { source: "unknown" };

export function resolveToolElapsed(tool: ToolInvocation): ToolElapsed {
  if (tool.started_at && tool.ended_at) {
    const elapsed = Date.parse(tool.ended_at) - Date.parse(tool.started_at);
    if (Number.isFinite(elapsed)) {
      if (elapsed >= 0) return { source: "measured", elapsedMs: elapsed };
      // An impossible window is a signal in its own right, not a gap to
      // paper over with the self-reported duration.
      return { source: "invalid_window" };
    }
    // Unparsable timestamps: fall through to the compatibility field.
  }

  // `?? NaN` lets a genuine 0 through while a missing field, NaN, ±Infinity,
  // and negatives are all rejected below.
  const claimed = tool.elapsed_ms ?? Number.NaN;
  return Number.isFinite(claimed) && claimed >= 0
    ? { source: "claimed", elapsedMs: claimed }
    : { source: "unknown" };
}

/**
 * Best available duration in milliseconds with provenance flattened away:
 * a measured window beats a claimed `elapsed_ms`, and an invalid window
 * yields undefined instead of degrading to the claim. Callers that must
 * distinguish measured from claimed use resolveToolElapsed.
 */
export function elapsedMsForToolInvocation(tool: ToolInvocation) {
  const elapsed = resolveToolElapsed(tool);
  return elapsed.source === "measured" || elapsed.source === "claimed"
    ? elapsed.elapsedMs
    : undefined;
}

function formatDuration(elapsedMs: number) {
  if (elapsedMs < 1_000) return `${elapsedMs} ms`;
  return `${elapsedFormatter.format(elapsedMs / 1_000)} s`;
}

export function formatToolElapsed(tool: ToolInvocation) {
  const elapsed = resolveToolElapsed(tool);
  switch (elapsed.source) {
    case "measured":
      return formatDuration(elapsed.elapsedMs);
    case "claimed":
      // Honesty red line: an unverifiable, self-reported duration must not
      // render identically to a verified one.
      return `${formatDuration(elapsed.elapsedMs)} (claimed)`;
    case "invalid_window":
      return "invalid window";
    case "unknown":
      return "—";
  }
}
