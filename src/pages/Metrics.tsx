import { useMemo } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  ClipboardCheck,
} from "lucide-react";
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
import {
  ANALYTICS_EVENTS,
  type AnalyticsEvent,
  readAnalyticsEvents,
} from "@/hooks/use-analytics";

const DAY_MS = 24 * 60 * 60 * 1000;

function eventTime(event: AnalyticsEvent) {
  return new Date(event.timestamp).getTime();
}

function count(events: AnalyticsEvent[], eventName: AnalyticsEvent["event"]) {
  return events.filter(event => event.event === eventName).length;
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function uniqueEmployeeIds(events: AnalyticsEvent[]) {
  return new Set(
    events
      .map(event => event.props.employee_id)
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
  );
}

function firstEventAfter(
  events: AnalyticsEvent[],
  eventName: AnalyticsEvent["event"],
  employeeId: string,
  after: number,
  before: number
) {
  return events.find(event => {
    if (event.event !== eventName || event.props.employee_id !== employeeId)
      return false;
    const timestamp = eventTime(event);
    return timestamp >= after && timestamp <= before;
  });
}

function calculateMetrics(events: AnalyticsEvent[]) {
  const now = Date.now();
  const lastSevenDays = now - 7 * DAY_MS;
  const detailViews = count(events, "employee_detail_viewed");
  const hireClicks = count(events, "hire_clicked");
  const hireConfirmed = count(events, "hire_confirmed");
  const hireSucceeded = count(events, "hire_succeeded");
  const doctorCompleted = events.filter(
    event => event.event === "doctor_completed"
  );
  const explainedDoctorReports = doctorCompleted.filter(
    event =>
      Number(event.props.issue_count ?? 0) > 0 ||
      Number(event.props.suggestion_count ?? 0) > 0
  ).length;
  const hireSuccessEvents = events.filter(
    event => event.event === "hire_succeeded"
  );
  const employeesUsedWithinDay = new Set<string>();

  for (const event of hireSuccessEvents) {
    const employeeId = event.props.employee_id;
    if (typeof employeeId !== "string") continue;

    const hiredAt = eventTime(event);
    const usageEvent = firstEventAfter(
      events,
      "doctor_started",
      employeeId,
      hiredAt,
      hiredAt + DAY_MS
    );

    if (usageEvent) employeesUsedWithinDay.add(employeeId);
  }

  const recentActiveHires = [
    ...uniqueEmployeeIds(
      hireSuccessEvents.filter(event => eventTime(event) >= lastSevenDays)
    ),
  ].filter(employeeId =>
    firstEventAfter(events, "doctor_completed", employeeId, lastSevenDays, now)
  ).length;

  return {
    northStar: recentActiveHires,
    detailToHire: percent(hireClicks, detailViews),
    hireSuccess: percent(hireSucceeded, hireConfirmed),
    doctorExplainability: percent(
      explainedDoctorReports,
      doctorCompleted.length
    ),
    postHireUsage: percent(
      employeesUsedWithinDay.size,
      uniqueEmployeeIds(hireSuccessEvents).size
    ),
  };
}

function MetricCard({
  description,
  icon: Icon,
  label,
  value,
}: {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-crew-muted">
          <Icon className="size-4 text-crew-copper" />
          <span className="font-mono text-xs uppercase tracking-[0.14em]">
            {label}
          </span>
        </div>
        <p className="mt-4 text-3xl font-semibold text-crew-heading">{value}</p>
        <p className="mt-3 text-sm leading-6 text-crew-body">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function Metrics() {
  const events = useMemo(() => readAnalyticsEvents(), []);
  const metrics = useMemo(() => calculateMetrics(events), [events]);
  const eventCounts = useMemo(
    () =>
      ANALYTICS_EVENTS.map(eventName => ({
        eventName,
        count: count(events, eventName),
      })),
    [events]
  );

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

        <div className="mt-8 flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <BarChart3 className="size-3" />
              Metrics
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Employee hiring signals
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Demo metrics read local event history and show whether employees
              are being viewed, hired, checked, and used after onboarding.
            </p>
          </div>
          <p className="max-w-sm text-sm leading-6 text-crew-muted">
            North Star: hired AI employees that completed at least one Doctor
            check in the last 7 days.
          </p>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <Card className="rounded-[8px] border-crew-copper/35 bg-crew-copper/10 text-crew-heading">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-crew-copper">
                <BriefcaseBusiness className="size-5" />
                <span className="font-mono text-xs uppercase tracking-[0.14em]">
                  North Star
                </span>
              </div>
              <p className="mt-4 text-5xl font-semibold">{metrics.northStar}</p>
              <p className="mt-3 text-sm leading-6 text-crew-body">
                7-day active hired employees, counted when a hired employee has
                a completed Doctor event.
              </p>
            </CardContent>
          </Card>
          <MetricCard
            description="Hire clicks divided by employee resume views."
            icon={Activity}
            label="Detail to Hire"
            value={metrics.detailToHire}
          />
          <MetricCard
            description="Successful onboarding divided by confirmed Hire attempts."
            icon={ClipboardCheck}
            label="Hire Success"
            value={metrics.hireSuccess}
          />
        </section>

        <section className="mt-4 grid gap-4 md:grid-cols-2">
          <MetricCard
            description="Doctor reports with issues or suggestions, matching the explainability target."
            icon={ClipboardCheck}
            label="Doctor Explainability"
            value={metrics.doctorExplainability}
          />
          <MetricCard
            description="Hired employees that started a Doctor check within 24 hours."
            icon={Activity}
            label="Post-hire Usage"
            value={metrics.postHireUsage}
          />
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              Event counts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="px-5 text-crew-muted">Event</TableHead>
                  <TableHead className="px-5 text-right text-crew-muted">
                    Count
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventCounts.map(row => (
                  <TableRow
                    className="border-white/10 hover:bg-white/[0.025]"
                    key={row.eventName}
                  >
                    <TableCell className="px-5 py-4 font-mono text-xs text-crew-body">
                      {row.eventName}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right text-crew-heading">
                      {row.count}
                    </TableCell>
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
