import { z } from "zod";

import { DreamPolicySchema } from "./dream";

// EmployeeSpecSchema — the runtime deep spec (`crewclaw.employee.yaml`), layered ABOVE the hiring
// contract (`hire.yaml`, see ./manifest.ts). Two-file standard, locked in PRD v0.18:
//   hire.yaml              = marketplace/install layer (who to hire, what it needs to run)
//   crewclaw.employee.yaml = runtime layer (how it works, how it is EVALUATED, how it grows)
// The eval_suite + outcome_rubric blocks are required because the Evaluation runner executes
// them to produce the employee's real benchmark score — a spec without them cannot be certified.

const NonEmptyStringSchema = z.string().min(1);
const StringArraySchema = z.array(NonEmptyStringSchema);

// How much an employee needs a tool, and what it is allowed to do with it. These enums are the
// contract the engine will enforce (Phase 3 tool_needs wiring); keep them closed so a typo in a
// spec fails validation instead of silently granting nothing.
const ToolNecessitySchema = z.enum([
  "required",
  "conditional",
  "non_default",
  "disabled",
]);
const ToolPermissionSchema = z.enum([
  "readonly",
  "write",
  "requires_authorization",
  "disabled",
]);

const ToolNeedSchema = z
  .object({
    necessity: ToolNecessitySchema,
    permission: ToolPermissionSchema,
    description: NonEmptyStringSchema,
  })
  .strict();

const SmokeTestSchema = z
  .object({
    id: NonEmptyStringSchema,
    task: NonEmptyStringSchema,
    acceptance: StringArraySchema.min(1),
  })
  .strict();

const RubricEntrySchema = z
  .object({
    id: NonEmptyStringSchema,
    weight: z.number().gt(0).max(1),
    criterion: NonEmptyStringSchema,
  })
  .strict();

export const EmployeeSpecSchema = z
  .object({
    identity: z
      .object({
        id: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
        english_name: NonEmptyStringSchema.optional(),
        avatar: NonEmptyStringSchema,
        author: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
        certification: NonEmptyStringSchema,
        title: NonEmptyStringSchema,
        description: NonEmptyStringSchema,
      })
      .strict(),
    role_contract: z
      .object({
        title: NonEmptyStringSchema,
        mission: NonEmptyStringSchema,
        responsibilities: StringArraySchema.min(1),
        not_responsible_for: StringArraySchema.min(1),
        best_for: StringArraySchema.min(1),
      })
      .strict(),
    soul: z
      .object({
        source: NonEmptyStringSchema,
        working_style: StringArraySchema.min(1),
        communication_style: NonEmptyStringSchema,
        values: StringArraySchema.min(1),
      })
      .strict(),
    deliverables: z
      .array(
        z
          .object({
            type: NonEmptyStringSchema,
            name: NonEmptyStringSchema,
          })
          .strict()
      )
      .min(1),
    tool_needs: z.record(NonEmptyStringSchema, ToolNeedSchema),
    permission_policy: z
      .object({
        default_level: NonEmptyStringSchema,
        levels: z.record(NonEmptyStringSchema, NonEmptyStringSchema),
        grants: z.record(NonEmptyStringSchema, NonEmptyStringSchema),
        denied: z.record(NonEmptyStringSchema, NonEmptyStringSchema),
        human_authorization_required: StringArraySchema,
      })
      .strict(),
    eval_suite: z
      .object({
        smoke_tests: z.array(SmokeTestSchema).min(1),
        grading: z
          .object({
            pass_threshold: z.number().gt(0).max(1),
            required_checks: StringArraySchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    outcome_rubric: z
      .array(RubricEntrySchema)
      .min(1)
      .superRefine((rubric, ctx) => {
        const total = rubric.reduce((sum, entry) => sum + entry.weight, 0);
        // Floating-point tolerance: authors write 0.25+0.25+0.2+0.2+0.1 style splits by hand.
        if (total < 0.99 || total > 1.01) {
          ctx.addIssue({
            code: "custom",
            message: `outcome_rubric weights must sum to 1 (±0.01), got ${total.toFixed(4)}`,
          });
        }
      }),
    compatibility_targets: z.record(
      NonEmptyStringSchema,
      z
        .object({
          level: NonEmptyStringSchema,
          strategy: NonEmptyStringSchema,
        })
        .strict()
    ),
    // Ecosystem extension blocks — meaningful today but not load-bearing for validation or the
    // eval runner; passthrough keeps author freedom while the standard stabilizes.
    playbooks: z.array(z.object({}).passthrough()).optional(),
    failure_playbooks: z.array(z.object({}).passthrough()).optional(),
    memory_seed: z.object({}).passthrough().optional(),
    // M0（条件式 Dream）：dream_policy 收紧为版本化正式 Schema——顶层未知字段拒绝，第三方
    // 实验字段只能进 extensions；legacy after_task/retention 显式收编为 deprecated 字段。
    dream_policy: DreamPolicySchema.optional(),
    workbench_profile: z.object({}).passthrough().optional(),
    runtime_requirements: z.object({}).passthrough().optional(),
    adapter_hints: z.object({}).passthrough().optional(),
  })
  .strict();

export type EmployeeSpec = z.infer<typeof EmployeeSpecSchema>;

// The spec's top-level required keys, exported so packages/runtime/employee-package.mjs's
// REQUIRED_FIELDS list can be asserted against this single source of truth (drift guard).
export const EMPLOYEE_SPEC_REQUIRED_KEYS = [
  "identity",
  "role_contract",
  "soul",
  "deliverables",
  "tool_needs",
  "permission_policy",
  "eval_suite",
  "outcome_rubric",
  "compatibility_targets",
] as const;
