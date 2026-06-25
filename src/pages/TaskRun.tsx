import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { track } from "@/hooks/use-analytics";
import { getTaskRun, type TaskRun } from "@/data/task-runs";

const STATUS_CLASS: Record<string, string> = {
  accepted: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  delivered: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  rejected: "border-red-300/35 bg-red-400/10 text-red-100",
  failed: "border-red-300/35 bg-red-400/10 text-red-100",
};

const DECISION_CLASS: Record<string, string> = {
  allow: "text-emerald-300",
  confirm: "text-amber-200",
  deny: "text-red-300",
};

function statusClass(status: string) {
  return STATUS_CLASS[status] ?? "border-crew-copper/40 bg-crew-copper/12 text-crew-copper";
}

function Tick({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "✓" : "✗"}</span>;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function TaskRun() {
  const { id } = useParams<{ id: string }>();
  const run: TaskRun | null = getTaskRun(id ?? "");

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

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-4xl">
        <Link to="/team" className="text-sm text-crew-muted hover:text-crew-body">
          ← 返回团队
        </Link>

        {/* Header */}
        <div className="mt-4">
          <Badge className="rounded-[8px] border-crew-copper/40 bg-crew-copper/12 text-crew-copper" variant="outline">
            Task Run · 试工记录
          </Badge>
          <h1 className="mt-4 text-3xl font-light leading-tight md:text-4xl">{run.user_goal}</h1>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-crew-body">
            <span>{run.employee_name ?? run.employee_id}</span>
            {run.role ? <span className="text-crew-muted">· {run.role}</span> : null}
            {run.model ? <span className="font-mono text-crew-muted">· {run.model}</span> : null}
            <span className="text-crew-muted">· {fmtTime(run.started_at)}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge className={cn("rounded-[8px] border", statusClass(run.status))} variant="outline">
              {run.status}
            </Badge>
            {run.effective ? (
              <Badge className="rounded-[8px] border border-crew-copper/40 bg-crew-copper/12 text-crew-copper" variant="outline">
                ✦ 有效任务
              </Badge>
            ) : null}
            {typeof run.cost === "number" ? (
              <Badge className="rounded-[8px] border border-white/10 bg-white/[0.03] font-mono text-crew-body" variant="outline">
                Cost ${run.cost.toFixed(2)}
                {typeof run.tokens === "number" ? ` · ${run.tokens.toLocaleString()} tokens` : ""}
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Timeline + Acceptance */}
        <div className="mt-8 grid gap-6 md:grid-cols-[1.3fr_1fr]">
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-1">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Timeline</p>
              <CardTitle className="text-base font-semibold">员工动作</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {run.events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        event.status === "blocked" ? "bg-red-400" : event.type === "tool_called" ? "bg-crew-copper" : "bg-crew-warm",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-crew-heading">{event.summary}</p>
                      <p className="font-mono text-xs text-crew-muted">{fmtTime(event.timestamp)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-1">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Outcome</p>
              <CardTitle className="text-base font-semibold">验收</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-crew-body">
              <p>
                <Tick ok={!!run.output_valid} /> 结构达标
                {run.grade && run.grade.missing.length ? (
                  <span className="text-crew-muted">（缺：{run.grade.missing.join("、")}）</span>
                ) : null}
              </p>
              <p>
                <Tick ok={!!run.grade?.passed} /> 验收规则
              </p>
              <p>
                <Tick ok={!!run.effective} /> 有效任务 <span className="text-crew-muted">· {run.user_feedback ?? "—"}</span>
              </p>
              {run.dream ? (
                <p className="text-crew-muted">📓 沉淀 {run.dream.candidates} 条记忆（置信度 {run.dream.confidence}）</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Tool invocations — gateway audit */}
        {run.tool_invocations.length ? (
          <Card className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-1">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Tool Gateway</p>
              <CardTitle className="text-base font-semibold">工具调用 · 权限审计</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead className="text-crew-muted">工具</TableHead>
                    <TableHead className="text-crew-muted">摘要</TableHead>
                    <TableHead className="text-crew-muted">等级</TableHead>
                    <TableHead className="text-crew-muted">决策</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.tool_invocations.map((inv, i) => (
                    <TableRow key={i} className="border-white/10">
                      <TableCell className="font-mono text-crew-heading">{inv.tool_name}</TableCell>
                      <TableCell className="text-crew-body">{inv.input_summary}</TableCell>
                      <TableCell className="font-mono text-crew-muted">{inv.permission_level ?? "—"}</TableCell>
                      <TableCell className={cn("font-mono", DECISION_CLASS[inv.decision] ?? "text-crew-body")}>
                        {inv.decision}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {/* Deliverable */}
        {run.deliverable ? (
          <Card className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-1">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">Artifact</p>
              <CardTitle className="text-base font-semibold">交付物</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-crew-body">
                {run.deliverable}
              </pre>
              {run.sources && run.sources.length ? (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">来源</p>
                  <ul className="mt-2 space-y-1">
                    {run.sources.map((src) => (
                      <li key={src}>
                        <a href={src} target="_blank" rel="noreferrer" className="break-all text-crew-copper hover:text-crew-bronze">
                          {src}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </main>
  );
}
