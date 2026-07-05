import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { track } from "@/hooks/use-analytics";
import { getTaskRun } from "@/data/task-runs";
import { trpc } from "@/providers/trpc";

export default function TaskRun() {
  const { id } = useParams<{ id: string }>();
  const q = trpc.taskRun.get.useQuery({ id: id ?? "" });
  const run = q.data ?? getTaskRun(id ?? "");

  useEffect(() => {
    track("task_run_viewed", { task_run_id: id ?? "" });
  }, [id]);

  if (!run) {
    return (
      <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
        <section className="mx-auto max-w-3xl">
          <p className="text-crew-body">找不到这次任务运行（{id}）。</p>
          <Link to="/team" className="mt-4 inline-block text-crew-copper hover:text-crew-bronze">
            ← 返回团队
          </Link>
        </section>
      </main>
    );
  }

  return <WorkbenchShell run={run} />;
}
