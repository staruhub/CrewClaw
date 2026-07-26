import { useCallback, useEffect, useMemo, useState } from "react";
import type { DoctorReport, WorkspaceEmployee } from "@contracts/types";
import type { OffboardingReceipt } from "@contracts/offboarding";
import { WorkspaceEmployeeSchema, type OffboardingMode } from "@contracts/team";
import { getEmployee } from "@/data/employees";
import { validateCapabilityGrantTokens } from "@/lib/capability-grants";
import {
  fetchLocalTeam,
  fireLocalTeamEmployee,
  hireLocalTeamEmployee,
} from "@/lib/local-api";

const TEAM_STORAGE_KEY = "crewclaw.team.v1";
const WORKSPACE_ID = "local-workspace";

export type TeamActionResult = {
  ok: boolean;
  message: string;
  employee?: WorkspaceEmployee;
  offboardingReceipt?: OffboardingReceipt;
};

export type TeamSyncState = "loading" | "synced" | "error";

function canonicalCachedRecord(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return {
    workspace_employee_id: source.workspace_employee_id,
    employee_id: source.employee_id,
    version: source.version,
    ...(source.package_sha256 !== undefined
      ? { package_sha256: source.package_sha256 }
      : {}),
    ...(source.hire_source !== undefined
      ? { hire_source: source.hire_source }
      : {}),
    status: source.status,
    hired_at: source.hired_at,
    fired_at: source.fired_at ?? null,
    permissions_granted: source.permissions_granted,
  };
}

function readStoredTeam() {
  if (typeof window === "undefined") {
    return { team: [] as WorkspaceEmployee[], warning: null as string | null };
  }
  const raw = window.localStorage.getItem(TEAM_STORAGE_KEY);
  if (!raw) return { team: [], warning: null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const team = parsed
      .map(canonicalCachedRecord)
      .map(item => WorkspaceEmployeeSchema.parse(item));
    return { team, warning: null };
  } catch {
    return {
      team: [] as WorkspaceEmployee[],
      warning:
        "The browser team cache was invalid. CrewClaw will reload the durable local roster.",
    };
  }
}

function writeStoredTeam(team: WorkspaceEmployee[]) {
  if (typeof window === "undefined") return;
  if (team.length === 0) {
    window.localStorage.removeItem(TEAM_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(team));
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The local CrewClaw service is unavailable.";
}

export function useTeam() {
  const cached = useMemo(() => readStoredTeam(), []);
  const [team, setTeam] = useState<WorkspaceEmployee[]>(cached.team);
  const [syncState, setSyncState] = useState<TeamSyncState>("loading");
  const [syncMessage, setSyncMessage] = useState<string | null>(cached.warning);

  useEffect(() => {
    writeStoredTeam(team);
  }, [team]);

  const refresh = useCallback(async () => {
    setSyncState("loading");
    try {
      const response = await fetchLocalTeam();
      setTeam(response.team);
      setSyncState("synced");
      setSyncMessage("Roster synchronized with .crewclaw/team.json.");
      return response.team;
    } catch (error) {
      setSyncState("error");
      setSyncMessage(
        `${errorMessage(error)} The browser cache is read-only until synchronization recovers.`
      );
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchLocalTeam()
      .then(response => {
        if (cancelled) return;
        setTeam(response.team);
        setSyncState("synced");
        setSyncMessage("Roster synchronized with .crewclaw/team.json.");
      })
      .catch(error => {
        if (cancelled) return;
        setSyncState("error");
        setSyncMessage(
          `${errorMessage(error)} The browser cache is read-only until synchronization recovers.`
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = useCallback(() => team, [team]);
  const isHired = useCallback(
    (id: string) =>
      team.some(
        employee => employee.employee_id === id && employee.status === "active"
      ),
    [team]
  );

  const hire = useCallback(
    async (id: string, grants: string[]): Promise<TeamActionResult> => {
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
      setSyncState("loading");
      setSyncMessage("Synchronizing this hire with the local CrewClaw roster…");
      try {
        const response = await hireLocalTeamEmployee({
          employee_id: employee.employee_id,
          version: employee.version,
          permissions_granted: validation.capabilityTokens,
        });
        setTeam(response.team);
        setSyncState("synced");
        setSyncMessage(response.message);
        return {
          ok: true,
          message: response.message,
          employee: response.employee,
        };
      } catch (error) {
        const message = `${errorMessage(error)} No browser-only hire was recorded.`;
        setSyncState("error");
        setSyncMessage(message);
        return { ok: false, message };
      }
    },
    []
  );

  const fire = useCallback(
    async (
      id: string,
      mode: OffboardingMode,
      successorEmployeeId?: string | null
    ): Promise<TeamActionResult> => {
      setSyncState("loading");
      setSyncMessage("Preparing the offboarding receipt…");
      try {
        const response = await fireLocalTeamEmployee(
          id,
          mode,
          successorEmployeeId
        );
        setTeam(response.team);
        setSyncState("synced");
        setSyncMessage(response.message);
        return {
          ok: true,
          message: response.message,
          employee: response.employee,
          offboardingReceipt: response.offboarding_receipt,
        };
      } catch (error) {
        const message = `${errorMessage(error)} The durable roster was not changed unless an offboarding receipt says otherwise.`;
        setSyncState("error");
        setSyncMessage(message);
        return { ok: false, message };
      }
    },
    []
  );

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
            ? ["Review capability authorization before assigning more tasks."]
            : ["Start with a task or inspect the employee resume."],
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
    refresh,
    syncState,
    syncMessage,
  };
}
