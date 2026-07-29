import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router";
import type { LocalEmployeePerformance } from "@contracts/local-performance";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Clock3,
  DollarSign,
  FileWarning,
  HeartPulse,
  History,
  ShieldAlert,
  Star,
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
import {
  defineCatalog,
  type MessageValues,
  useI18n,
  useMessages,
} from "@/i18n";
import { operationsEn } from "@/i18n/locales/en/operations";
import { operationsZhCN } from "@/i18n/locales/zh-CN/operations";
import { fetchLocalEmployeePerformance } from "@/lib/local-api";
import { loadSettledRecords } from "@/lib/performance-load";

const operationsMessages = defineCatalog(operationsEn, operationsZhCN);
type OperationsTranslator = (
  key: keyof typeof operationsEn,
  values?: MessageValues
) => string;
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];

const HEALTH_LABEL_KEY = {
  broken: "healthBroken",
  healthy: "healthHealthy",
  warning: "healthWarning",
} as const;

function percent(value: number, total: number, t: OperationsTranslator) {
  if (total === 0) return t("emDash");
  return `${Math.round((value / total) * 100)}%`;
}

function percentValue(
  value: number | null | undefined,
  t: OperationsTranslator
) {
  if (value === null || value === undefined) return t("emDash");
  return `${Math.round(value * 100)}%`;
}

function formatDuration(
  value: number | null | undefined,
  t: OperationsTranslator,
  formatNumber: NumberFormatter
) {
  if (value === null || value === undefined) return t("emDash");
  if (value < 1000) return t("durationMs", { value: formatNumber(value) });
  if (value < 60_000) {
    return t("durationSeconds", {
      value: formatNumber(Math.round(value / 1000)),
    });
  }
  return t("durationMinutes", {
    value: formatNumber(Math.round(value / 60_000)),
  });
}

function money(
  value: number | null | undefined,
  t: OperationsTranslator,
  formatNumber: NumberFormatter
) {
  if (value === null || value === undefined) return t("emDash");
  return formatNumber(value, {
    currency: "USD",
    maximumFractionDigits: 4,
    style: "currency",
  });
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

function evaluationLabel(
  performance: LocalEmployeePerformance | undefined,
  t: OperationsTranslator
) {
  const evaluation = performance?.evaluation;
  if (!evaluation || evaluation.state === "absent") return t("notEvaluated");
  if (evaluation.state === "invalid") return t("invalidLocalRecord");
  const score = evaluation.score ?? t("emDash");
  if (evaluation.mock) return t("mockNotCertified", { score });
  return t("storedPendingVerification", { score });
}

function performanceFlags(
  performance: LocalEmployeePerformance | undefined,
  t: OperationsTranslator
) {
  if (!performance) return [t("noLocalRecordLoaded")];
  const flags: string[] = [];
  const kpi = performance.kpi;
  if (kpi.state !== "available") flags.push(t("kpiUnavailable"));
  if ((kpi.rejected ?? 0) + (kpi.revision_requested ?? 0) > 0) {
    flags.push(t("humanRejectionOrRevision"));
  }
  if ((kpi.failed ?? 0) > 0) flags.push(t("failedCompletion"));
  if ((kpi.average_cost ?? 0) >= 1) flags.push(t("highCostOutcomes"));
  if ((kpi.evidence_coverage ?? 1) < 0.8) flags.push(t("evidenceGap"));
  if ((kpi.permission_violations ?? 0) + (kpi.safety_violations ?? 0) > 0) {
    flags.push(t("boundaryViolation"));
  }
  for (const warning of performance.warnings.slice(0, 2)) flags.push(warning);
  return flags;
}

function reputationLabel(
  performance: LocalEmployeePerformance | undefined,
  t: OperationsTranslator,
  formatNumber: NumberFormatter
) {
  if (!performance) return t("noEvidence");
  const proof = performance.proof_pack;
  if (proof.state === "invalid") return t("invalidProofPack");
  if (proof.field_status === "proven") return t("provenInField");
  if (proof.field_status === "pilot") return t("pilotEvidence");
  if (performance.verified_reviews.length > 0) {
    const average =
      performance.verified_reviews.reduce(
        (sum, review) => sum + review.rating,
        0
      ) / performance.verified_reviews.length;
    return t("verifiedReviewScore", {
      average: formatNumber(average, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
    });
  }
  return t("insufficientFieldEvidence");
}

function verdictLabel(
  performance: LocalEmployeePerformance | undefined,
  t: OperationsTranslator
) {
  if (!performance) return t("verdictNoData");
  const kpi = performance.kpi;
  const evaluation = performance.evaluation;
  if (kpi.state !== "available") return t("verdictKpiAbsent");
  if ((kpi.safety_violations ?? 0) > 0 || evaluation.verdict === "FAIL") {
    return t("verdictHold");
  }
  if ((kpi.tasks ?? 0) === 0) return t("verdictNoFormalTasks");
  if ((kpi.accepted ?? 0) === 0) return t("verdictNeedsAcceptance");
  return t("verdictPassHumanEvidence");
}

export default function Performance() {
  const team = useTeam();
  const t = useMessages(operationsMessages);
  const { formatNumber } = useI18n();
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
                ? t("performanceUnavailableCount", {
                    count: failedIds.length,
                    ids: failedIds.join(", "),
                  })
                : null,
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [employeeKey, t]);

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
    rejected:
      (row.performance?.kpi.rejected ?? 0) +
      (row.performance?.kpi.revision_requested ?? 0),
  }));
  const completionCount = kpis.reduce(
    (sum, kpi) => sum + (kpi?.completed ?? 0),
    0
  );
  const reviewCount = rows.reduce(
    (sum, row) => sum + (row.performance?.verified_reviews.length ?? 0),
    0
  );
  const medianCostProxy =
    kpis.length > 0
      ? kpis.reduce((sum, kpi) => sum + (kpi?.average_cost ?? 0), 0) /
        kpis.length
      : null;
  const averageEvidence =
    kpis.length > 0
      ? kpis.reduce((sum, kpi) => sum + (kpi?.evidence_coverage ?? 0), 0) /
        kpis.length
      : null;

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
            <ArrowLeft aria-hidden="true" className="size-4" />{" "}
            {t("marketplace")}
          </Link>
        </Button>

        <div className="mt-8 border-b border-white/10 pb-8">
          <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
            <BarChart3 aria-hidden="true" className="size-3" />{" "}
            {t("performanceBadge")}
          </Badge>
          <h1 className="mt-5 text-balance text-4xl font-light leading-tight md:text-6xl">
            {t("performanceTitle")}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
            {t("performanceDescription")}
          </p>
        </div>

        {loading || loadError ? (
          <Alert
            aria-live="polite"
            className="mt-6 border-white/10 bg-white/[0.03]"
          >
            <AlertTitle>
              {loading ? t("loadingLocalEvidence") : t("evidenceUnavailable")}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {loadError ?? t("evidenceLoadingDescription")}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            icon={Users}
            label={t("activeEmployees")}
            value={String(rows.length)}
            description={t("activeEmployeesDescription")}
          />
          <StatCard
            icon={Activity}
            label={t("formalTasks")}
            value={String(totalTasks)}
            description={t("formalTasksDescription")}
          />
          <StatCard
            icon={HeartPulse}
            label={t("userAccepted")}
            value={`${acceptedTasks} · ${percent(acceptedTasks, totalTasks, t)}`}
            description={t("userAcceptedDescription")}
          />
          <StatCard
            icon={Clock3}
            label={t("completedVsAccepted")}
            value={`${completionCount} / ${acceptedTasks}`}
            description={t("completedVsAcceptedDescription")}
          />
          <StatCard
            icon={HeartPulse}
            label={t("policyAccepted")}
            value={String(autoAcceptedTasks)}
            description={t("policyAcceptedDescription")}
          />
          <StatCard
            icon={BadgeCheck}
            label={t("correctStops")}
            value={String(correctlyBlockedTasks)}
            description={t("correctStopsDescription")}
          />
          <StatCard
            icon={BadgeCheck}
            label={t("storedRealEvals")}
            value={String(realStoredEvals)}
            description={t("storedRealEvalsDescription")}
          />
          <StatCard
            icon={DollarSign}
            label={t("averageCost")}
            value={money(medianCostProxy, t, formatNumber)}
            description={t("averageCostDescription")}
          />
          <StatCard
            icon={FileWarning}
            label={t("evidenceCoverage")}
            value={percentValue(averageEvidence, t)}
            description={t("evidenceCoverageDescription")}
          />
          <StatCard
            icon={Star}
            label={t("verifiedReviews")}
            value={String(reviewCount)}
            description={t("verifiedReviewsDescription")}
          />
          <StatCard
            icon={History}
            label={t("legacyUnclassified")}
            value={String(legacyUnclassifiedTasks)}
            description={t("legacyUnclassifiedDescription")}
          />
        </section>

        {legacyUnclassifiedTasks > 0 ? (
          <Alert className="mt-6 border-crew-copper/30 bg-crew-copper/[0.06]">
            <History aria-hidden="true" className="size-4" />
            <AlertTitle>{t("legacySeparateTitle")}</AlertTitle>
            <AlertDescription className="text-crew-body">
              {t("legacySeparateDescription", {
                tasks: legacyUnclassifiedTasks,
                claims: legacyAcceptedClaims,
                cost: money(legacyTotalCost, t, formatNumber),
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle>{t("formalOutcomesTitle")}</CardTitle>
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
                  <Bar dataKey="tasks" fill="#6B5E55" name={t("formalTasks")} />
                  <Bar
                    dataKey="accepted"
                    fill="#C87941"
                    name={t("userAccepted")}
                  />
                  <Bar
                    dataKey="autoAccepted"
                    fill="#9E744E"
                    name={t("policyAccepted")}
                  />
                  <Bar
                    dataKey="correctlyBlocked"
                    fill="#6E8B74"
                    name={t("correctStops")}
                  />
                  <Bar
                    dataKey="rejected"
                    fill="#A84D45"
                    name={t("rejectedOrRevision")}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Alert className="mt-5 border-white/10 bg-white/[0.025]">
              <BarChart3 aria-hidden="true" className="size-4" />
              <AlertTitle>{t("monthlyTrendTitle")}</AlertTitle>
              <AlertDescription className="text-crew-body">
                {t("monthlyTrendDescription")}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <section className="mt-8 grid gap-4 lg:grid-cols-3">
          {rows.map(row => {
            const flags = performanceFlags(row.performance, t);
            return (
              <Card
                className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading"
                key={row.employee.employee_id}
              >
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">
                    {row.employee.name}
                  </CardTitle>
                  <p className="text-sm text-crew-muted">
                    {t("verdict", {
                      verdict: verdictLabel(row.performance, t),
                    })}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-crew-muted">{t("examScore")}</span>
                      <span className="font-mono text-crew-heading">
                        {row.performance?.evaluation.score ?? t("emDash")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-crew-muted">{t("reputation")}</span>
                      <span className="text-right text-crew-heading">
                        {reputationLabel(row.performance, t, formatNumber)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-crew-muted">
                        {t("avgDuration")}
                      </span>
                      <span className="font-mono text-crew-heading">
                        {formatDuration(
                          row.performance?.kpi.average_duration_ms,
                          t,
                          formatNumber
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {flags.map(flag => (
                      <Badge
                        className="gap-1 rounded-[8px] border-amber-300/30 bg-amber-300/10 text-amber-100"
                        key={flag}
                        variant="outline"
                      >
                        <ShieldAlert aria-hidden="true" className="size-3" />
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead>{t("employee")}</TableHead>
                  <TableHead>{t("health")}</TableHead>
                  <TableHead className="text-right">
                    {t("formalTasks")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("userPolicyAccepted")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("correctStops")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("legacyUnclassified")}
                  </TableHead>
                  <TableHead className="text-right">{t("cost")}</TableHead>
                  <TableHead className="text-right">{t("evidence")}</TableHead>
                  <TableHead>{t("evaluation")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
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
                    <TableCell>{t(HEALTH_LABEL_KEY[row.health])}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.tasks ?? t("emDash")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.accepted ?? t("emDash")} /{" "}
                      {row.performance?.kpi.auto_accepted ?? t("emDash")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.correctly_blocked ?? t("emDash")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.performance?.kpi.legacy_unclassified_tasks ??
                        t("emDash")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {money(row.performance?.kpi.total_cost, t, formatNumber)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.performance?.proof_pack.sample_size
                        ? t("samples", {
                            count: formatNumber(
                              row.performance.proof_pack.sample_size,
                              {
                                maximumFractionDigits: 1,
                                notation: "compact",
                              }
                            ),
                          })
                        : percentValue(
                            row.performance?.kpi.evidence_coverage,
                            t
                          )}
                    </TableCell>
                    <TableCell>{evaluationLabel(row.performance, t)}</TableCell>
                    <TableCell>{verdictLabel(row.performance, t)}</TableCell>
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
