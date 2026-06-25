import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);
const StringArraySchema = z.array(NonEmptyStringSchema);

export const EmployeeManifestSchema = z
  .object({
    apiVersion: z.literal("crewclaw/v1"),
    kind: z.literal("Employee"),
    metadata: z
      .object({
        id: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
        mascot: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
        certification: NonEmptyStringSchema,
        published_by: NonEmptyStringSchema,
        creator: NonEmptyStringSchema,
      })
      .strict(),
    identity: z
      .object({
        title: NonEmptyStringSchema,
        description: NonEmptyStringSchema,
        reports_to: NonEmptyStringSchema,
        location: NonEmptyStringSchema,
      })
      .strict(),
    soul: NonEmptyStringSchema,
    skills: StringArraySchema,
    tools: StringArraySchema,
    permissions: StringArraySchema,
    requires: z
      .object({
        hermes: NonEmptyStringSchema,
        runtime: NonEmptyStringSchema,
        env: StringArraySchema,
      })
      .strict(),
    examples: z
      .object({
        inputs: StringArraySchema,
        outputs: StringArraySchema,
      })
      .strict(),
    limitations: StringArraySchema,
    sla: z
      .object({
        response_time: NonEmptyStringSchema,
        availability: NonEmptyStringSchema,
        escalation: NonEmptyStringSchema,
      })
      .strict(),
    lifecycle: z
      .object({
        hireable: z.boolean(),
        fireable: z.boolean(),
        trial_period: NonEmptyStringSchema,
      })
      .strict(),
    pricing: NonEmptyStringSchema.optional(),
    categories: StringArraySchema.optional(),
    tags: StringArraySchema.optional(),
    demo_tasks: StringArraySchema.optional(),
    changelog: StringArraySchema.optional(),
    support_url: z.string().url().optional(),
    safety_notes: StringArraySchema.optional(),
    runtime: z
      .object({
        entry: z.object({}).passthrough().optional(),
        permissions: z.array(z.object({}).passthrough()).optional(),
        demo_tasks: z
          .array(
            z
              .object({
                id: NonEmptyStringSchema,
                title: z.string().optional(),
                input: z.object({}).passthrough().optional(),
                output_schema: z.object({}).passthrough().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

export type EmployeeManifest = z.infer<typeof EmployeeManifestSchema>;
