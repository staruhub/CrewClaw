import { readFileSync } from "node:fs";
import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);

export const ToolInvocationSchema = z.enum(["model", "engine", "adapter"]);
export const ToolOperationSchema = z.enum(["read", "write", "send", "execute"]);
export const ToolRiskTierSchema = z.enum(["P0", "P1", "P2", "P3", "P4"]);

export const ToolProviderBindingSchema = z
  .object({
    provider: NonEmptyStringSchema,
    tools: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ToolCapabilitySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    invocation: ToolInvocationSchema,
    operation: ToolOperationSchema,
    risk_tier: ToolRiskTierSchema,
    runtime_tool: NonEmptyStringSchema.nullable(),
    provider_bindings: z.array(ToolProviderBindingSchema),
    side_effects: z.array(NonEmptyStringSchema),
    supports_preview: z.boolean(),
    idempotent: z.boolean(),
    timeout_ms: z.number().int().positive().max(300_000),
    error_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).min(1),
  })
  .strict()
  .superRefine((capability, ctx) => {
    if (capability.invocation === "model" && capability.runtime_tool === null) {
      ctx.addIssue({
        code: "custom",
        path: ["runtime_tool"],
        message: "model capability requires a runtime_tool",
      });
    }
    if (
      capability.invocation === "adapter" &&
      capability.provider_bindings.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["provider_bindings"],
        message: "adapter capability requires a provider binding",
      });
    }
    if (
      capability.risk_tier === "P4" &&
      ["write", "send", "execute"].includes(capability.operation) &&
      capability.side_effects.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["side_effects"],
        message: "P4 mutating capability must declare side effects",
      });
    }
    if (
      capability.runtime_tool === null &&
      capability.provider_bindings.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["provider_bindings"],
        message: "capability must have a runtime_tool or provider binding",
      });
    }
    if (
      capability.operation === "read" &&
      capability.side_effects.length > 0 &&
      capability.risk_tier === "P0"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["risk_tier"],
        message: "side-effecting reads cannot be P0",
      });
    }
  });

export const ToolCatalogSchema = z
  .object({
    $schema: NonEmptyStringSchema.optional(),
    schema_version: z.literal("crewclaw.tool-catalog/v1"),
    catalog_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    capabilities: z.array(ToolCapabilitySchema).min(1),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const [index, capability] of catalog.capabilities.entries()) {
      if (seen.has(capability.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["capabilities", index, "id"],
          message: `duplicate capability id: ${capability.id}`,
        });
      }
      seen.add(capability.id);
    }
  });

const rawCatalog = JSON.parse(
  readFileSync(new URL("./tool-catalog.json", import.meta.url), "utf8")
) as unknown;

export const TOOL_CATALOG = ToolCatalogSchema.parse(rawCatalog);
export const TOOL_CAPABILITIES = new Map(
  TOOL_CATALOG.capabilities.map(capability => [capability.id, capability])
);
export const TOOL_CAPABILITY_IDS = new Set(TOOL_CAPABILITIES.keys());

export function getToolCapability(id: string) {
  return TOOL_CAPABILITIES.get(id);
}

export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;
export type ToolCatalog = z.infer<typeof ToolCatalogSchema>;
