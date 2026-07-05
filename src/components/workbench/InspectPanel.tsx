import type { TaskRun } from "@/data/task-runs";

export function InspectPanel({ run }: { run: TaskRun }) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Inspect</p>
      <h2 className="mt-1 text-base font-semibold text-crew-heading">Debug / JSONL / Audit</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">Run Truth</p>
          <dl className="mt-2 space-y-2 text-xs leading-5 text-crew-body">
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>Status</dt>
              <dd className="font-mono text-crew-heading">{run.status}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>Tools</dt>
              <dd className="font-mono text-crew-heading">{run.tool_invocations.length}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>Cost</dt>
              <dd className="font-mono text-crew-heading">{typeof run.cost === "number" ? `$${run.cost.toFixed(2)}` : "n/a"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>Tokens</dt>
              <dd className="font-mono text-crew-heading">{typeof run.tokens === "number" ? run.tokens.toLocaleString() : "n/a"}</dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">Debug</p>
          <ul className="mt-2 space-y-2 text-xs leading-5 text-crew-body">
            {run.inspect.debug.map((line) => (
              <li key={line} className="break-words border-b border-white/10 pb-2">{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">Events</p>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap border border-white/10 bg-black/20 p-3 font-mono text-xs leading-5 text-crew-body">
            {run.inspect.raw_events.join("\n")}
          </pre>
        </div>
      </div>
    </section>
  );
}
