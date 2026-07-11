// M0 of the conditional-Dream architecture (docs/dream-conditional-design.md): frozen contract
// names and versioned schemas for every Dream/Reflect core artifact. M0 defines shapes only —
// no runtime behavior reads or writes these yet (M1-M4 land together on a feature branch).
//
// Naming rule: a contract string never changes meaning. Breaking changes bump the version suffix
// and add a new schema next to the old one; consumers reject versions they do not support.
import { z } from "zod";

export const MEMORY_ITEM_CONTRACT = "crewclaw.memory-item/v2";
export const REFLECT_CONTRACT = "crewclaw.reflect/v1";
export const DREAM_JOB_CONTRACT = "crewclaw.dream-job/v1";
export const DREAM_CANDIDATE_CONTRACT = "crewclaw.dream-candidate/v1";
export const DREAM_DIFF_CONTRACT = "crewclaw.dream-diff/v1";
export const DREAM_APPROVAL_CONTRACT = "crewclaw.dream-approval/v1";
export const MEMORY_ACTIVATION_CONTRACT = "crewclaw.memory-activation/v1";
export const MEMORY_STATE_HASH_SCHEMA = "crewclaw.memory-state-hash/v1";

const NonEmptyString = z.string().min(1);
const IsoDateTime = z.iso.datetime();
const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/i);
const PrefixedSha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/i);

export const MEMORY_CATEGORIES = [
  "user_prefs",
  "project_facts",
  "successful_toolchains",
  "failure_paths",
  "reliable_sources",
  "verified_sops",
] as const;

const MemoryCategorySchema = z.enum(MEMORY_CATEGORIES);
const ConfidenceSchema = z.enum(["low", "medium", "high"]);

// ── crewclaw.memory-item/v2 ─────────────────────────────────────────────────────────────────
// v1 items (pre-Dream "legacy" entries) carry only {category,text,confidence,savedAt,...}. v2
// adds lifecycle + provenance. The legacy backfill stamps the v2 fields with legacy values; it
// never invents provenance (source_task_ids stays empty, created_by_model stays null).
export const MemoryItemV2Schema = z
  .object({
    category: MemoryCategorySchema,
    text: NonEmptyString.max(2_000),
    confidence: ConfidenceSchema,
    status: z.enum(["active", "superseded", "archived"]),
    source_type: z.enum(["legacy", "dream"]),
    source_task_ids: z.array(NonEmptyString),
    evidence_ids: z.array(NonEmptyString),
    created_by_model: NonEmptyString.nullable(),
    dream_run_id: NonEmptyString.nullable(),
    savedAt: IsoDateTime.optional(),
    valid_until: IsoDateTime.nullable().optional(),
    supersedes: NonEmptyString.nullable().optional(),
    sensitive: z.boolean().optional(),
    ephemeral: z.boolean().optional(),
  })
  .strict();

// ── crewclaw.reflect/v1 ─────────────────────────────────────────────────────────────────────
// An IMMUTABLE task work log extracted deterministically (no model call). Reflect records what
// verifiably happened; it never infers cross-task rules — that judgment belongs to Dream.
export const ReflectionSchema = z
  .object({
    contract: z.literal(REFLECT_CONTRACT),
    task_id: NonEmptyString,
    employee_id: NonEmptyString,
    outcome: z.enum([
      "accepted",
      "rejected",
      "revision_needed",
      "failed",
      "blocked",
    ]),
    output_valid: z.boolean(),
    accepted_artifact_ids: z.array(NonEmptyString),
    evidence_ids: z.array(NonEmptyString),
    verified_failures: z.array(
      z
        .object({
          code: NonEmptyString,
          tool: NonEmptyString.optional(),
          verification: z.enum([
            "doctor_confirmed",
            "outcome_grader",
            "deterministic_test",
          ]),
        })
        .strict()
    ),
    user_feedback: z.object({ useful: z.boolean().nullable() }).strict(),
    tool_stats: z
      .array(
        z
          .object({
            tool_name: NonEmptyString,
            status: NonEmptyString.optional(),
            decision: NonEmptyString.optional(),
          })
          .strict()
      )
      .optional(),
    cost_usd: z.number().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    created_at: IsoDateTime,
  })
  .strict();

// ── dream_policy（EmployeeSpec 内嵌）────────────────────────────────────────────────────────
// Top-level unknown keys are REJECTED; third-party experiments go in `extensions` only.
// `after_task`/`retention` are the pre-M0 legacy shape still consumed by the per-task Dream
// prompt (packages/runtime/dream.mjs safeDreamPolicy). Deprecated: M1 migrates their intent
// into input_policy and removes them in a later spec version.
export const DreamPolicySchema = z
  .object({
    mode: z.enum(["recommended", "manual", "disabled"]).optional(),
    triggers: z
      .object({
        min_accepted_tasks: z.number().int().positive().optional(),
        memory_pressure_ratio: z.number().min(0).max(1).optional(),
        duplicate_ratio: z.number().min(0).max(1).optional(),
        stale_ratio: z.number().min(0).max(1).optional(),
        conflict_count: z.number().int().nonnegative().optional(),
        repeat_task_count: z.number().int().positive().optional(),
        recommendation_score: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    eligibility: z
      .object({
        trusted_input_ratio: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        memory_budget_tokens: z.number().int().positive().optional(),
        max_model_cost_usd: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    input_policy: z
      .object({
        guidance: z.array(NonEmptyString).optional(),
        retention: NonEmptyString.optional(),
        forbid_sensitive: z.boolean().optional(),
      })
      .strict()
      .optional(),
    promotion_policy: z
      .object({
        require_baseline: z.boolean().optional(),
        require_candidate_eval: z.boolean().optional(),
      })
      .strict()
      .optional(),
    cooldown: z
      .object({
        hours: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        // default 32; hard ceiling 100 (mirrors the Anthropic Dreams input bound)
        max_batch_tasks: z.number().int().positive().max(100).optional(),
      })
      .strict()
      .optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
    /** @deprecated pre-M0 shape; consumed by safeDreamPolicy until M1 migrates it. */
    after_task: z.array(NonEmptyString).optional(),
    /** @deprecated pre-M0 shape; consumed by safeDreamPolicy until M1 migrates it. */
    retention: NonEmptyString.optional(),
  })
  .strict();

// ── crewclaw.dream-diff/v1 ──────────────────────────────────────────────────────────────────
export const DreamDiffEntrySchema = z
  .object({
    op: z.enum(["add", "merge", "replace", "drop", "keep"]),
    reason: NonEmptyString.max(1_000),
    confidence: ConfidenceSchema,
    source_task_ids: z.array(NonEmptyString),
    evidence_ids: z.array(NonEmptyString),
    // the resulting item for add/merge/replace/keep; absent for drop
    item: MemoryItemV2Schema.optional(),
    // stable keys (category + normalized text) of the active items this entry consumes
    replaces: z.array(NonEmptyString).optional(),
  })
  .strict();

export const DreamDiffSchema = z
  .object({
    contract: z.literal(DREAM_DIFF_CONTRACT),
    entries: z.array(DreamDiffEntrySchema),
  })
  .strict();

// ── crewclaw.dream-candidate/v1 ─────────────────────────────────────────────────────────────
// A candidate store is a complete, self-contained memory set. It is NEVER read by recall; only
// an approved activation swaps it in atomically.
export const DreamCandidateSchema = z
  .object({
    contract: z.literal(DREAM_CANDIDATE_CONTRACT),
    dream_run_id: NonEmptyString,
    base_memory_hash: PrefixedSha256,
    candidate_memory_hash: PrefixedSha256,
    items: z.array(MemoryItemV2Schema),
    created_at: IsoDateTime,
  })
  .strict();

// ── crewclaw.dream-approval/v1 ──────────────────────────────────────────────────────────────
export const DreamApprovalSchema = z
  .object({
    contract: z.literal(DREAM_APPROVAL_CONTRACT),
    dream_run_id: NonEmptyString,
    decision: z.enum(["approve", "reject", "rollback"]),
    decided_by: NonEmptyString,
    decided_at: IsoDateTime,
    base_memory_hash: PrefixedSha256,
    candidate_memory_hash: PrefixedSha256.nullable(),
    receipt_sha256: Sha256Hex.optional(),
  })
  .strict();

// ── crewclaw.memory-activation/v1 ───────────────────────────────────────────────────────────
export const MemoryActivationSchema = z
  .object({
    contract: z.literal(MEMORY_ACTIVATION_CONTRACT),
    activation_id: NonEmptyString,
    dream_run_id: NonEmptyString,
    employee_id: NonEmptyString,
    previous_memory_hash: PrefixedSha256,
    activated_memory_hash: PrefixedSha256,
    archived_to: NonEmptyString,
    activated_at: IsoDateTime,
  })
  .strict();

// ── crewclaw.dream-job/v1 ───────────────────────────────────────────────────────────────────
export const DREAM_JOB_STATES = [
  "COLLECTING",
  "RECOMMENDED",
  "QUEUED",
  "DREAMING",
  "VALIDATING",
  "REVIEW_REQUIRED",
  "ACTIVE",
  "REJECTED",
  "FAILED",
  "ROLLED_BACK",
] as const;

export const DreamJobSchema = z
  .object({
    contract: z.literal(DREAM_JOB_CONTRACT),
    dream_id: NonEmptyString,
    employee_id: NonEmptyString,
    model: NonEmptyString.nullable(),
    created_at: IsoDateTime,
    state: z.enum(DREAM_JOB_STATES),
    base_memory_hash: PrefixedSha256,
    candidate_memory_hash: PrefixedSha256.nullable(),
    input: z
      .object({
        task_run_ids: z.array(NonEmptyString),
        reflection_ids: z.array(NonEmptyString),
        evidence_ids: z.array(NonEmptyString),
        // hash of the input snapshot so a base-store change during review marks the job stale
        input_snapshot_hash: PrefixedSha256,
      })
      .strict(),
    cost: z
      .object({
        estimated_usd: z.number().nonnegative(),
        actual_usd: z.number().nonnegative().nullable(),
      })
      .strict(),
    diff: DreamDiffSchema.optional(),
    validation: z
      .object({
        schema_ok: z.boolean(),
        provenance_ok: z.boolean(),
        safety_ok: z.boolean(),
        critic_ok: z.boolean(),
        eval: z
          .object({
            score: z.number().min(0).max(100),
            baseline_score: z.number().min(0).max(100),
            passed: z.boolean(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    approval: DreamApprovalSchema.optional(),
  })
  .strict();

export type MemoryItemV2 = z.infer<typeof MemoryItemV2Schema>;
export type Reflection = z.infer<typeof ReflectionSchema>;
export type DreamPolicy = z.infer<typeof DreamPolicySchema>;
export type DreamJob = z.infer<typeof DreamJobSchema>;
export type DreamCandidate = z.infer<typeof DreamCandidateSchema>;
export type DreamDiff = z.infer<typeof DreamDiffSchema>;
export type DreamApproval = z.infer<typeof DreamApprovalSchema>;
export type MemoryActivation = z.infer<typeof MemoryActivationSchema>;
