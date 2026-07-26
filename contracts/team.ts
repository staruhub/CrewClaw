import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);
const DateTimeSchema = z.iso.datetime();

export const WorkspaceEmployeeStatusSchema = z.enum([
  "active",
  "warning",
  "broken",
  "fired",
]);

/**
 * Canonical on-disk `.crewclaw/team.json` record.
 *
 * Keep this shape byte-for-byte compatible with
 * `crates/crewclaw-cli/src/team.rs::WorkspaceEmployee`. Browser-only identity
 * fields must not leak into the workspace state file.
 */
export const WorkspaceEmployeeSchema = z
  .object({
    workspace_employee_id: NonEmptyStringSchema,
    employee_id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid employee id"),
    version: NonEmptyStringSchema,
    package_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    hire_source: z.enum(["website", "cli", "eval_harness"]).optional(),
    status: WorkspaceEmployeeStatusSchema,
    hired_at: DateTimeSchema,
    fired_at: DateTimeSchema.nullable(),
    permissions_granted: z.array(NonEmptyStringSchema),
  })
  .strict();

export const TeamRosterSchema = z.array(WorkspaceEmployeeSchema).max(1_024);

export const HireEmployeeRequestSchema = z
  .object({
    employee_id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid employee id"),
    version: NonEmptyStringSchema,
    permissions_granted: z.array(NonEmptyStringSchema).max(256),
  })
  .strict();

export const FireEmployeeRequestSchema = z
  .object({
    employee_id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid employee id"),
  })
  .strict();

export const OffboardingModeSchema = z.enum([
  "export_memory",
  "handoff",
  "purge",
]);

export const OffboardEmployeeRequestSchema = z
  .object({
    employee_id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid employee id"),
    mode: OffboardingModeSchema.default("export_memory"),
    successor_employee_id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid successor employee id")
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.mode !== "handoff" &&
      request.successor_employee_id !== undefined &&
      request.successor_employee_id !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["successor_employee_id"],
        message: "successor_employee_id is only valid for handoff mode",
      });
    }
  });

export type WorkspaceEmployee = z.infer<typeof WorkspaceEmployeeSchema>;
export type WorkspaceEmployeeStatus = z.infer<
  typeof WorkspaceEmployeeStatusSchema
>;
export type HireEmployeeRequest = z.infer<typeof HireEmployeeRequestSchema>;
export type FireEmployeeRequest = z.infer<typeof FireEmployeeRequestSchema>;
export type OffboardingMode = z.infer<typeof OffboardingModeSchema>;
export type OffboardEmployeeRequest = z.infer<
  typeof OffboardEmployeeRequestSchema
>;
