import { z } from "zod";
import {
  AcceptedTaskProjectionSchema,
  VerifiedEmployeeReviewSchema,
} from "./local-review";

export const LocalKpiProjectionSchema = z
  .object({
    state: z.enum(["available", "absent", "invalid"]),
    contract: z.literal("crewclaw.kpi/v2").nullable(),
    tasks: z.number().int().nonnegative().nullable(),
    successful: z.number().int().nonnegative().nullable(),
    completed: z.number().int().nonnegative().nullable(),
    accepted: z.number().int().nonnegative().nullable(),
    auto_accepted: z.number().int().nonnegative().nullable(),
    correctly_blocked: z.number().int().nonnegative().nullable(),
    rejected: z.number().int().nonnegative().nullable(),
    revision_requested: z.number().int().nonnegative().nullable(),
    failed: z.number().int().nonnegative().nullable(),
    chat_turns: z.number().int().nonnegative().nullable(),
    artifact_actions: z.number().int().nonnegative().nullable(),
    total_cost: z.number().nonnegative().nullable(),
    cost_currency: z.literal("USD").nullable(),
    average_cost: z.number().nonnegative().nullable(),
    average_duration_ms: z.number().int().nonnegative().nullable(),
    evidence_coverage: z.number().min(0).max(1).nullable(),
    permission_violations: z.number().int().nonnegative().nullable(),
    safety_violations: z.number().int().nonnegative().nullable(),
    first_hired_at: z.number().int().nonnegative().nullable(),
    outcomes_count: z.number().int().nonnegative().nullable(),
    legacy_unclassified_tasks: z.number().int().nonnegative().nullable(),
    legacy_accepted_claims: z.number().int().nonnegative().nullable(),
    legacy_total_cost: z.number().nonnegative().nullable(),
  })
  .strict();

export const LocalEvaluationProjectionSchema = z
  .object({
    state: z.enum(["available", "absent", "invalid"]),
    score: z.number().int().min(0).max(100).nullable(),
    verdict: z.enum(["PASS", "FAIL"]).nullable(),
    mock: z.boolean().nullable(),
    certified: z.literal(false),
    model: z.string().nullable(),
    evaluated_at: z.number().int().positive().nullable(),
  })
  .strict();

export const LocalEmployeeProofPackProjectionSchema = z
  .object({
    state: z.enum(["available", "invalid"]),
    generated_at: z.string().nullable(),
    evidence_level: z.enum(["C0", "C1", "C2", "C3"]).nullable(),
    package_status: z.enum(["draft", "validated", "invalid"]).nullable(),
    lab_status: z
      .enum([
        "untested",
        "running",
        "certified",
        "failed",
        "expired",
        "revoked",
        "stale",
      ])
      .nullable(),
    field_status: z.enum(["insufficient", "pilot", "proven"]).nullable(),
    credential_id: z.string().nullable(),
    profile_id: z.string().nullable(),
    sample_size: z.number().int().positive().nullable(),
    success_rate: z.number().min(0).max(1).nullable(),
    success_confidence_low: z.number().min(0).max(1).nullable(),
    correct_stop_rate: z.number().min(0).max(1).nullable(),
    evidence_coverage: z.number().min(0).max(1).nullable(),
    content_hash: z.string().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export const LocalEmployeePerformanceSchema = z
  .object({
    employee_id: z.string(),
    kpi: LocalKpiProjectionSchema,
    evaluation: LocalEvaluationProjectionSchema,
    proof_pack: LocalEmployeeProofPackProjectionSchema,
    accepted_tasks: z.array(AcceptedTaskProjectionSchema),
    verified_reviews: z.array(VerifiedEmployeeReviewSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export type LocalKpiProjection = z.infer<typeof LocalKpiProjectionSchema>;
export type LocalEvaluationProjection = z.infer<
  typeof LocalEvaluationProjectionSchema
>;
export type LocalEmployeeProofPackProjection = z.infer<
  typeof LocalEmployeeProofPackProjectionSchema
>;
export type LocalEmployeePerformance = z.infer<
  typeof LocalEmployeePerformanceSchema
>;
