import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import generatedEmployees from "../../src/data/employees.generated.json";
import {
  HireEmployeeRequestSchema,
  OffboardEmployeeRequestSchema,
  TeamRosterSchema,
  WorkspaceEmployeeSchema,
  type WorkspaceEmployee,
} from "../../contracts/team";
import { OffboardingReceiptSchema } from "../../contracts/offboarding";
import { offboardEmployee } from "../../packages/runtime/offboarding.mjs";
import {
  LocalEmployeePerformanceSchema,
  type LocalEmployeePerformance,
} from "../../contracts/local-performance";
import { validateCapabilityGrantTokens } from "../../contracts/capability-grants";
import { getEmployeePackage } from "./pack-employee";
import {
  readStateFile,
  withStateOwnerLock,
  writeStateFileAtomic,
} from "./local-state";

const EmployeeCatalogEntrySchema = z
  .object({
    employee_id: z.string(),
    version: z.string(),
    status: z.literal("published"),
    tool_capabilities: z.array(
      z
        .object({
          capability: z.string(),
          necessity: z.string(),
          permission: z.string(),
        })
        .passthrough()
    ),
  })
  .passthrough();

const catalog = new Map(
  z
    .array(EmployeeCatalogEntrySchema)
    .parse(generatedEmployees.employees)
    .map(employee => [employee.employee_id, employee])
);

export class LocalTeamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 | 500 = 400,
    readonly code = "LOCAL_TEAM_ERROR"
  ) {
    super(message);
  }
}

export type LocalTeamOptions = {
  root?: string;
  packageRoot?: string;
  production?: boolean;
};

function roots(options: LocalTeamOptions = {}) {
  return {
    root: resolve(options.root ?? process.env.CREWCLAW_ROOT ?? process.cwd()),
    packageRoot: resolve(options.packageRoot ?? process.cwd()),
    production: options.production ?? process.env.NODE_ENV === "production",
  };
}

function migrateLegacyRecord(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return {
    workspace_employee_id: source.workspace_employee_id,
    employee_id: source.employee_id,
    version: source.version,
    ...(source.package_sha256 !== undefined
      ? { package_sha256: source.package_sha256 }
      : {}),
    // Pre-hire_source writers persisted an explicit `null`; the contract models "unknown
    // origin" as an absent field, so both null and undefined must migrate to omission.
    ...(source.hire_source != null ? { hire_source: source.hire_source } : {}),
    status: source.status,
    hired_at: source.hired_at,
    fired_at: source.fired_at ?? null,
    permissions_granted: source.permissions_granted,
  };
}

export async function readLocalTeam(
  options: LocalTeamOptions = {}
): Promise<WorkspaceEmployee[]> {
  const { root } = roots(options);
  const bytes = await readStateFile(root, "team.json");
  if (!bytes) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new LocalTeamError(
      "The local team file is not valid JSON. Repair .crewclaw/team.json before hiring.",
      422,
      "TEAM_JSON_INVALID"
    );
  }
  if (!Array.isArray(parsed)) {
    throw new LocalTeamError(
      "The local team file must contain an array.",
      422,
      "TEAM_SCHEMA_INVALID"
    );
  }
  const result = TeamRosterSchema.safeParse(parsed.map(migrateLegacyRecord));
  if (!result.success) {
    throw new LocalTeamError(
      "The local team file does not match the CrewClaw team contract.",
      422,
      "TEAM_SCHEMA_INVALID"
    );
  }
  for (const employeeId of new Set(result.data.map(item => item.employee_id))) {
    if (
      result.data.filter(
        item => item.employee_id === employeeId && item.status === "active"
      ).length > 1
    ) {
      throw new LocalTeamError(
        `Multiple active team records exist for ${employeeId}.`,
        422,
        "DUPLICATE_ACTIVE_EMPLOYEE"
      );
    }
  }
  return result.data;
}

async function writeLocalTeam(
  team: WorkspaceEmployee[],
  options: LocalTeamOptions
) {
  const { root } = roots(options);
  const canonical = TeamRosterSchema.parse(team);
  await writeStateFileAtomic(
    root,
    "team.json",
    Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`, "utf8")
  );
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function hireLocalEmployee(
  inputValue: unknown,
  options: LocalTeamOptions = {}
) {
  const input = HireEmployeeRequestSchema.parse(inputValue);
  const employee = catalog.get(input.employee_id);
  if (!employee) {
    throw new LocalTeamError(
      "This employee is not available in the local marketplace.",
      404,
      "EMPLOYEE_UNAVAILABLE"
    );
  }
  if (employee.version !== input.version) {
    throw new LocalTeamError(
      `The marketplace version is ${employee.version}; refresh before hiring.`,
      409,
      "EMPLOYEE_VERSION_MISMATCH"
    );
  }
  const grants = validateCapabilityGrantTokens(
    employee.tool_capabilities,
    input.permissions_granted
  );
  if (
    grants.invalidCapabilityTokens.length > 0 ||
    grants.missingRequiredCapabilities.length > 0
  ) {
    throw new LocalTeamError(
      "Capability authorization is incomplete or contains undeclared grants.",
      422,
      "CAPABILITY_GRANTS_INVALID"
    );
  }

  const resolved = roots(options);
  let pkg;
  try {
    pkg = await getEmployeePackage(resolved.packageRoot, input.employee_id, {
      production: resolved.production,
    });
  } catch {
    throw new LocalTeamError(
      "The verified local employee package is unavailable. Rebuild packages and try again.",
      500,
      "EMPLOYEE_PACKAGE_UNAVAILABLE"
    );
  }
  if (pkg.version !== employee.version || !/^[a-f0-9]{64}$/.test(pkg.sha256)) {
    throw new LocalTeamError(
      "The local employee package does not match the marketplace contract.",
      409,
      "EMPLOYEE_PACKAGE_MISMATCH"
    );
  }

  return withStateOwnerLock(resolved.root, "team.json", async () => {
    const team = await readLocalTeam(options);
    const active = team.find(
      item => item.employee_id === input.employee_id && item.status === "active"
    );
    if (active) {
      if (
        active.version !== employee.version ||
        !sameStrings(active.permissions_granted, grants.capabilityTokens)
      ) {
        throw new LocalTeamError(
          "This employee is already active with a different version or authorization. Fire it before rehiring.",
          409,
          "ACTIVE_EMPLOYEE_CONFLICT"
        );
      }
      if (active.package_sha256 && active.package_sha256 !== pkg.sha256) {
        throw new LocalTeamError(
          "The active employee package checksum differs from the marketplace package.",
          409,
          "ACTIVE_PACKAGE_DRIFT"
        );
      }
      if (!active.package_sha256 || !active.hire_source) {
        const migrated = WorkspaceEmployeeSchema.parse({
          ...active,
          package_sha256: pkg.sha256,
          hire_source: active.hire_source ?? "website",
        });
        const next = team.map(item =>
          item.workspace_employee_id === active.workspace_employee_id
            ? migrated
            : item
        );
        await writeLocalTeam(next, options);
        return {
          team: next,
          employee: migrated,
          created: false,
          migrated: true,
          message:
            "Employee was already active; its legacy team record was verified and synchronized.",
        };
      }
      return {
        team,
        employee: active,
        created: false,
        migrated: false,
        message: "Employee is already active and synchronized.",
      };
    }

    const now = new Date().toISOString();
    const record = WorkspaceEmployeeSchema.parse({
      workspace_employee_id: `${input.employee_id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      employee_id: input.employee_id,
      version: employee.version,
      package_sha256: pkg.sha256,
      hire_source: "website",
      status: "active",
      hired_at: now,
      fired_at: null,
      permissions_granted: grants.capabilityTokens,
    });
    const next = [...team, record];
    await writeLocalTeam(next, options);
    return {
      team: next,
      employee: record,
      created: true,
      migrated: false,
      message:
        "Employee joined the crew and was synchronized to .crewclaw/team.json.",
    };
  });
}

export async function fireLocalEmployee(
  inputValue: unknown,
  options: LocalTeamOptions = {}
) {
  const input = OffboardEmployeeRequestSchema.parse(inputValue);
  const resolved = roots(options);
  let result;
  try {
    result = offboardEmployee(resolved.root, input.employee_id, {
      mode: input.mode,
      successorEmployeeId: input.successor_employee_id ?? null,
    });
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException)?.code || "");
    if (code === "OFFBOARDING_ACTIVE_EMPLOYEE_NOT_FOUND") {
      throw new LocalTeamError(
        "This employee is not active in the local crew.",
        404,
        code
      );
    }
    if (code === "OFFBOARDING_EMPLOYMENT_CHANGED") {
      throw new LocalTeamError(
        "The employee changed while offboarding was being prepared. Refresh and try again.",
        409,
        code
      );
    }
    if (
      code === "OFFBOARDING_INVALID_REQUEST" ||
      code === "OFFBOARDING_MEMORY_INVALID" ||
      code === "OFFBOARDING_TEAM_INVALID"
    ) {
      throw new LocalTeamError(
        error instanceof Error ? error.message : "Offboarding was rejected.",
        422,
        code
      );
    }
    throw new LocalTeamError(
      "The local offboarding transaction could not be completed.",
      500,
      code || "OFFBOARDING_FAILED"
    );
  }
  const team = TeamRosterSchema.parse(result.team);
  const employee = WorkspaceEmployeeSchema.parse(result.employee);
  const receipt = OffboardingReceiptSchema.parse(result.receipt);
  const message =
    receipt.outcome === "partial"
      ? "Employee left the crew, but one post-fire cleanup step needs attention. Review the offboarding receipt."
      : input.mode === "handoff"
        ? "Employee left the crew; a memory pack and successor handoff draft were created."
        : input.mode === "purge"
          ? "Employee left the crew; recallable local state was logically purged and audit history was kept."
          : "Employee left the crew; a transferable memory pack and audit history were kept.";
  return {
    team,
    employee,
    changed: true,
    message,
    offboarding_receipt: receipt,
    handoff: result.handoff,
  };
}

function absentPerformance(employeeId: string): LocalEmployeePerformance {
  return LocalEmployeePerformanceSchema.parse({
    employee_id: employeeId,
    kpi: {
      state: "absent",
      contract: null,
      tasks: null,
      successful: null,
      completed: null,
      accepted: null,
      auto_accepted: null,
      correctly_blocked: null,
      rejected: null,
      revision_requested: null,
      failed: null,
      chat_turns: null,
      artifact_actions: null,
      total_cost: null,
      cost_currency: null,
      average_cost: null,
      average_duration_ms: null,
      evidence_coverage: null,
      permission_violations: null,
      safety_violations: null,
      first_hired_at: null,
      outcomes_count: null,
      legacy_unclassified_tasks: null,
      legacy_accepted_claims: null,
      legacy_total_cost: null,
    },
    evaluation: {
      state: "absent",
      score: null,
      verdict: null,
      mock: null,
      certified: false,
      model: null,
      evaluated_at: null,
    },
    proof_pack: {
      state: "invalid",
      generated_at: null,
      evidence_level: null,
      package_status: null,
      lab_status: null,
      field_status: null,
      credential_id: null,
      profile_id: null,
      sample_size: null,
      success_rate: null,
      success_confidence_low: null,
      correct_stop_rate: null,
      evidence_coverage: null,
      content_hash: null,
      warnings: [],
    },
    accepted_tasks: [],
    verified_reviews: [],
    warnings: [],
  });
}

function parseKpi(value: unknown) {
  const legacySchema = z
    .object({
      tasks: z.number().int().nonnegative(),
      accepted: z.number().int().nonnegative(),
      total_cost: z.number().nonnegative(),
      first_hired_ts: z.number().int().nonnegative().nullable(),
    })
    .passthrough()
    .superRefine((kpi, context) => {
      if (kpi.accepted > kpi.tasks) {
        context.addIssue({ code: "custom", message: "accepted exceeds tasks" });
      }
    });
  if ((value as { contract?: unknown })?.contract !== "crewclaw.kpi/v2") {
    const legacy = legacySchema.parse(value);
    return {
      contract: "crewclaw.kpi/v2" as const,
      tasks: 0,
      successful: 0,
      completed: 0,
      accepted: 0,
      auto_accepted: 0,
      correctly_blocked: 0,
      rejected: 0,
      revision_requested: 0,
      failed: 0,
      chat_turns: 0,
      artifact_actions: 0,
      total_cost: 0,
      cost_currency: "USD" as const,
      average_cost: 0,
      average_duration_ms: null,
      evidence_coverage: null,
      permission_violations: 0,
      safety_violations: 0,
      first_hired_at: legacy.first_hired_ts,
      outcomes_count: 0,
      legacy_unclassified_tasks: legacy.tasks,
      legacy_accepted_claims: legacy.accepted,
      legacy_total_cost: legacy.total_cost,
    };
  }
  const outcomeSchema = z
    .object({
      id: z.string().min(1),
      task_run_id: z.string().min(1),
      task_kind: z.enum(["formal", "chat", "artifact_action"]),
      outcome: z.enum([
        "completed",
        "accepted",
        "auto_accepted",
        "rejected",
        "revision_requested",
        "correctly_blocked",
        "failed",
      ]),
      acceptance_source: z.enum(["user", "policy", "none"]),
      cost_usd: z.number().nonnegative(),
      duration_ms: z.number().nonnegative(),
      evidence_count: z.number().int().nonnegative(),
      permission_violations: z.number().int().nonnegative(),
      safety_violations: z.number().int().nonnegative(),
      ts: z.number().nonnegative(),
    })
    .strict()
    .superRefine((outcome, context) => {
      if (
        (outcome.outcome === "accepted" &&
          outcome.acceptance_source !== "user") ||
        (outcome.outcome === "auto_accepted" &&
          outcome.acceptance_source !== "policy") ||
        (!["accepted", "auto_accepted"].includes(outcome.outcome) &&
          outcome.acceptance_source !== "none")
      ) {
        context.addIssue({
          code: "custom",
          message: "acceptance provenance mismatch",
        });
      }
    });
  const document = z
    .object({
      contract: z.literal("crewclaw.kpi/v2"),
      employee_id: z.string().min(1),
      first_hired_ts: z.number().int().nonnegative().nullable(),
      legacy: z
        .object({
          unclassified_tasks: z.number().int().nonnegative(),
          accepted_claims: z.number().int().nonnegative(),
          total_cost: z.number().nonnegative(),
        })
        .strict(),
      outcomes: z.array(outcomeSchema),
    })
    .strict()
    .superRefine((document, context) => {
      const ids = new Set<string>();
      const taskIds = new Set<string>();
      document.outcomes.forEach((outcome, index) => {
        if (ids.has(outcome.id) || taskIds.has(outcome.task_run_id)) {
          context.addIssue({
            code: "custom",
            path: ["outcomes", index],
            message: "duplicate KPI settlement",
          });
        }
        ids.add(outcome.id);
        taskIds.add(outcome.task_run_id);
      });
    })
    .parse(value);
  const formal = document.outcomes.filter(
    outcome => outcome.task_kind === "formal"
  );
  const count = (name: (typeof formal)[number]["outcome"]) =>
    formal.filter(outcome => outcome.outcome === name).length;
  const totalCost = document.outcomes.reduce(
    (sum, outcome) => sum + outcome.cost_usd,
    0
  );
  const totalDuration = formal.reduce(
    (sum, outcome) => sum + outcome.duration_ms,
    0
  );
  return {
    contract: document.contract,
    tasks: formal.length,
    successful: formal.filter(outcome =>
      ["completed", "accepted", "auto_accepted", "correctly_blocked"].includes(
        outcome.outcome
      )
    ).length,
    completed: count("completed"),
    accepted: count("accepted"),
    auto_accepted: count("auto_accepted"),
    correctly_blocked: count("correctly_blocked"),
    rejected: count("rejected"),
    revision_requested: count("revision_requested"),
    failed: count("failed"),
    chat_turns: document.outcomes.filter(
      outcome => outcome.task_kind === "chat"
    ).length,
    artifact_actions: document.outcomes.filter(
      outcome => outcome.task_kind === "artifact_action"
    ).length,
    total_cost: Math.round(totalCost * 1e6) / 1e6,
    cost_currency: "USD" as const,
    average_cost: document.outcomes.length
      ? Math.round((totalCost / document.outcomes.length) * 1e6) / 1e6
      : 0,
    average_duration_ms: formal.length
      ? Math.round(totalDuration / formal.length)
      : null,
    evidence_coverage: formal.length
      ? formal.filter(outcome => outcome.evidence_count > 0).length /
        formal.length
      : null,
    permission_violations: document.outcomes.reduce(
      (sum, outcome) => sum + outcome.permission_violations,
      0
    ),
    safety_violations: document.outcomes.reduce(
      (sum, outcome) => sum + outcome.safety_violations,
      0
    ),
    first_hired_at: document.first_hired_ts,
    outcomes_count: document.outcomes.length,
    legacy_unclassified_tasks: document.legacy.unclassified_tasks,
    legacy_accepted_claims: document.legacy.accepted_claims,
    legacy_total_cost: document.legacy.total_cost,
  };
}

function parseEvaluation(value: unknown, employeeId: string) {
  const schema = z
    .object({
      agent_id: z.string(),
      score: z.number().int().min(0).max(100),
      verdict: z.enum(["PASS", "FAIL"]),
      pass_threshold: z.number().min(0).max(1),
      model: z.string().min(1),
      graded_by: z.enum(["mechanical", "model"]),
      mock: z.boolean(),
      evaluated_at: z.number().int().positive(),
      per_test: z
        .array(
          z.object({
            score: z.number().int().min(0).max(100),
            passed: z.boolean(),
          })
        )
        .min(1),
    })
    .passthrough();
  const result = schema.parse(value);
  const expectedScore = Math.round(
    result.per_test.reduce((sum, test) => sum + test.score, 0) /
      result.per_test.length
  );
  const expectedVerdict =
    result.per_test.every(test => test.passed) &&
    result.score >= result.pass_threshold * 100
      ? "PASS"
      : "FAIL";
  if (
    result.agent_id !== employeeId ||
    expectedScore !== result.score ||
    expectedVerdict !== result.verdict ||
    (result.mock && result.graded_by !== "mechanical") ||
    (!result.mock && result.graded_by !== "model")
  ) {
    throw new Error("evaluation evidence is inconsistent");
  }
  return result;
}

export async function readLocalEmployeePerformance(
  employeeId: string,
  options: LocalTeamOptions = {}
): Promise<LocalEmployeePerformance> {
  if (!catalog.has(employeeId)) {
    throw new LocalTeamError("Unknown employee.", 404, "EMPLOYEE_UNAVAILABLE");
  }
  const { root, packageRoot } = roots(options);
  const projection = absentPerformance(employeeId);
  const warnings: string[] = [];

  const kpiBytes = await readStateFile(
    root,
    `kpi/${employeeId}.json`,
    1024 * 1024
  );
  if (kpiBytes) {
    try {
      const kpi = parseKpi(JSON.parse(kpiBytes.toString("utf8")));
      projection.kpi = {
        state: "available",
        ...kpi,
      };
    } catch {
      projection.kpi.state = "invalid";
      warnings.push("The local KPI file is invalid and was not projected.");
    }
  }

  const evalBytes = await readStateFile(
    root,
    `eval/${employeeId}.json`,
    1024 * 1024
  );
  if (evalBytes) {
    try {
      const evaluation = parseEvaluation(
        JSON.parse(evalBytes.toString("utf8")),
        employeeId
      );
      projection.evaluation = {
        state: "available",
        score: evaluation.score,
        verdict: evaluation.verdict,
        mock: evaluation.mock,
        certified: false,
        model: evaluation.model,
        evaluated_at: evaluation.evaluated_at,
      };
    } catch {
      projection.evaluation.state = "invalid";
      warnings.push(
        "The local evaluation file is invalid and was not projected."
      );
    }
  }
  try {
    const proofPackModule =
      await import("../../packages/runtime/employee-proofpack.mjs");
    const pack = proofPackModule.buildEmployeeProofPack(root, employeeId, {
      specRoot: packageRoot,
      visibility: "public",
    });
    projection.proof_pack = {
      state: "available",
      generated_at: pack.generated_at,
      evidence_level: pack.employee_state.derived_level,
      package_status: pack.employee_state.package_status,
      lab_status: pack.employee_state.lab_status,
      field_status: pack.employee_state.field_status,
      credential_id: pack.certification?.credential_id ?? null,
      profile_id: pack.certification?.profile_id ?? null,
      sample_size: pack.certification?.sample_size ?? null,
      success_rate: pack.certification?.success_rate ?? null,
      success_confidence_low:
        pack.certification?.success_confidence_low ?? null,
      correct_stop_rate: pack.certification?.correct_stop_rate ?? null,
      evidence_coverage: pack.certification?.evidence_coverage ?? null,
      content_hash: pack.integrity.content_hash,
      warnings: pack.warnings,
    };
  } catch {
    warnings.push(
      "The employee Proof Pack could not be built from local evidence."
    );
  }
  const reviewState = await import("./local-reviews").then(module =>
    module.readVerifiedReviewState(employeeId, options)
  );
  projection.accepted_tasks = reviewState.accepted_tasks;
  projection.verified_reviews = reviewState.verified_reviews;
  projection.warnings = warnings;
  return LocalEmployeePerformanceSchema.parse(projection);
}
