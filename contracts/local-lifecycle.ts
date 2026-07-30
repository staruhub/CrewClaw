import { z } from "zod";

const EmployeeIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const NonEmptyStringSchema = z.string().min(1);

export const DoctorCheckSchema = z
  .object({
    name: NonEmptyStringSchema,
    ok: z.boolean(),
    detail: NonEmptyStringSchema,
  })
  .strict();

export const LocalDoctorResultSchema = z
  .object({
    contract: z.literal("crewclaw.local-doctor/v1"),
    employee_id: EmployeeIdSchema,
    status: z.enum(["healthy", "warning", "broken"]),
    checks: z.array(DoctorCheckSchema),
    missing: z.array(NonEmptyStringSchema),
    impact: NonEmptyStringSchema,
    fixes: z.array(NonEmptyStringSchema),
    allow_degrade: z.boolean(),
    degraded_level: z
      .string()
      .regex(/^L[0-4]$/)
      .nullable(),
    capability_resolution: z.array(
      z
        .object({
          capability: NonEmptyStringSchema,
          runtime_tool: NonEmptyStringSchema.nullable(),
          availability: NonEmptyStringSchema,
          reason: NonEmptyStringSchema,
          authorization: NonEmptyStringSchema,
          timeout_ms: z.number().int().positive().nullable(),
        })
        .strict()
    ),
    checked_at: z.iso.datetime(),
  })
  .strict();

export const RunLocalDoctorRequestSchema = z
  .object({
    permissions_granted: z.array(NonEmptyStringSchema).max(256),
  })
  .strict();

export const RunLocalTrialRequestSchema = z
  .object({
    permissions_granted: z.array(NonEmptyStringSchema).max(256),
    goal: NonEmptyStringSchema.max(8_192),
  })
  .strict();

export const LocalTrialResultSchema = z
  .object({
    contract: z.literal("crewclaw.local-trial/v1"),
    employee_id: EmployeeIdSchema,
    task_run_id: NonEmptyStringSchema,
    status: z.enum(["delivered", "accepted", "rejected", "failed", "blocked"]),
    artifact_id: NonEmptyStringSchema.nullable(),
    evidence_count: z.number().int().nonnegative(),
    tool_invocations: z.number().int().nonnegative(),
    doctor_status: z.enum(["healthy", "warning", "broken"]),
    next_action: z.enum(["approve_trial", "hire_employee", "fix_doctor"]),
  })
  .strict();

export const DecideLocalTrialRequestSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
  })
  .strict();

export const HireFromLocalTrialRequestSchema = z
  .object({
    employee_id: EmployeeIdSchema,
    version: NonEmptyStringSchema,
    permissions_granted: z.array(NonEmptyStringSchema).max(256),
    trial_task_run_id: NonEmptyStringSchema,
  })
  .strict();

export type LocalDoctorResult = z.infer<typeof LocalDoctorResultSchema>;
export type LocalTrialResult = z.infer<typeof LocalTrialResultSchema>;
