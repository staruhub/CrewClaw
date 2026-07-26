export type RuntimeEmployeeProofPack = {
  contract: "crewclaw.employee-proof-pack/v1";
  employee_id: string;
  generated_at: string;
  visibility: "public" | "internal";
  employee_state: {
    package_status: "draft" | "validated" | "invalid";
    lab_status:
      | "untested"
      | "running"
      | "certified"
      | "failed"
      | "expired"
      | "revoked"
      | "stale";
    field_status: "insufficient" | "pilot" | "proven";
    derived_level: "C0" | "C1" | "C2" | "C3";
  };
  certification: null | {
    credential_id: string;
    profile_id: string;
    sample_size: number;
    success_rate: number;
    success_confidence_low: number;
    correct_stop_rate: number;
    evidence_coverage: number;
  };
  integrity: { content_hash: string };
  warnings: string[];
};

export function buildEmployeeProofPack(
  root: string,
  employeeId: string,
  options?: {
    specRoot?: string;
    visibility?: "public" | "internal";
    generatedAt?: string;
  }
): RuntimeEmployeeProofPack;
