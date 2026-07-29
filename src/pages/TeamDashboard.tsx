import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { LocalEmployeePerformance } from "@contracts/local-performance";
import type { OffboardingMode } from "@contracts/team";
import type { DoctorReport, HealthStatus } from "@contracts/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useRoles } from "@/hooks/use-roles";
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
import { cn } from "@/lib/utils";

const operationsMessages = defineCatalog(operationsEn, operationsZhCN);
type OperationsTranslator = (
  key: keyof typeof operationsEn,
  values?: MessageValues
) => string;
type DateFormatter = ReturnType<typeof useI18n>["formatDate"];

const HEALTH_COPY_KEY: Record<HealthStatus, keyof typeof operationsEn> = {
  healthy: "healthHealthyCopy",
  warning: "healthWarningCopy",
  broken: "healthBrokenCopy",
};

const HEALTH_LABEL_KEY: Record<HealthStatus, keyof typeof operationsEn> = {
  healthy: "healthHealthy",
  warning: "healthWarning",
  broken: "healthBroken",
};

const HEALTH_BADGE_CLASS: Record<HealthStatus, string> = {
  healthy: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-300/35 bg-amber-300/10 text-amber-100",
  broken: "border-red-300/35 bg-red-400/10 text-red-100",
};

const ROLE_SUGGESTION_KEYS = [
  "roleSuggestionCodeReview",
  "roleSuggestionPrdIntake",
  "roleSuggestionResearchScout",
  "roleSuggestionLaunchReadiness",
  "roleSuggestionOnCallDoctor",
  "roleSuggestionCustomerFollowUp",
] as const satisfies readonly (keyof typeof operationsEn)[];

type RoleDraft = {
  employeeId: string;
  employeeName: string;
  role: string;
};

function formatActivity(value: string, formatDate: DateFormatter) {
  return formatDate(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HealthBadge({
  status,
  t,
}: {
  status: HealthStatus;
  t: OperationsTranslator;
}) {
  return (
    <Badge
      className={cn("rounded-[8px] border", HEALTH_BADGE_CLASS[status])}
      variant="outline"
    >
      {t(HEALTH_LABEL_KEY[status])}
    </Badge>
  );
}

function ReportList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-crew-body">
      {items.map(item => (
        <li
          className="rounded-[8px] border border-white/10 bg-white/[0.03] px-3 py-2"
          key={item}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function approvalSummary(
  performance: LocalEmployeePerformance | undefined,
  t: OperationsTranslator
) {
  if (!performance || performance.kpi.state !== "available") {
    return {
      accepted: t("emDash"),
      completion: t("emDash"),
      evidence: t("noKpiRecord"),
      reviews: t("emDash"),
    };
  }
  const accepted = performance.kpi.accepted ?? 0;
  const completed = performance.kpi.completed ?? 0;
  const reviewCount = performance.verified_reviews.length;
  const reviewable = performance.accepted_tasks.filter(
    task => !task.reviewed
  ).length;
  const evidence =
    performance.kpi.evidence_coverage === null
      ? t("evidenceUnknown")
      : t("evidencePercent", {
          percent: Math.round(performance.kpi.evidence_coverage * 100),
        });

  return {
    accepted: String(accepted),
    completion: String(completed),
    evidence,
    reviews:
      reviewable > 0
        ? t("reviewPending", { count: reviewCount, pending: reviewable })
        : t("reviewCount", { count: reviewCount }),
  };
}

export default function TeamDashboard() {
  const navigate = useNavigate();
  const team = useTeam();
  const roleAssignments = useRoles();
  const t = useMessages(operationsMessages);
  const { formatDate } = useI18n();
  const roleSuggestions = useMemo(
    () => ROLE_SUGGESTION_KEYS.map(key => t(key)),
    [t]
  );
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [reportEmployeeName, setReportEmployeeName] = useState<string>(
    t("employee")
  );
  const [offboardingMode, setOffboardingMode] =
    useState<OffboardingMode>("export_memory");
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const roster = team.list().filter(employee => employee.status !== "fired");
  const employeeKey = roster
    .map(employee => employee.employee_id)
    .sort()
    .join("|");
  const [performanceState, setPerformanceState] = useState<{
    key: string;
    records: Record<string, LocalEmployeePerformance>;
    loadError: string | null;
  }>({ key: "", records: {}, loadError: null });
  const performanceLoading = performanceState.key !== employeeKey;
  const performanceRecords = useMemo(
    () => (performanceLoading ? {} : performanceState.records),
    [performanceLoading, performanceState.records]
  );
  const performanceLoadError = performanceLoading
    ? null
    : performanceState.loadError;

  const rows = useMemo(
    () =>
      roster.map(workspaceEmployee => {
        const employee = getEmployee(workspaceEmployee.employee_id);
        const doctorReport = team.getReport(workspaceEmployee.employee_id);
        const performance = performanceRecords[workspaceEmployee.employee_id];

        return {
          employee,
          workspaceEmployee,
          doctorReport,
          performance,
          approval: approvalSummary(performance, t),
          name: employee?.name ?? workspaceEmployee.employee_id,
          role: employee?.role ?? t("unknownRole"),
          assignedRole: roleAssignments.getRole(workspaceEmployee.employee_id),
        };
      }),
    [performanceRecords, roleAssignments, roster, t, team]
  );

  useEffect(() => {
    track("team_viewed", {
      active_employee_count: roster.length,
    });
  }, [roster.length]);

  useEffect(() => {
    let cancelled = false;
    const employeeIds = employeeKey ? employeeKey.split("|") : [];
    void loadSettledRecords(employeeIds, fetchLocalEmployeePerformance).then(
      ({ records, failedIds }) => {
        if (cancelled) return;
        setPerformanceState({
          key: employeeKey,
          records,
          loadError:
            failedIds.length > 0
              ? t("performanceUnavailableFor", {
                  ids: failedIds.join(", "),
                })
              : null,
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [employeeKey, t]);

  function openRoleDialog(
    employeeId: string,
    employeeName: string,
    currentRole: string
  ) {
    const role = roleAssignments.getRole(employeeId) || currentRole;

    track("team_viewed", {
      action: "role_assignment_opened",
      employee_id: employeeId,
      employee_name: employeeName,
    });

    setRoleDraft({
      employeeId,
      employeeName,
      role,
    });
  }

  function saveRoleDraft() {
    if (!roleDraft) return;

    const assignedRole = roleDraft.role.trim();
    roleAssignments.assignRole(roleDraft.employeeId, assignedRole);
    track("team_viewed", {
      action: "role_assignment_saved",
      employee_id: roleDraft.employeeId,
      employee_name: roleDraft.employeeName,
      assigned_role: assignedRole || null,
    });
    setRoleDraft(null);
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              {t("teamDashboardBadge")}
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              {t("teamDashboardTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              {t("teamDashboardDescription")}
            </p>
          </div>
          <Button
            asChild
            className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
          >
            <Link to="/marketplace">{t("hireMore")}</Link>
          </Button>
        </div>

        {team.syncState !== "synced" ? (
          <Alert
            aria-live="polite"
            className="mt-6 rounded-[8px] border-amber-300/25 bg-amber-300/10 text-crew-heading"
          >
            <AlertTitle>
              {team.syncState === "loading"
                ? t("syncingRoster")
                : t("rosterUnavailable")}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {team.syncMessage ?? t("rosterSyncFallback")}
            </AlertDescription>
          </Alert>
        ) : null}

        {performanceLoading || performanceLoadError ? (
          <Alert
            aria-live="polite"
            className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading"
          >
            <AlertTitle>
              {performanceLoading
                ? t("loadingApprovalEvidence")
                : t("approvalEvidenceIncomplete")}
            </AlertTitle>
            <AlertDescription className="text-crew-body">
              {performanceLoadError ?? t("approvalEvidenceLoadingDescription")}
            </AlertDescription>
          </Alert>
        ) : null}

        {rows.length === 0 ? (
          <Card className="mt-10 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="py-10">
              <h2 className="text-2xl font-light">
                {t("noActiveEmployeesTitle")}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                {t("noActiveEmployeesDescription")}
              </p>
              <Button
                asChild
                className="mt-6 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              >
                <Link to="/marketplace">{t("enterMarketplace")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-10 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("employee")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("role")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("responsibility")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("status")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("deliveryApproval")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("evidence")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("version")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      {t("recentActivity")}
                    </TableHead>
                    <TableHead className="px-5 py-4 text-right text-crew-muted">
                      {t("actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(
                    ({
                      assignedRole,
                      doctorReport,
                      approval,
                      name,
                      role,
                      workspaceEmployee,
                    }) => (
                      <TableRow
                        className="border-white/10 hover:bg-white/[0.025]"
                        key={workspaceEmployee.workspace_employee_id}
                      >
                        <TableCell className="px-5 py-5 font-medium text-crew-heading">
                          {name}
                        </TableCell>
                        <TableCell className="px-5 py-5 text-crew-body">
                          {role}
                        </TableCell>
                        <TableCell className="px-5 py-5">
                          {assignedRole ? (
                            <Badge
                              className="max-w-48 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-body"
                              variant="outline"
                            >
                              {assignedRole}
                            </Badge>
                          ) : (
                            <span className="text-sm text-crew-muted">
                              {t("noLongTermRole")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-5 py-5">
                          <HealthBadge
                            status={doctorReport.health_status}
                            t={t}
                          />
                        </TableCell>
                        <TableCell className="px-5 py-5 text-sm text-crew-body">
                          <div className="font-mono text-xs text-crew-heading">
                            {t("completedAccepted", {
                              completed: approval.completion,
                              accepted: approval.accepted,
                            })}
                          </div>
                          <div className="mt-1 text-xs text-crew-muted">
                            {approval.reviews}
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-5">
                          <Badge
                            className={cn(
                              "rounded-[8px] border",
                              approval.evidence === t("noKpiRecord") ||
                                approval.evidence === t("evidenceUnknown")
                                ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
                                : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                            )}
                            variant="outline"
                          >
                            {approval.evidence}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-5 py-5 font-mono text-xs text-crew-muted">
                          v{workspaceEmployee.version}
                        </TableCell>
                        <TableCell className="px-5 py-5 text-crew-body">
                          {formatActivity(
                            workspaceEmployee.hired_at,
                            formatDate
                          )}
                        </TableCell>
                        <TableCell className="px-5 py-5">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              className="rounded-[8px] border-white/15"
                              onClick={() =>
                                openRoleDialog(
                                  workspaceEmployee.employee_id,
                                  name,
                                  role
                                )
                              }
                              variant="outline"
                            >
                              {assignedRole ? t("modifyRole") : t("assignRole")}
                            </Button>
                            <Button
                              className="rounded-[8px] border-white/15"
                              onClick={() => {
                                track("doctor_started", {
                                  employee_id: workspaceEmployee.employee_id,
                                  employee_name: name,
                                });
                                const nextReport = team.getReport(
                                  workspaceEmployee.employee_id
                                );
                                track("doctor_completed", {
                                  employee_id: workspaceEmployee.employee_id,
                                  employee_name: name,
                                  health_status: nextReport.health_status,
                                  issue_count: nextReport.issues.length,
                                  suggestion_count:
                                    nextReport.suggestions.length,
                                });
                                setReport(nextReport);
                                setReportEmployeeName(name);
                              }}
                              variant="outline"
                            >
                              {t("doctor")}
                            </Button>
                            <Button
                              asChild
                              className="rounded-[8px] border-white/15"
                              variant="outline"
                            >
                              <Link
                                to={`/employee/${workspaceEmployee.employee_id}`}
                              >
                                {t("inspect")}
                              </Link>
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  className="rounded-[8px]"
                                  onClick={() => {
                                    setOffboardingMode("export_memory");
                                    track("fire_clicked", {
                                      employee_id:
                                        workspaceEmployee.employee_id,
                                      employee_name: name,
                                    });
                                  }}
                                  variant="destructive"
                                >
                                  {t("fire")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("fireEmployeeTitle", { name })}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="leading-6 text-crew-body">
                                    {t("fireEmployeeDescription")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <RadioGroup
                                  className="gap-2"
                                  onValueChange={value =>
                                    setOffboardingMode(value as OffboardingMode)
                                  }
                                  value={offboardingMode}
                                >
                                  <label className="flex cursor-pointer gap-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
                                    <RadioGroupItem
                                      className="mt-1"
                                      value="export_memory"
                                    />
                                    <span>
                                      <span className="block text-sm font-medium text-crew-heading">
                                        {t("exportMemoryPack")}
                                      </span>
                                      <span className="mt-1 block text-xs leading-5 text-crew-body">
                                        {t("exportMemoryPackDescription")}
                                      </span>
                                    </span>
                                  </label>
                                  <label className="flex cursor-pointer gap-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
                                    <RadioGroupItem
                                      className="mt-1"
                                      value="handoff"
                                    />
                                    <span>
                                      <span className="block text-sm font-medium text-crew-heading">
                                        {t("handOffSuccessor")}
                                      </span>
                                      <span className="mt-1 block text-xs leading-5 text-crew-body">
                                        {t("handOffSuccessorDescription")}
                                      </span>
                                    </span>
                                  </label>
                                  <label className="flex cursor-pointer gap-3 rounded-[8px] border border-red-300/20 bg-red-400/[0.04] p-3">
                                    <RadioGroupItem
                                      className="mt-1"
                                      value="purge"
                                    />
                                    <span>
                                      <span className="block text-sm font-medium text-red-100">
                                        {t("purgeRecallableState")}
                                      </span>
                                      <span className="mt-1 block text-xs leading-5 text-crew-body">
                                        {t("purgeRecallableStateDescription")}
                                      </span>
                                    </span>
                                  </label>
                                </RadioGroup>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-[8px] border-white/15">
                                    {t("keepEmployee")}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="rounded-[8px] bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() => {
                                      void team
                                        .fire(
                                          workspaceEmployee.employee_id,
                                          offboardingMode
                                        )
                                        .then(result => {
                                          track("fire_confirmed", {
                                            employee_id:
                                              workspaceEmployee.employee_id,
                                            employee_name: name,
                                            ok: result.ok,
                                            mode: offboardingMode,
                                          });
                                          if (
                                            result.ok &&
                                            offboardingMode === "handoff"
                                          ) {
                                            navigate(
                                              `/marketplace?handoff_from=${encodeURIComponent(workspaceEmployee.employee_id)}`
                                            );
                                          }
                                        });
                                    }}
                                  >
                                    {t("fireEmployee")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <Dialog
        onOpenChange={open => !open && setReport(null)}
        open={report !== null}
      >
        <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-xl">
          {report ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("doctorReportTitle", { name: reportEmployeeName })}
                </DialogTitle>
                <DialogDescription className="text-crew-body">
                  {t(HEALTH_COPY_KEY[report.health_status])}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-crew-muted">
                    {t("healthStatus")}
                  </span>
                  <HealthBadge status={report.health_status} t={t} />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-crew-heading">
                    {t("issues")}
                  </h3>
                  <ReportList items={report.issues} />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-crew-heading">
                    {t("suggestions")}
                  </h3>
                  <ReportList items={report.suggestions} />
                </div>
                <p className="font-mono text-xs text-crew-muted">
                  {t("checkedAt", {
                    date: formatActivity(report.checked_at, formatDate),
                  })}
                </p>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={open => !open && setRoleDraft(null)}
        open={roleDraft !== null}
      >
        <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-xl">
          {roleDraft ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("assignLongTermRole")}</DialogTitle>
                <DialogDescription className="text-crew-body">
                  {t("roleDraftDescription", {
                    name: roleDraft.employeeName,
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-crew-heading">
                    {t("suggestedResponsibilities")}
                  </label>
                  <Select
                    onValueChange={role =>
                      setRoleDraft(draft =>
                        draft ? { ...draft, role } : draft
                      )
                    }
                    value={
                      roleSuggestions.includes(roleDraft.role)
                        ? roleDraft.role
                        : undefined
                    }
                  >
                    <SelectTrigger className="mt-2 w-full rounded-[8px] border-white/15 bg-white/[0.03] text-crew-heading">
                      <SelectValue
                        placeholder={t("responsibilityPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                      {roleSuggestions.map(role => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label
                    className="text-sm font-medium text-crew-heading"
                    htmlFor="role-draft"
                  >
                    {t("responsibility")}
                  </label>
                  <Input
                    className="mt-2 rounded-[8px] border-white/15 bg-white/[0.03] text-crew-heading placeholder:text-crew-muted"
                    id="role-draft"
                    onChange={event =>
                      setRoleDraft(draft =>
                        draft ? { ...draft, role: event.target.value } : draft
                      )
                    }
                    placeholder={t("responsibilityInputPlaceholder")}
                    value={roleDraft.role}
                  />
                  <p className="mt-2 text-xs leading-5 text-crew-muted">
                    {t("clearResponsibilityHint")}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="rounded-[8px] border-white/15"
                  onClick={() => setRoleDraft(null)}
                  variant="outline"
                >
                  {t("cancel")}
                </Button>
                <Button
                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                  onClick={saveRoleDraft}
                >
                  {t("saveRole")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
