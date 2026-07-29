import type { TaskRun } from "@/data/task-runs";
import { useMessages } from "@/i18n";
import { workbenchMessages } from "@/i18n/locales/workbench";

export function InspectPanel({ run }: { run: TaskRun }) {
  const t = useMessages(workbenchMessages);

  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
        {t("inspect")}
      </p>
      <h2 className="mt-1 text-base font-semibold text-crew-heading">
        {t("inspectHeading")}
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
            {t("runTruth")}
          </p>
          <dl className="mt-2 space-y-2 text-xs leading-5 text-crew-body">
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>{t("status")}</dt>
              <dd className="font-mono text-crew-heading">{run.status}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>{t("tools")}</dt>
              <dd className="font-mono text-crew-heading">
                {run.tool_invocations.length}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>{t("cost")}</dt>
              <dd className="font-mono text-crew-heading">
                {typeof run.cost === "number"
                  ? `$${run.cost.toFixed(2)}`
                  : t("na")}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt>{t("tokens")}</dt>
              <dd className="font-mono text-crew-heading">
                {typeof run.tokens === "number"
                  ? run.tokens.toLocaleString()
                  : t("na")}
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
            {t("debug")}
          </p>
          <ul className="mt-2 space-y-2 text-xs leading-5 text-crew-body">
            {run.inspect.debug.map(line => (
              <li
                key={line}
                className="break-words border-b border-white/10 pb-2"
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-crew-muted">
            {t("events")}
          </p>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap border border-white/10 bg-black/20 p-3 font-mono text-xs leading-5 text-crew-body">
            {run.inspect.raw_events.join("\n")}
          </pre>
        </div>
      </div>
    </section>
  );
}
