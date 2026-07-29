import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { track } from "@/hooks/use-analytics";
import { getTaskRun } from "@/data/task-runs";
import { localizeTaskRun } from "@/i18n/task-run-content";
import { useI18n, useMessages } from "@/i18n";
import { workbenchMessages } from "@/i18n/locales/workbench";
import { trpc } from "@/providers/trpc";

export default function TaskRun() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useI18n();
  const t = useMessages(workbenchMessages);
  const q = trpc.taskRun.get.useQuery({ id: id ?? "" });
  const run = q.data ?? getTaskRun(id ?? "");
  const localizedRun = run ? localizeTaskRun(run, locale) : null;

  useEffect(() => {
    track("task_run_viewed", { task_run_id: id ?? "" });
  }, [id]);

  if (!localizedRun) {
    return (
      <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
        <section className="mx-auto max-w-3xl">
          <p className="text-crew-body">
            {t("taskRunNotFound", { id: id ?? "" })}
          </p>
          <Link
            to="/team"
            className="mt-4 inline-block text-crew-copper hover:text-crew-bronze"
          >
            ← {t("backToTeam")}
          </Link>
        </section>
      </main>
    );
  }

  return <WorkbenchShell run={localizedRun} />;
}
