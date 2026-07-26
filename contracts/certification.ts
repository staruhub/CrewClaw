import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);
const RatioSchema = z.number().finite().min(0).max(1);
const Sha256Schema = z
  .string()
  .regex(/^(?:sha256:)?[a-f0-9]{64}$/, "expected a SHA-256 identifier");
const DateTimeSchema = z.iso.datetime({ offset: true });

export const PackageStatusSchema = z.enum(["draft", "validated", "invalid"]);
export const LabCertificationStatusSchema = z.enum([
  "untested",
  "running",
  "certified",
  "failed",
  "expired",
  "revoked",
  "stale",
]);
export const FieldEvidenceStatusSchema = z.enum([
  "insufficient",
  "pilot",
  "proven",
]);

export const GoodEmployeeStateSchema = z
  .object({
    contract: z.literal("crewclaw.good-employee-state/v1"),
    package_status: PackageStatusSchema,
    lab_status: LabCertificationStatusSchema,
    field_status: FieldEvidenceStatusSchema,
    derived_level: z.enum(["C0", "C1", "C2", "C3"]),
    reason: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const expected =
      state.field_status === "proven"
        ? "C3"
        : state.lab_status === "certified"
          ? "C2"
          : state.package_status === "validated"
            ? "C1"
            : "C0";
    if (state.derived_level !== expected) {
      context.addIssue({
        code: "custom",
        path: ["derived_level"],
        message: `derived_level must be ${expected} for the supplied evidence state`,
      });
    }
  });

export const CertificationPolicySchema = z
  .object({
    package_status: PackageStatusSchema,
    lab_status: LabCertificationStatusSchema,
    field_status: FieldEvidenceStatusSchema,
    profile_refs: z.array(NonEmptyStringSchema).min(1),
    self_tests_are_certification: z.literal(false),
  })
  .strict();

export const CertificationCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    category: z.enum([
      "capability",
      "quality",
      "failure",
      "safety",
      "economics",
    ]),
    task: NonEmptyStringSchema,
    acceptance: z.array(NonEmptyStringSchema).min(1),
    repetitions: z.number().int().min(1).max(20).optional(),
    expected_terminal: z
      .enum(["completed", "blocked", "rejected"])
      .default("completed"),
    hard_gate: z.boolean().default(false),
    visibility: z.enum(["public", "authority"]).default("public"),
    required_evidence: z.array(NonEmptyStringSchema).default([]),
    budget: z
      .object({
        max_cost: z.number().finite().nonnegative().optional(),
        max_duration_ms: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const CertificationProfileSchema = z
  .object({
    contract: z.literal("crewclaw.certification-profile/v1"),
    profile_id: z.string().regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    role_id: NonEmptyStringSchema,
    authority: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    runtime: z
      .object({
        adapter: NonEmptyStringSchema,
        minimum_version: NonEmptyStringSchema.optional(),
        required_level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
      })
      .strict(),
    execution: z
      .object({
        repetitions: z.number().int().min(1).max(20),
        independent_judge_required: z.boolean(),
        mock_allowed: z.literal(false),
      })
      .strict(),
    thresholds: z
      .object({
        min_total_runs: z.number().int().positive(),
        min_overall_success_rate: RatioSchema,
        min_case_success_rate: RatioSchema,
        min_evidence_coverage: RatioSchema,
        min_correct_stop_rate: RatioSchema,
        max_permission_violations: z.number().int().nonnegative(),
        max_safety_violations: z.number().int().nonnegative(),
        max_p95_cost: z.number().finite().nonnegative().optional(),
        max_p95_duration_ms: z.number().int().positive().optional(),
      })
      .strict(),
    cases: z.array(CertificationCaseSchema).min(1),
    holdout: z
      .object({
        mode: z.enum(["public", "authority-owned", "mixed"]),
        dream_access: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    const ids = new Set<string>();
    let expectedRuns = 0;
    profile.cases.forEach((testCase, index) => {
      if (ids.has(testCase.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `duplicate certification case id: ${testCase.id}`,
        });
      }
      ids.add(testCase.id);
      expectedRuns += testCase.repetitions ?? profile.execution.repetitions;
    });
    if (profile.thresholds.min_total_runs > expectedRuns) {
      context.addIssue({
        code: "custom",
        path: ["thresholds", "min_total_runs"],
        message: `min_total_runs exceeds the ${expectedRuns} configured runs`,
      });
    }
  });

const CertificationMetricsSchema = z
  .object({
    success_rate: RatioSchema,
    success_confidence_low: RatioSchema,
    success_confidence_high: RatioSchema,
    correct_stop_rate: RatioSchema,
    evidence_coverage: RatioSchema,
    cost_p50: z.number().finite().nonnegative(),
    cost_p95: z.number().finite().nonnegative(),
    duration_p50_ms: z.number().finite().nonnegative(),
    duration_p95_ms: z.number().finite().nonnegative(),
    cost_currency: z.literal("USD").default("USD"),
  })
  .strict();

const CertificationEvidenceRefSchema = z
  .object({
    kind: z.enum([
      "artifact",
      "source_url",
      "runtime_terminal",
      "stop_reason",
      "runtime_cost",
      "task_event",
    ]),
    ref: NonEmptyStringSchema,
    sha256: Sha256Schema.nullable(),
  })
  .strict();

const CertificationCheckSchema = z
  .object({
    criterion: NonEmptyStringSchema,
    passed: z.boolean(),
    reason: z.string(),
  })
  .strict();

const CertificationRunReceiptSchema = z
  .object({
    receipt_id: NonEmptyStringSchema,
    case_id: NonEmptyStringSchema,
    repetition: z.number().int().positive(),
    passed: z.boolean(),
    terminal: z.enum(["completed", "blocked", "rejected", "failed"]),
    expected_terminal: z.enum(["completed", "blocked", "rejected"]),
    score: z.number().finite().min(0).max(100),
    evidence_coverage: RatioSchema,
    permission_violations: z.number().int().nonnegative(),
    safety_violations: z.number().int().nonnegative(),
    cost: z.number().finite().nonnegative(),
    cost_source: z.enum(["runtime_estimate", "unknown"]),
    duration_ms: z.number().finite().nonnegative(),
    evidence: z.array(CertificationEvidenceRefSchema),
    checks: z.array(CertificationCheckSchema).min(1),
    mock: z.literal(false),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.passed && receipt.cost_source === "unknown") {
      context.addIssue({
        code: "custom",
        path: ["cost_source"],
        message: "a passing certification run requires runtime cost evidence",
      });
    }
  });

export const CertificationCredentialSchema = z
  .object({
    contract: z.literal("crewclaw.certification-credential/v1"),
    credential_id: NonEmptyStringSchema,
    employee_id: NonEmptyStringSchema,
    subject_hash: Sha256Schema,
    memory_state_hash: Sha256Schema,
    status: z.enum(["certified", "failed", "expired", "revoked", "stale"]),
    profile: z
      .object({
        id: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
        hash: Sha256Schema,
      })
      .strict(),
    runtime: z
      .object({
        adapter: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
        capability_level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
        endpoint_id: Sha256Schema.nullable(),
      })
      .strict(),
    execution: z
      .object({
        worker_model: NonEmptyStringSchema,
        judge_model: NonEmptyStringSchema,
        independent_judge: z.boolean(),
      })
      .strict(),
    issued_at: DateTimeSchema,
    expires_at: DateTimeSchema.nullable(),
    mock: z.literal(false),
    sample_size: z.number().int().positive(),
    metrics: CertificationMetricsSchema,
    hard_gates: z
      .object({
        passed: z.boolean(),
        permission_violations: z.number().int().nonnegative(),
        safety_violations: z.number().int().nonnegative(),
        failures: z.array(NonEmptyStringSchema),
      })
      .strict(),
    runs: z.array(CertificationRunReceiptSchema).min(1),
    proof_pack_hash: Sha256Schema,
    issuer: z
      .object({
        id: NonEmptyStringSchema,
        key_id: NonEmptyStringSchema,
        algorithm: z.literal("Ed25519"),
        public_key: NonEmptyStringSchema,
        signature: NonEmptyStringSchema,
      })
      .strict()
      .nullable(),
    status_reason: NonEmptyStringSchema.nullable(),
  })
  .strict()
  .superRefine((credential, context) => {
    if (credential.sample_size !== credential.runs.length) {
      context.addIssue({
        code: "custom",
        path: ["sample_size"],
        message: "sample_size must equal runs.length",
      });
    }
    if (credential.status === "certified") {
      if (!credential.hard_gates.passed) {
        context.addIssue({
          code: "custom",
          path: ["hard_gates", "passed"],
          message: "a certified credential must pass every hard gate",
        });
      }
      if (!credential.issuer) {
        context.addIssue({
          code: "custom",
          path: ["issuer"],
          message: "a certified credential must be signed",
        });
      }
    }
  });

export type CertificationProfile = z.infer<typeof CertificationProfileSchema>;
export type CertificationCredential = z.infer<
  typeof CertificationCredentialSchema
>;
export type GoodEmployeeState = z.infer<typeof GoodEmployeeStateSchema>;
