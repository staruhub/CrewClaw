import { z } from "zod";

import { MemoryItemV2Schema } from "./dream";

export const MEMORY_PACK_CONTRACT = "crewclaw.memory-pack/v1";
export const OFFBOARDING_RECEIPT_CONTRACT = "crewclaw.offboarding/v1";

const NonEmptyString = z.string().min(1);
const EmployeeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const IsoDateTime = z.iso.datetime({ offset: true });
const Sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const MemoryPackSchema = z
  .object({
    contract: z.literal(MEMORY_PACK_CONTRACT),
    pack_id: NonEmptyString,
    employee_id: EmployeeId,
    workspace_employee_id: NonEmptyString,
    exported_at: IsoDateTime,
    memory_state_hash: Sha256,
    item_count: z.number().int().nonnegative(),
    items: z.array(MemoryItemV2Schema),
    provenance: z
      .object({
        source: z.literal("active_memory"),
        source_sha256: Sha256,
      })
      .strict(),
    integrity: z.object({ content_hash: Sha256 }).strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (pack.item_count !== pack.items.length) {
      ctx.addIssue({
        code: "custom",
        path: ["item_count"],
        message: "item_count must equal items.length",
      });
    }
  });

const ExportResultSchema = z
  .object({
    requested: z.boolean(),
    status: z.enum(["not_requested", "exported", "failed"]),
    pack_id: NonEmptyString.nullable(),
    pack_sha256: Sha256.nullable(),
    relative_path: NonEmptyString.nullable(),
  })
  .strict();

const HandoffResultSchema = z
  .object({
    requested: z.boolean(),
    status: z.enum(["not_requested", "drafted", "failed"]),
    draft_id: NonEmptyString.nullable(),
    successor_employee_id: EmployeeId.nullable(),
  })
  .strict();

const PurgeResultSchema = z
  .object({
    requested: z.boolean(),
    status: z.enum(["not_requested", "purged", "failed"]),
    deleted_scopes: z.array(
      z.enum(["memory", "memory_candidates", "dream", "skill_usage"])
    ),
    retained_audit_scopes: z.array(
      z.enum(["team", "activity", "task_runs", "proofpacks", "kpi", "eval"])
    ),
    media_sanitization: z.literal("not_performed"),
  })
  .strict();

export const OffboardingReceiptSchema = z
  .object({
    contract: z.literal(OFFBOARDING_RECEIPT_CONTRACT),
    offboarding_id: NonEmptyString,
    employee_id: EmployeeId,
    workspace_employee_id: NonEmptyString,
    requested_at: IsoDateTime,
    completed_at: IsoDateTime,
    outcome: z.enum(["completed", "partial"]),
    export_memory: ExportResultSchema,
    handoff: HandoffResultSchema,
    fire: z
      .object({
        status: z.literal("fired"),
        fired_at: IsoDateTime,
        permissions_active: z.literal(false),
      })
      .strict(),
    purge: PurgeResultSchema,
    billing: z
      .object({
        status: z.literal("not_applicable"),
        reason: z.literal("local_runtime_has_no_billing_executor"),
      })
      .strict(),
    warnings: z.array(NonEmptyString),
    integrity: z.object({ content_hash: Sha256 }).strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const exportHasPayload =
      receipt.export_memory.pack_id !== null &&
      receipt.export_memory.pack_sha256 !== null &&
      receipt.export_memory.relative_path !== null;
    if (
      (receipt.export_memory.status === "not_requested" &&
        (receipt.export_memory.requested || exportHasPayload)) ||
      (receipt.export_memory.status === "exported" &&
        (!receipt.export_memory.requested || !exportHasPayload))
    ) {
      context.addIssue({
        code: "custom",
        path: ["export_memory"],
        message: "memory export status does not match its request and payload",
      });
    }

    const handoffHasDraft = receipt.handoff.draft_id !== null;
    if (
      (receipt.handoff.status === "not_requested" &&
        (receipt.handoff.requested ||
          handoffHasDraft ||
          receipt.handoff.successor_employee_id !== null)) ||
      (receipt.handoff.status === "drafted" &&
        (!receipt.handoff.requested || !handoffHasDraft))
    ) {
      context.addIssue({
        code: "custom",
        path: ["handoff"],
        message: "handoff status does not match its request and draft",
      });
    }

    if (
      (receipt.purge.status === "not_requested" &&
        (receipt.purge.requested || receipt.purge.deleted_scopes.length > 0)) ||
      (receipt.purge.status !== "not_requested" && !receipt.purge.requested) ||
      (receipt.purge.status === "purged" &&
        new Set(receipt.purge.deleted_scopes).size !== 4)
    ) {
      context.addIssue({
        code: "custom",
        path: ["purge"],
        message: "purge status does not match its request and deleted scopes",
      });
    }

    if (
      receipt.outcome === "completed" &&
      [
        receipt.export_memory.status,
        receipt.handoff.status,
        receipt.purge.status,
      ].includes("failed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "a completed receipt cannot contain a failed phase",
      });
    }
  });

export type MemoryPack = z.infer<typeof MemoryPackSchema>;
export type OffboardingReceipt = z.infer<typeof OffboardingReceiptSchema>;
