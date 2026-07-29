import type { KeyboardEvent } from "react";
import type { TaskRun } from "@/data/task-runs";
import { cn } from "@/lib/utils";
import { statusClass, statusSymbol } from "./status";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function eventActor(run: TaskRun, event: TaskRun["events"][number]) {
  return event.tool_name ?? run.employee_name ?? run.employee_id;
}

function eventStatus(event: TaskRun["events"][number]) {
  if (event.status) return event.status;
  if (event.type.includes("tool")) return "running";
  if (event.type.includes("approval")) return "waiting";
  return "recorded";
}

function eventProgress(run: TaskRun, index: number, status: string) {
  if (typeof run.cost === "number" && index === run.events.length - 1) {
    return `$${run.cost.toFixed(2)}`;
  }
  if (["success", "failed", "blocked", "error"].includes(status)) {
    return status;
  }
  return `${index + 1}/${run.events.length}`;
}

export function TimelinePanel({
  run,
  selectedId,
  onSelect,
}: {
  run: TaskRun;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  function selectWithKeyboard(
    event: KeyboardEvent<HTMLTableRowElement>,
    eventId: string
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(eventId);
  }

  return (
    <section className="min-w-0 border border-white/10 bg-white/[0.025] p-5 lg:p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
            Timeline
          </p>
          <h2 className="mt-1 text-base font-semibold text-crew-heading">
            员工动作
          </h2>
        </div>
        <span className="font-mono text-xs text-crew-muted">
          {run.events.length} events
        </span>
      </div>
      <div className="mt-5 overflow-x-auto lg:mt-2">
        <table className="w-full min-w-[720px] text-left text-sm lg:text-xs">
          <caption className="sr-only">
            Event timeline rows with time, actor, type, title, progress or cost,
            and status
          </caption>
          <thead className="border-b border-white/10 font-mono text-xs uppercase tracking-[0.12em] text-crew-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Time</th>
              <th className="py-2 pr-3 font-medium">Actor</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Progress / cost</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {run.events.map((event, index) => {
              const status = eventStatus(event);
              return (
                <tr
                  key={event.id}
                  tabIndex={0}
                  aria-selected={selectedId === event.id}
                  className={cn(
                    "cursor-pointer transition hover:bg-white/[0.035] focus-visible:bg-crew-copper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crew-copper/70",
                    selectedId === event.id ? "bg-crew-copper/10" : ""
                  )}
                  onClick={() => onSelect(event.id)}
                  onKeyDown={keyboardEvent =>
                    selectWithKeyboard(keyboardEvent, event.id)
                  }
                >
                  <td className="py-3 pr-3 font-mono text-xs tabular-nums text-crew-muted lg:py-2">
                    {fmtTime(event.timestamp)}
                  </td>
                  <td className="max-w-[140px] break-words py-3 pr-3 text-crew-body lg:py-2">
                    {eventActor(run, event)}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-crew-muted lg:py-2">
                    {event.type}
                  </td>
                  <td className="max-w-[280px] break-words py-3 pr-3 text-crew-heading lg:py-2">
                    {event.summary}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-crew-body lg:py-2">
                    {eventProgress(run, index, status)}
                  </td>
                  <td className="py-3 lg:py-2">
                    <span
                      className={cn(
                        "inline-flex border px-2 py-1 font-mono text-xs",
                        statusClass(status)
                      )}
                    >
                      {statusSymbol(status)} {status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
