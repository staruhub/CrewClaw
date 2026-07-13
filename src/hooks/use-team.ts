import { useCallback, useEffect, useState } from "react";
import type { DoctorReport, WorkspaceEmployee } from "@contracts/types";
import { getEmployee, type Employee } from "@/data/employees";
import { validateCapabilityGrantTokens } from "@/lib/capability-grants";

const TEAM_STORAGE_KEY = "crewclaw.team.v1";
const WORKSPACE_ID = "local-demo-workspace";
const HIRED_BY = "local-demo-owner";

export type TeamActionResult = {
  ok: boolean;
  message: string;
  employee?: WorkspaceEmployee;
};

function readStoredTeam(): WorkspaceEmployee[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(TEAM_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkspaceEmployee[]) : [];
  } catch {
    return [];
  }
}

function writeStoredTeam(team: WorkspaceEmployee[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(team));
}

function createWorkspaceEmployee(
  employee: Employee,
  capabilityTokens: string[]
): WorkspaceEmployee {
  const now = new Date().toISOString();

  return {
    workspace_employee_id: `${WORKSPACE_ID}:${employee.employee_id}`,
    workspace_id: WORKSPACE_ID,
    employee_id: employee.employee_id,
    version: employee.version,
    status: "active",
    hired_by: HIRED_BY,
    hired_at: now,
    fired_at: null,
    permissions_granted: capabilityTokens,
  };
}

export function useTeam() {
  const [team, setTeam] = useState<WorkspaceEmployee[]>(() => readStoredTeam());

  useEffect(() => {
    writeStoredTeam(team);
  }, [team]);

  const list = useCallback(() => team, [team]);

  const isHired = useCallback(
    (id: string) =>
      team.some(
        employee => employee.employee_id === id && employee.status === "active"
      ),
    [team]
  );

  const hire = useCallback(
    (id: string, grants: string[]): TeamActionResult => {
      if (isHired(id)) {
        const existing = team.find(
          employee =>
            employee.employee_id === id && employee.status === "active"
        );

        return {
          ok: false,
          message: "This employee has already joined your crew.",
          employee: existing,
        };
      }

      const employee = getEmployee(id);
      if (!employee) {
        return {
          ok: false,
          message: "This employee is not available in the marketplace.",
        };
      }
      const validation = validateCapabilityGrantTokens(
        employee.tool_capabilities,
        grants
      );
      if (
        validation.invalidCapabilityTokens.length > 0 ||
        validation.missingRequiredCapabilities.length > 0
      ) {
        return {
          ok: false,
          message:
            "This employee's capability authorization is incomplete or invalid.",
        };
      }
      const nextEmployee = createWorkspaceEmployee(
        employee,
        validation.capabilityTokens
      );

      setTeam(currentTeam => {
        const existingIndex = currentTeam.findIndex(
          employee => employee.employee_id === id
        );

        if (existingIndex === -1) return [...currentTeam, nextEmployee];

        return currentTeam.map((employee, index) =>
          index === existingIndex ? nextEmployee : employee
        );
      });

      return {
        ok: true,
        message: "Your new AI employee has joined the crew.",
        employee: nextEmployee,
      };
    },
    [isHired, team]
  );

  const fire = useCallback((id: string): TeamActionResult => {
    const now = new Date().toISOString();
    let firedEmployee: WorkspaceEmployee | undefined;

    setTeam(currentTeam =>
      currentTeam.map(employee => {
        if (employee.employee_id !== id || employee.status === "fired")
          return employee;

        firedEmployee = {
          ...employee,
          status: "fired",
          fired_at: now,
        };

        return firedEmployee;
      })
    );

    if (!firedEmployee) {
      return {
        ok: false,
        message: "This employee is not active in your crew.",
      };
    }

    return {
      ok: true,
      message: "This employee has left your crew, but history was kept.",
      employee: firedEmployee,
    };
  }, []);

  const getReport = useCallback(
    (id: string): DoctorReport => {
      const workspaceEmployee = team.find(
        employee => employee.employee_id === id
      );
      const employee = getEmployee(id);
      const checkedAt = new Date().toISOString();

      if (!workspaceEmployee || workspaceEmployee.status === "fired") {
        return {
          report_id: `doctor:${id}:${checkedAt}`,
          workspace_employee_id:
            workspaceEmployee?.workspace_employee_id ?? `${WORKSPACE_ID}:${id}`,
          health_status: "broken",
          issues: ["This employee is not active in your crew."],
          suggestions: ["Hire the employee before assigning work."],
          checked_at: checkedAt,
        };
      }

      if (!employee) {
        return {
          report_id: `doctor:${id}:${checkedAt}`,
          workspace_employee_id: workspaceEmployee.workspace_employee_id,
          health_status: "broken",
          issues: ["Marketplace record is missing."],
          suggestions: ["Refresh the marketplace registry and try again."],
          checked_at: checkedAt,
        };
      }

      const validation = validateCapabilityGrantTokens(
        employee.tool_capabilities,
        workspaceEmployee.permissions_granted
      );
      const issues = [
        ...validation.missingRequiredCapabilities.map(
          token => `Missing required capability authorization: ${token}`
        ),
        ...validation.invalidCapabilityTokens.map(
          token => `Invalid capability authorization: ${token}`
        ),
      ];

      return {
        report_id: `doctor:${id}:${checkedAt}`,
        workspace_employee_id: workspaceEmployee.workspace_employee_id,
        health_status: issues.length > 0 ? "warning" : "healthy",
        issues:
          issues.length > 0
            ? issues
            : ["This employee is healthy and ready to work."],
        suggestions:
          issues.length > 0
            ? [
                "Review the capability authorization before assigning more tasks.",
              ]
            : ["Start with a demo task or inspect the employee resume."],
        checked_at: checkedAt,
      };
    },
    [team]
  );

  return {
    hire,
    fire,
    list,
    isHired,
    getReport,
  };
}
