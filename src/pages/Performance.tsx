import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router";
import type { LocalEmployeePerformance } from "@contracts/local-performance";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  HeartPulse,
  History,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEmployee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";
import { fetchLocalEmployeePerformance } from "@/lib/local-api";
import { loadSettledRecords } from "@/lib/performance-load";

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });

function percent(value: number, total: number) {
  if (total === 0) return "—";
  return `${Math.round((value / total) * 100)}%`;
}

function StatCard({
  description,
  icon: Icon,
  label,
  value,
}: {
  description: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-crew-muted">
          <Icon aria-hidden="true" className="size-4 text-crew-copper" />
          <span className="font-mono text-xs uppercase tracking-[0.14em]">
            {label}
          </span>
        </div>
        <p className="mt-4 text-3xl font-semibold tabular-nums text-crew-heading">
          {value}
        </p>
        <p className="mt-3 text-sm leading-6 text-crew-body">{description}</p>
      </CardContent>
    </Card>
  );
}

function evaluationLabel(performance: LocalEmployeePerformance | undefined) {
  const evaluation = performance?.evaluation;
  if (!evaluation || evaluation.state === "absent") return "Not evaluated";
  if (evaluation.state === "invalid") return "Invalid local record";
  if (evaluation.mock) return `MOCK ${evaluation.score} · not certified`;
  return `Stored ${evaluation.score} · pending verification`;
}

export default function Performance() {
  const team = useTeam();
  const activeTeam = useMemo(
    () => team.list().filter(employee => employee.status === "active"),
    [team]
  );
  const employeeKey = activeTeam
    .map(item => item.employee_id)
    .sort()
    .join("|");
  const [performanceState, setPerformanceState] = useState<{
    key: string;
    records: Record<string, LocalEmployeePerformance>;
    loadError: string | null;
  }>({ key: "", records: {}, loadError: null });
  const loading = performanceState.key !== employeeKey;
  const records = loading ? {} : performanceState.records;
  const loadError = loading ? null : performanceState.loadError;

  useEffect(() => {
    let cancelled = false;
    const employeeIds = employeeKey ? employeeKey.split("|") : [];
    void loadSettledRecords(employeeIds, fetchLocalEmployeePerformance).then(
      ({ records, failedIds }) => {
        if (!cancelled) {
          setPerformanceState({
            key: employeeKey,
            records,
            loadError:
              failedIds.length > 0
                ? `Local performance data is unavailable for ${failedIds.length} employee(s): ${failedIds.join(", ")}.`
                : null,
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [employeeKey]);

  const rows = activeTeam.flatMap(workspaceEmployee => {
    const employee = getEmployee(workspaceEmployee.employee_id);
    if (!employee) return [];
    return [
      {
        employee,
        health: team.getReport(employee.employee_id).health_status,
        performance: records[employee.employee_id],
      },
    ];
  });
  const kpis = rows
    .map(row => row.performance?.kpi)
    .filter(kpi => kpi?.state === "available");
  const totalTasks = kpis.reduce((sum, kpi) => sum + (kpi?.tasks ?? 0), 0);
  const acceptedTasks = kpis.reduce(
    (sum, kpi) => sum + (kpi?.accepted ?? 0),
    0
  );
  const autoAcceptedTasks = kpis.reduce(
    (sum, kpi) => sum + (kpi?.auto_accepted ?? 0),
    0
  );
  const correctlyBlockedTasks = kpis.reduce(
    (sum, kpi) => sum + (kpi?.correctly_blocked ?? 0),
    0
  );
  const legacyUnclassifiedTasks = kpis.reduce(
    (sum, kpi) => sum + (kpi?.legacy_unclassified_tasks ?? 0),
    0
  );
  const legacyAcceptedClaims = kpis.reduce(
    (sum, kpi) => sum + (kpi?.legacy_accepted_claims ?? 0),
    0
  );
  const legacyTotalCost = kpis.reduce(
    (sum, kpi) => sum + (kpi?.legacy_total_cost ?? 0),
    0
  );
  const realStoredEvals = rows.filter(
    row =>
      row.performance?.evaluation.state === "available" &&
      row.performance.evaluation.mock === false
  ).length;
  const chartData = rows.map(row => ({
    name: row.employee.name,
    tasks: row.performance?.kpi.tasks ?? 0,
    accepted: row.performance?.kpi.accepted ?? 0,
    autoAccepted: row.performance?.kpi.auto_accepted ?? 0,
    correctlyBlocked: row.performance?.kpi.correctly_blocked ?? 0,
  }));

  useEffect(() => {
    track("team_viewed", {
      source: "performance",
      active_employee_count: rows.length,
    });
  }, [rows.length]);

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-14">
      <section className="mx-auto max-w-6xl">
        <Button
          asChild
          className="rounded-[8px] border-white/15"
          variant="outline"
        >
          <Link to="/marketplace">
            <ArrowLeft aria-hidden="true" className="size-4" /> Marketplace
          </Link>
        </Button>

        <div className="mt-8 border-b border-white/10 pb-8">
          <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
            <BarChart3 aria-hidden="true" className="size-3" /> Performance
          </Badge>
          <h1 className="mt-5 text-balance text-4xl font-light leading-tight md:text-6xl">
            Verified local work signals
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
            Formal task outcomes and acceptance provenance come directly from
            the Runtime KPI v2 ledger. Chat turns are tracked separately and
            never inflate task counts. Evaluation records retain their MOCK or
            pending-verification status; this page does not fabricate
            reputation.
          </p>
        </div>

        {loading || loadError ? (
          <Alert
            aria-live="polite"
            className="mt-6 border-white/10 bg-white/[0.03]"
          >
            <AlertTitle>
              {loading ? "Loading local evidence…" : "Evidence unavailable"}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {loadError ?? "Reading .crewclaw/kpi and .crewclaw/eval records."}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            icon={Users}
            label="Active employees"
            value={String(rows.length)}
            description="Employees active in the durable local roster."
          />
          <StatCard
            icon={Activity}
            label="Formal tasks"
            value={String(totalTasks)}
            description="Formal work outcomes; chat turns and artifact actions are excluded."
          />
          <StatCard
            icon={HeartPulse}
            label="User accepted"
            value={`${acceptedTasks} · ${percent(acceptedTasks, totalTasks)}`}
            description="Deliverables explicitly accepted by the local user only."
          />
          <StatCard
            icon={HeartPulse}
            label="Policy accepted"
            value={String(autoAcceptedTasks)}
            description="Trust-policy decisions shown separately from user acceptance."
          />
          <StatCard
            icon={BadgeCheck}
            label="Correct stops"
            value={String(correctlyBlockedTasks)}
            description="Tasks that stopped at a declared tool, budget, or permission boundary."
          />
          <StatCard
            icon={BadgeCheck}
            label="Stored real evals"
            value={String(realStoredEvals)}
            description="Non-MOCK records shown as pending verification, never reputation."
          />
          <StatCard
            icon={History}
            label="Legacy / unclassified"
            value={String(legacyUnclassifiedTasks)}
            description="Pre-v2 counters retained as history and excluded from formal task metrics."
          />
        </section>

        {legacyUnclassifiedTasks > 0 ? (
          <Alert className="mt-6 border-crew-copper/30 bg-crew-copper/[0.06]">
            <History aria-hidden="true" className="size-4" />
            <AlertTitle>Legacy history is kept separate</AlertTitle>
            <AlertDescription className="text-crew-body">
              {legacyUnclassifiedTasks} old task counters are unclassified.
              Their {legacyAcceptedClaims} historical acceptance claims and $
              {numberFormat.format(legacyTotalCost)} cost are preserved, but
              never counted as verified v2 outcomes.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle>Formal outcomes & acceptance provenance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.08)"
                    vertical={false}
                  />
                  <XAxis dataKey="name" stroke="#B8ADA3" tickLine={false} />
                  <YAxis
                    allowDecimals={false}
                    stroke="#B8ADA3"
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#17120F",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      color: "#F2EDE6",
                    }}
                  />
                  <Bar dataKey="tasks" fill="#6B5E55" name="Formal tasks" />
                  <Bar dataKey="accepted" fill="#C87941" name="User accepted" />
                  <Bar
                    dataKey="autoAccepted"
                    fill="#9E744E"
                    name="Policy accepted"
                  />
                  <Bar
                    dataKey="correctlyBlocked"
                    fill="#6E8B74"
                    name="Correct stops"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead>Employee</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Formal tasks</TableHead>
                  <TableHead className="text-right">
                    User / policy accepted
                  </TableHead>
                  <TableHead className="text-right">Correct stops</TableHead>
                  <TableHead className="text-right">
                    Legacy / unclassified
                  </TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Evaluation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow
                    className="border-white/10"
                    key={row.employee.employee_id}
                  >
                    <TableCell className="font-medium">
                      {row.employee.name}
                    </TableCell>
                    <TableCell>{row.health}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.tasks ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.accepted ?? "—"} /{" "}
                      {row.performance?.kpi.auto_accepted ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.correctly_blocked ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.legacy_unclassified_tasks ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.performance?.kpi.total_cost === null ||
                      row.performance?.kpi.total_cost === undefined
                        ? "—"
                        : `$${numberFormat.format(row.performance.kpi.total_cost)}`}
                    </TableCell>
                    <TableCell>{evaluationLabel(row.performance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
