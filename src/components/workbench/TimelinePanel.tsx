import type { TaskRun } from "@/data/task-runs";
import { statusSymbol } from "./status";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function TimelinePanel({ run }: { run: TaskRun }) {
  return (
    <section className="min-w-0 border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Timeline</p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">员工动作</h2>
        </div>
        <span className="font-mono text-xs text-crew-muted">{run.events.length} events</span>
      </div>
      <ol className="mt-5 space-y-3">
        {run.events.map((event) => (
          <li key={event.id} className="grid grid-cols-[1.5rem_1fr] gap-3">
            <span className="font-mono text-sm text-crew-copper">
              {statusSymbol(event.status ?? event.type)}
            </span>
            <div className="min-w-0">
              <p className="text-sm leading-6 text-crew-heading">{event.summary}</p>
              <p className="font-mono text-xs text-crew-muted">
                {event.tool_name ? `${event.tool_name} · ` : ""}
                {fmtTime(event.timestamp)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
