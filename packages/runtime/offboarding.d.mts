export type RuntimeOffboardingMode = "export_memory" | "handoff" | "purge";

export type RuntimeHandoffDraft = {
  contract: "crewclaw.offboarding-handoff/v1";
  draft_id: string;
  employee_id: string;
  workspace_employee_id: string;
  successor_employee_id: string | null;
  memory_pack_id: string;
  created_at: string;
  state: "draft";
  next_action: "open_market_with_prefilled_role_contract";
  integrity: { content_hash: string };
};

export type RuntimeOffboardingResult = {
  receipt: unknown;
  receipt_path: string;
  memory_pack: unknown;
  handoff: RuntimeHandoffDraft | null;
  employee: unknown;
  team: unknown;
};

export function offboardEmployee(
  root: string,
  employeeId: string,
  options?: {
    mode?: RuntimeOffboardingMode;
    successorEmployeeId?: string | null;
    now?: () => string;
    id?: () => string;
  }
): RuntimeOffboardingResult;
