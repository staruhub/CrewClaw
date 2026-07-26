import { z } from "zod";

import { GoodEmployeeStateSchema } from "./certification";

const Sha256Schema = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/);
const DateTimeSchema = z.iso.datetime({ offset: true });

export const EmployeeProofPackSchema = z
  .object({
    contract: z.literal("crewclaw.employee-proof-pack/v1"),
    employee_id: z.string().min(1),
    generated_at: DateTimeSchema,
    visibility: z.enum(["public", "internal"]),
    employee_state: GoodEmployeeStateSchema,
    certification: z
      .object({
        credential_id: z.string().min(1),
        effective_status: z.enum([
          "certified",
          "failed",
          "expired",
          "revoked",
          "stale",
        ]),
        subject_hash: Sha256Schema,
        memory_state_hash: Sha256Schema,
        profile_id: z.string().min(1),
        profile_version: z.string().min(1),
        issued_at: DateTimeSchema,
        expires_at: DateTimeSchema.nullable(),
        signed: z.boolean(),
        verified: z.boolean(),
        sample_size: z.number().int().positive(),
        success_rate: z.number().min(0).max(1),
        success_confidence_low: z.number().min(0).max(1),
        correct_stop_rate: z.number().min(0).max(1),
        evidence_coverage: z.number().min(0).max(1),
        permission_violations: z.number().int().nonnegative(),
        safety_violations: z.number().int().nonnegative(),
        proof_pack_hash: Sha256Schema,
      })
      .strict()
      .nullable(),
    kpi: z
      .object({
        contract: z.literal("crewclaw.kpi/v2"),
        tasks: z.number().int().nonnegative(),
        successful: z.number().int().nonnegative(),
        accepted: z.number().int().nonnegative(),
        auto_accepted: z.number().int().nonnegative(),
        correctly_blocked: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        chat_turns: z.number().int().nonnegative(),
        total_cost: z.number().nonnegative(),
        cost_currency: z.literal("USD"),
        average_duration_ms: z.number().int().nonnegative().nullable(),
        evidence_coverage: z.number().min(0).max(1).nullable(),
        permission_violations: z.number().int().nonnegative(),
        safety_violations: z.number().int().nonnegative(),
        legacy_unclassified_tasks: z.number().int().nonnegative(),
      })
      .strict(),
    task_evidence: z
      .object({
        verified_proofpacks: z.number().int().nonnegative(),
        accepted_receipts: z.number().int().nonnegative(),
        task_receipts: z.array(
          z
            .object({
              task_run_id: z.string().min(1),
              decision: z.enum(["accept", "reject", "none"]),
              proofpack_hash: Sha256Schema,
            })
            .strict()
        ),
      })
      .strict(),
    dream: z
      .object({
        activation_id: z.string().min(1),
        activated_at: DateTimeSchema,
        activated_memory_hash: Sha256Schema,
        recertification_required: z.boolean(),
      })
      .strict()
      .nullable(),
    integrity: z
      .object({
        source_hashes: z.array(
          z
            .object({
              kind: z.enum([
                "kpi",
                "certification",
                "task_proofpack",
                "dream_activation",
              ]),
              ref: z.string().nullable(),
              sha256: Sha256Schema,
            })
            .strict()
        ),
        content_hash: Sha256Schema,
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

export type EmployeeProofPack = z.infer<typeof EmployeeProofPackSchema>;
