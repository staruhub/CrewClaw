import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { DoctorReport, HealthStatus } from "@contracts/types";
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
import { cn } from "@/lib/utils";

const HEALTH_COPY: Record<HealthStatus, string> = {
  healthy: "This employee is healthy and ready to work.",
  warning: "This employee needs your attention before taking more tasks.",
  broken: "This employee cannot work until the issues are resolved.",
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  broken: "Broken",
};

const HEALTH_BADGE_CLASS: Record<HealthStatus, string> = {
  healthy: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-300/35 bg-amber-300/10 text-amber-100",
  broken: "border-red-300/35 bg-red-400/10 text-red-100",
};

const ROLE_SUGGESTIONS = [
  "Code review owner",
  "PRD intake owner",
  "Research scout",
  "Launch readiness owner",
  "On-call doctor",
  "Customer follow-up owner",
];

type RoleDraft = {
  employeeId: string;
  employeeName: string;
  role: string;
};

function formatActivity(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <Badge className={cn("rounded-[8px] border", HEALTH_BADGE_CLASS[status])} variant="outline">
      {HEALTH_LABEL[status]}
    </Badge>
  );
}

function ReportList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-crew-body">
      {items.map((item) => (
        <li className="rounded-[8px] border border-white/10 bg-white/[0.03] px-3 py-2" key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function TeamDashboard() {
  const team = useTeam();
  const roleAssignments = useRoles();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [reportEmployeeName, setReportEmployeeName] = useState<string>("Employee");
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const roster = team.list().filter((employee) => employee.status !== "fired");

  const rows = useMemo(
    () =>
      roster.map((workspaceEmployee) => {
        const employee = getEmployee(workspaceEmployee.employee_id);
        const doctorReport = team.getReport(workspaceEmployee.employee_id);

        return {
          employee,
          workspaceEmployee,
          doctorReport,
          name: employee?.name ?? workspaceEmployee.employee_id,
          role: employee?.role ?? "Unknown role",
          assignedRole: roleAssignments.getRole(workspaceEmployee.employee_id),
        };
      }),
    [roleAssignments, roster, team],
  );

  useEffect(() => {
    track("team_viewed", {
      active_employee_count: roster.length,
    });
  }, [roster.length]);

  function openRoleDialog(employeeId: string, employeeName: string, currentRole: string) {
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
              Team Dashboard
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Your AI crew
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Manage active employees, check their health, inspect resumes, and fire
              employees when they leave the crew.
            </p>
          </div>
          <Button
            asChild
            className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
          >
            <Link to="/marketplace">Hire more</Link>
          </Button>
        </div>

        {rows.length === 0 ? (
          <Card className="mt-10 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="py-10">
              <h2 className="text-2xl font-light">No active AI employees yet.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                Hire a verified employee from the marketplace to start building your
                local demo team.
              </p>
              <Button
                asChild
                className="mt-6 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              >
                <Link to="/marketplace">Enter marketplace</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-10 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="px-5 py-4 text-crew-muted">Employee</TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">Role</TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">Responsibility</TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">Status</TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">Version</TableHead>
                    <TableHead className="px-5 py-4 text-crew-muted">
                      Recent activity
                    </TableHead>
                    <TableHead className="px-5 py-4 text-right text-crew-muted">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ assignedRole, doctorReport, name, role, workspaceEmployee }) => (
                    <TableRow
                      className="border-white/10 hover:bg-white/[0.025]"
                      key={workspaceEmployee.workspace_employee_id}
                    >
                      <TableCell className="px-5 py-5 font-medium text-crew-heading">
                        {name}
                      </TableCell>
                      <TableCell className="px-5 py-5 text-crew-body">{role}</TableCell>
                      <TableCell className="px-5 py-5">
                        {assignedRole ? (
                          <Badge
                            className="max-w-48 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-body"
                            variant="outline"
                          >
                            {assignedRole}
                          </Badge>
                        ) : (
                          <span className="text-sm text-crew-muted">No long-term role</span>
                        )}
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <HealthBadge status={doctorReport.health_status} />
                      </TableCell>
                      <TableCell className="px-5 py-5 font-mono text-xs text-crew-muted">
                        v{workspaceEmployee.version}
                      </TableCell>
                      <TableCell className="px-5 py-5 text-crew-body">
                        {formatActivity(workspaceEmployee.hired_at)}
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            className="rounded-[8px] border-white/15"
                            onClick={() =>
                              openRoleDialog(workspaceEmployee.employee_id, name, role)
                            }
                            variant="outline"
                          >
                            {assignedRole ? "Modify role" : "Assign role"}
                          </Button>
                          <Button
                            className="rounded-[8px] border-white/15"
                            onClick={() => {
                              track("doctor_started", {
                                employee_id: workspaceEmployee.employee_id,
                                employee_name: name,
                              });
                              const nextReport = team.getReport(workspaceEmployee.employee_id);
                              track("doctor_completed", {
                                employee_id: workspaceEmployee.employee_id,
                                employee_name: name,
                                health_status: nextReport.health_status,
                                issue_count: nextReport.issues.length,
                                suggestion_count: nextReport.suggestions.length,
                              });
                              setReport(nextReport);
                              setReportEmployeeName(name);
                            }}
                            variant="outline"
                          >
                            Doctor
                          </Button>
                          <Button asChild className="rounded-[8px] border-white/15" variant="outline">
                            <Link to={`/employee/${workspaceEmployee.employee_id}`}>Inspect</Link>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                className="rounded-[8px]"
                                onClick={() =>
                                  track("fire_clicked", {
                                    employee_id: workspaceEmployee.employee_id,
                                    employee_name: name,
                                  })
                                }
                                variant="destructive"
                              >
                                Fire
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Fire {name}?</AlertDialogTitle>
                                <AlertDialogDescription className="leading-6 text-crew-body">
                                  This employee will leave your crew, but history will be
                                  kept.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-[8px] border-white/15">
                                  Keep employee
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="rounded-[8px] bg-destructive text-white hover:bg-destructive/90"
                                  onClick={() => {
                                    const result = team.fire(workspaceEmployee.employee_id);
                                    track("fire_confirmed", {
                                      employee_id: workspaceEmployee.employee_id,
                                      employee_name: name,
                                      ok: result.ok,
                                    });
                                  }}
                                >
                                  Fire employee
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <Dialog onOpenChange={(open) => !open && setReport(null)} open={report !== null}>
        <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-xl">
          {report ? (
            <>
              <DialogHeader>
                <DialogTitle>{reportEmployeeName} doctor report</DialogTitle>
                <DialogDescription className="text-crew-body">
                  {HEALTH_COPY[report.health_status]}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-crew-muted">Health status</span>
                  <HealthBadge status={report.health_status} />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-crew-heading">Issues</h3>
                  <ReportList items={report.issues} />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-crew-heading">
                    Suggestions
                  </h3>
                  <ReportList items={report.suggestions} />
                </div>
                <p className="font-mono text-xs text-crew-muted">
                  Checked at {formatActivity(report.checked_at)}
                </p>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setRoleDraft(null)} open={roleDraft !== null}>
        <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-xl">
          {roleDraft ? (
            <>
              <DialogHeader>
                <DialogTitle>Assign a long-term role</DialogTitle>
                <DialogDescription className="text-crew-body">
                  Give {roleDraft.employeeName} a standing responsibility in your crew.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-crew-heading">
                    Suggested responsibilities
                  </label>
                  <Select
                    onValueChange={(role) =>
                      setRoleDraft((draft) => (draft ? { ...draft, role } : draft))
                    }
                    value={
                      ROLE_SUGGESTIONS.includes(roleDraft.role) ? roleDraft.role : undefined
                    }
                  >
                    <SelectTrigger className="mt-2 w-full rounded-[8px] border-white/15 bg-white/[0.03] text-crew-heading">
                      <SelectValue placeholder="Choose a common crew responsibility" />
                    </SelectTrigger>
                    <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                      {ROLE_SUGGESTIONS.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-crew-heading" htmlFor="role-draft">
                    Responsibility
                  </label>
                  <Input
                    className="mt-2 rounded-[8px] border-white/15 bg-white/[0.03] text-crew-heading placeholder:text-crew-muted"
                    id="role-draft"
                    onChange={(event) =>
                      setRoleDraft((draft) =>
                        draft ? { ...draft, role: event.target.value } : draft,
                      )
                    }
                    placeholder="Example: Pull request reviewer for release work"
                    value={roleDraft.role}
                  />
                  <p className="mt-2 text-xs leading-5 text-crew-muted">
                    Leave this blank to clear the responsibility.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="rounded-[8px] border-white/15"
                  onClick={() => setRoleDraft(null)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                  onClick={saveRoleDraft}
                >
                  Save role
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
