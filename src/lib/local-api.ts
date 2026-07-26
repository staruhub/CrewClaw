import type { LocalEmployeePerformance } from "@contracts/local-performance";
import type { OffboardingReceipt } from "@contracts/offboarding";
import type { OffboardingMode, WorkspaceEmployee } from "@contracts/team";

type TeamMutationResponse = {
  team: WorkspaceEmployee[];
  employee: WorkspaceEmployee;
  message: string;
  offboarding_receipt?: OffboardingReceipt;
  handoff?: {
    draft_id: string;
    successor_employee_id: string | null;
    next_action: string;
  } | null;
};

async function localJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;
  if (!response.ok) {
    throw new Error(
      body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
        ? body.error
        : `Local CrewClaw API failed (${response.status}).`
    );
  }
  if (!body) throw new Error("Local CrewClaw API returned an empty response.");
  return body as T;
}

export async function fetchLocalTeam() {
  return localJson<{ team: WorkspaceEmployee[]; source: string }>(
    "/api/local/team"
  );
}

export async function hireLocalTeamEmployee(input: {
  employee_id: string;
  version: string;
  permissions_granted: string[];
}) {
  return localJson<TeamMutationResponse>("/api/local/team/hire", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CrewClaw-Local": "1",
    },
    body: JSON.stringify(input),
  });
}

export async function fireLocalTeamEmployee(
  employeeId: string,
  mode: OffboardingMode,
  successorEmployeeId?: string | null
) {
  return localJson<TeamMutationResponse>("/api/local/team/fire", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CrewClaw-Local": "1",
    },
    body: JSON.stringify({
      employee_id: employeeId,
      mode,
      ...(successorEmployeeId
        ? { successor_employee_id: successorEmployeeId }
        : {}),
    }),
  });
}

export async function fetchLocalEmployeePerformance(employeeId: string) {
  return localJson<LocalEmployeePerformance>(
    `/api/local/employees/${encodeURIComponent(employeeId)}/performance`
  );
}

export async function submitLocalVerifiedReview(
  employeeId: string,
  input: { task_run_id: string; rating: number; text: string }
) {
  return localJson<{
    review: LocalEmployeePerformance["verified_reviews"][number];
    verified_reviews: LocalEmployeePerformance["verified_reviews"];
    accepted_tasks: LocalEmployeePerformance["accepted_tasks"];
  }>(`/api/local/employees/${encodeURIComponent(employeeId)}/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CrewClaw-Local": "1",
    },
    body: JSON.stringify(input),
  });
}
