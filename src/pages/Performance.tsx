import { useEffect, useMemo } from "react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  Clock3,
  HeartPulse,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { getEmployee, type Employee } from "@/data/employees";
import { type AnalyticsEvent, readAnalyticsEvents, track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";

type EmployeePerformance = {
  employee: Employee;
  health: "healthy" | "warning" | "broken";
  marketplaceHires: number;
  taskCount: number;
  responseSeconds: number;
  contributionScore: number;
};

function countEvents(events: AnalyticsEvent[], employeeId: string) {
  return events.filter((event) => event.props.employee_id === employeeId).length;
}

function responseSeconds(employee: Employee, index: number) {
  const base = 1.1 + index * 0.18;
  const skillAdjustment = Math.min(employee.skills.length * 0.04, 0.3);
  return Number((base + skillAdjustment).toFixed(1));
}

// Demo constant like responseSeconds above — there is no real hire telemetry yet and the page
// labels these columns as mock. The fabricated employee.hire_count/rating fields are gone.
function mockMarketplaceHires(index: number) {
  return 240 + index * 130;
}

function percent(value: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function healthLabel(health: EmployeePerformance["health"]) {
  if (health === "healthy") return "Healthy";
  if (health === "warning") return "Needs attention";
  return "Broken";
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
          <Icon className="size-4 text-crew-copper" />
          <span className="font-mono text-xs uppercase tracking-[0.14em]">{label}</span>
        </div>
        <p className="mt-4 text-3xl font-semibold text-crew-heading">{value}</p>
        <p className="mt-3 text-sm leading-6 text-crew-body">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function Performance() {
  const { getReport, list } = useTeam();
  const activeTeam = useMemo(
    () => list().filter((employee) => employee.status === "active"),
    [list],
  );
  const events = useMemo(() => readAnalyticsEvents(), []);

  const rows = useMemo<EmployeePerformance[]>(
    () =>
      activeTeam
        .map((workspaceEmployee, index) => {
          const employee = getEmployee(workspaceEmployee.employee_id);
          if (!employee) return null;

          const report = getReport(employee.employee_id);
          const taskCount = countEvents(events, employee.employee_id);
          const response = responseSeconds(employee, index);

          return {
            employee,
            health: report.health_status,
            marketplaceHires: mockMarketplaceHires(index),
            taskCount,
            responseSeconds: response,
            contributionScore: Math.min(100, 70 + taskCount * 5 + employee.skills.length * 3),
          };
        })
        .filter((row): row is EmployeePerformance => Boolean(row)),
    [activeTeam, events, getReport],
  );

  useEffect(() => {
    track("team_viewed", {
      source: "performance",
      active_employee_count: rows.length,
    });
  }, [rows.length]);

  const healthyCount = rows.filter((row) => row.health === "healthy").length;
  const totalTasks = rows.reduce((sum, row) => sum + row.taskCount, 0);
  const averageResponse =
    rows.length === 0
      ? "0.0s"
      : `${(rows.reduce((sum, row) => sum + row.responseSeconds, 0) / rows.length).toFixed(1)}s`;
  const chartData = rows.map((row) => ({
    name: row.employee.name.replace(" Specialist", "").replace(" Reviewer", ""),
    tasks: row.taskCount,
    contribution: row.contributionScore,
    response: row.responseSeconds,
  }));

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-14">
      <section className="mx-auto max-w-6xl">
        <Button
          asChild
          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
          variant="outline"
        >
          <Link to="/marketplace">
            <ArrowLeft className="size-4" />
            Marketplace
          </Link>
        </Button>

        <div className="mt-8 flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <BarChart3 className="size-3" />
              Performance
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              See how your AI employees are doing
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Demo performance combines local analytics, Doctor health, hiring signals, task
              contribution, and mock response speed for every active employee.
            </p>
          </div>
          <p className="max-w-sm text-sm leading-6 text-crew-muted">
            North Star: hired AI employees that completed at least one useful task in the last 7
            days.
          </p>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            description="Employees currently active in your crew."
            icon={Users}
            label="Hired employees"
            value={String(rows.length)}
          />
          <StatCard
            description="Doctor reports that say employees are ready to work."
            icon={HeartPulse}
            label="Doctor health"
            value={percent(healthyCount, rows.length)}
          />
          <StatCard
            description="Local events tied to active employees, including crew plans and Doctor checks."
            icon={Activity}
            label="Task events"
            value={String(totalTasks)}
          />
          <StatCard
            description="Mock response speed for a teammate-ready status update."
            icon={Clock3}
            label="Avg response"
            value={averageResponse}
          />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <BriefcaseBusiness className="size-5 text-crew-copper" />
                Task contribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer height="100%" width="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="name" stroke="#B8ADA3" tickLine={false} />
                    <YAxis allowDecimals={false} stroke="#B8ADA3" tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "#17120F",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        color: "#F2EDE6",
                      }}
                    />
                    <Bar dataKey="tasks" fill="#C87941" name="Task events" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Clock3 className="size-5 text-crew-copper" />
                Response mock
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer height="100%" width="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="name" stroke="#B8ADA3" tickLine={false} />
                    <YAxis stroke="#B8ADA3" tickLine={false} unit="s" />
                    <Tooltip
                      contentStyle={{
                        background: "#17120F",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        color: "#F2EDE6",
                      }}
                    />
                    <Line
                      dataKey="response"
                      dot={{ fill: "#F2EDE6", r: 4 }}
                      name="Response"
                      stroke="#F2EDE6"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Employee performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="px-5 text-crew-muted">Employee</TableHead>
                  <TableHead className="px-5 text-crew-muted">Doctor</TableHead>
                  <TableHead className="px-5 text-right text-crew-muted">Hires</TableHead>
                  <TableHead className="px-5 text-right text-crew-muted">Tasks</TableHead>
                  <TableHead className="px-5 text-right text-crew-muted">Response</TableHead>
                  <TableHead className="px-5 text-right text-crew-muted">Contribution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableCell className="px-5 py-8 text-crew-body" colSpan={6}>
                      Hire an employee to start building a performance record.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow className="border-white/10 hover:bg-white/[0.025]" key={row.employee.employee_id}>
                      <TableCell className="px-5 py-4">
                        <p className="font-medium text-crew-heading">{row.employee.name}</p>
                        <p className="mt-1 text-xs text-crew-muted">{row.employee.role}</p>
                      </TableCell>
                      <TableCell className="px-5 py-4">
                        <Badge className="rounded-[6px] border-white/10 bg-white/[0.04] text-crew-muted" variant="outline">
                          {healthLabel(row.health)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-5 py-4 text-right text-crew-heading">
                        {row.marketplaceHires}
                      </TableCell>
                      <TableCell className="px-5 py-4 text-right text-crew-heading">
                        {row.taskCount}
                      </TableCell>
                      <TableCell className="px-5 py-4 text-right text-crew-heading">
                        {row.responseSeconds.toFixed(1)}s
                      </TableCell>
                      <TableCell className="px-5 py-4 text-right text-crew-heading">
                        {row.contributionScore}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
