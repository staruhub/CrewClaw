import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import generatedEmployees from "../../src/data/employees.generated.json";
import {
  DecideLocalTrialRequestSchema,
  HireFromLocalTrialRequestSchema,
  LocalDoctorResultSchema,
  LocalTrialResultSchema,
  RunLocalDoctorRequestSchema,
  RunLocalTrialRequestSchema,
  type LocalDoctorResult,
  type LocalTrialResult,
} from "../../contracts/local-lifecycle";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import { loadEmployeePackage } from "../../packages/runtime/employee-package.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as DoctorRuntime from "../../packages/runtime/doctor.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as EmployeeToolsRuntime from "../../packages/runtime/employee-tools.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import { makeGateway } from "../../packages/runtime/tool-gateway.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as TaskStateRuntime from "../../packages/runtime/task-state.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as ArtifactStoreRuntime from "../../packages/runtime/artifact-store.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as EvidenceStoreRuntime from "../../packages/runtime/evidence-store.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import * as ReflectRuntime from "../../packages/runtime/reflect.mjs";
// @ts-expect-error Plain-Node runtime modules are pinned by runtime contract tests.
import { recordTaskOutcome } from "../../packages/runtime/kpi.mjs";
import { hireLocalEmployee } from "./local-team";

const { onboardingDoctor, packageDoctor } = DoctorRuntime;
const { loadToolCatalog, resolveEmployeeTools } = EmployeeToolsRuntime;
const { addEvent, loadTaskRun, newTaskRun, saveTaskRun, transition } =
  TaskStateRuntime;
const { markAccepted, newArtifact, saveArtifact } = ArtifactStoreRuntime;
const { addEvidence, loadEvidence, newEvidenceCard } = EvidenceStoreRuntime;
const { buildReflection, writeReflection } = ReflectRuntime;

type LifecycleOptions = {
  root?: string;
  packageRoot?: string;
  env?: NodeJS.ProcessEnv;
};

type RuntimeRegistry = {
  TOOLS: Record<string, unknown>;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ) => Promise<string>;
};

type CatalogEmployee = {
  employee_id: string;
  local_source: string | null;
};

const employeeCatalog = new Map(
  (generatedEmployees.employees as CatalogEmployee[]).map(employee => [
    employee.employee_id,
    employee,
  ])
);

export class LocalLifecycleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 | 500 = 400,
    readonly code = "LOCAL_LIFECYCLE_ERROR"
  ) {
    super(message);
  }
}

function roots(options: LifecycleOptions = {}) {
  return {
    root: resolve(options.root ?? process.env.CREWCLAW_ROOT ?? process.cwd()),
    packageRoot: resolve(options.packageRoot ?? process.cwd()),
    env: options.env ?? process.env,
  };
}

function packageForEmployee(
  employeeId: string,
  options: LifecycleOptions = {}
) {
  const employee = employeeCatalog.get(employeeId);
  if (!employee?.local_source) {
    throw new LocalLifecycleError(
      "This employee has no runnable local package.",
      404,
      "EMPLOYEE_PACKAGE_UNAVAILABLE"
    );
  }
  const { packageRoot } = roots(options);
  const source = resolve(packageRoot, employee.local_source);
  if (!source.startsWith(`${packageRoot}${sep}`)) {
    throw new LocalLifecycleError(
      "The employee package path is outside the installation.",
      422,
      "EMPLOYEE_PACKAGE_UNSAFE"
    );
  }
  const loaded = loadEmployeePackage(resolve(source, "crewclaw.employee.yaml"));
  if (!loaded.ok) {
    throw new LocalLifecycleError(
      `Employee package validation failed: ${(loaded.errors ?? []).join("; ")}`,
      422,
      "EMPLOYEE_PACKAGE_INVALID"
    );
  }
  return loaded.package;
}

async function loadRuntimeRegistry(
  options: LifecycleOptions = {}
): Promise<RuntimeRegistry> {
  const { packageRoot } = roots(options);
  const moduleUrl = pathToFileURL(
    resolve(packageRoot, "packages/runtime/run.mjs")
  ).href;
  // Vite's dev SSR transformer cannot statically analyze a file URL, while the production
  // bundle deliberately leaves this runtime boundary external. The URL is constructed only
  // from the trusted package root above.
  const loaded = (await import(
    /* @vite-ignore */ moduleUrl
  )) as Partial<RuntimeRegistry>;
  if (!loaded.TOOLS || typeof loaded.runTool !== "function") {
    throw new LocalLifecycleError(
      "The runtime tool registry is unavailable.",
      500,
      "RUNTIME_REGISTRY_UNAVAILABLE"
    );
  }
  return loaded as RuntimeRegistry;
}

async function resolveLifecycleTools(
  employeeId: string,
  permissionsGranted: string[],
  options: LifecycleOptions = {}
) {
  const { packageRoot, env } = roots(options);
  const runtime = await loadRuntimeRegistry(options);
  const pkg = packageForEmployee(employeeId, options);
  const catalog = loadToolCatalog(packageRoot);
  const toolResolution = resolveEmployeeTools({
    catalog,
    toolSchemas: runtime.TOOLS,
    toolNeeds: pkg.tool_needs ?? {},
    grants: permissionsGranted,
    configuredProviders: [],
    env,
    surface: "task",
  });
  return { pkg, catalog, runtime, toolResolution };
}

export async function runLocalDoctor(
  employeeId: string,
  inputValue: unknown,
  options: LifecycleOptions = {}
): Promise<LocalDoctorResult> {
  const input = RunLocalDoctorRequestSchema.parse(inputValue);
  const { env } = roots(options);
  const { pkg, catalog, runtime, toolResolution } = await resolveLifecycleTools(
    employeeId,
    input.permissions_granted,
    options
  );
  const packageResult = packageDoctor(pkg);
  const onboarding = onboardingDoctor(pkg, env, {
    catalog,
    toolSchemas: runtime.TOOLS,
    grants: input.permissions_granted,
    toolResolution,
    surface: "task",
  });
  const result =
    packageResult.status === "broken"
      ? {
          ...packageResult,
          checks: [...packageResult.checks, ...onboarding.checks],
          missing: [...packageResult.missing, ...onboarding.missing],
          fixes: [...packageResult.fixes, ...onboarding.fixes],
        }
      : onboarding;
  return LocalDoctorResultSchema.parse({
    contract: "crewclaw.local-doctor/v1",
    employee_id: employeeId,
    ...result,
    capability_resolution: toolResolution.sessionCatalog.map(
      (item: Record<string, unknown>) => ({
        capability: item.capability,
        runtime_tool:
          typeof item.runtime_tool === "string" ? item.runtime_tool : null,
        availability: item.availability,
        reason: item.reason,
        authorization: item.authorization,
        timeout_ms:
          typeof (item.limits as { timeout_ms?: unknown } | null)
            ?.timeout_ms === "number"
            ? (item.limits as { timeout_ms: number }).timeout_ms
            : null,
      })
    ),
    checked_at: new Date().toISOString(),
  });
}

function trialResult(
  run: Record<string, unknown>,
  doctorStatus: LocalDoctorResult["status"],
  root: string
): LocalTrialResult {
  const evidence = loadEvidence(root, String(run.id));
  const status = String(run.status);
  return LocalTrialResultSchema.parse({
    contract: "crewclaw.local-trial/v1",
    employee_id: run.employee_id,
    task_run_id: run.id,
    status:
      status === "accepted" ||
      status === "rejected" ||
      status === "failed" ||
      status === "blocked"
        ? status
        : "delivered",
    artifact_id: run.artifact ?? null,
    evidence_count: evidence.ok ? evidence.cards.length : 0,
    tool_invocations: Array.isArray(run.tool_invocations)
      ? run.tool_invocations.length
      : 0,
    doctor_status: doctorStatus,
    next_action:
      status === "accepted"
        ? "hire_employee"
        : doctorStatus === "broken" || ["failed", "blocked"].includes(status)
          ? "fix_doctor"
          : "approve_trial",
  });
}

export async function runLocalTrial(
  employeeId: string,
  inputValue: unknown,
  options: LifecycleOptions = {}
): Promise<LocalTrialResult> {
  const input = RunLocalTrialRequestSchema.parse(inputValue);
  const { root } = roots(options);
  const doctor = await runLocalDoctor(
    employeeId,
    { permissions_granted: input.permissions_granted },
    options
  );
  if (doctor.status === "broken") {
    throw new LocalLifecycleError(
      "Doctor found blocking runtime or permission gaps. Fix them before starting a trial.",
      409,
      "DOCTOR_BLOCKED"
    );
  }
  const { runtime, toolResolution } = await resolveLifecycleTools(
    employeeId,
    input.permissions_granted,
    options
  );
  const gateway = makeGateway({
    root,
    employeePolicy: toolResolution.employeePolicy,
  });
  const run = newTaskRun({
    employeeId,
    goal: input.goal,
  });
  Object.assign(run, {
    trial: true,
    trial_permissions_granted: [...input.permissions_granted].sort(),
    doctor_status: doctor.status,
  });
  addEvent(run, {
    type: "trial.created",
    summary: "Bounded lifecycle trial created by the local website",
    status: "created",
  });
  transition(run, "planned");

  const args = {
    name: "lifecycle-trial.md",
    kind: "report",
    content: [
      "# CrewClaw bounded lifecycle trial",
      "",
      `Employee: ${employeeId}`,
      `Goal: ${input.goal}`,
      `Doctor: ${doctor.status}`,
      "",
      "This file was written through the registered runtime artifact_write tool.",
      "It is a lifecycle wiring proof, not a claim that the employee completed the business task.",
    ].join("\n"),
  };
  const decision = gateway.check("artifact_write", args);
  if (decision.decision === "deny") {
    addEvent(run, {
      type: "tool.blocked",
      summary: decision.reason,
      tool_name: "artifact_write",
      status: "blocked",
    });
    transition(run, "failed");
    saveTaskRun(root, run);
    return trialResult(run, doctor.status, root);
  }

  transition(run, "running_tool");
  const started = Date.now();
  let output: string;
  try {
    output = await runtime.runTool("artifact_write", args, {
      root,
      taskRunId: run.id,
      employeeId,
      permission: decision,
      confirm: async () => true,
      quiet: true,
    });
  } catch (error) {
    run.tool_invocations.push({
      tool_name: "artifact_write",
      capability: decision.capability,
      input_summary: "lifecycle-trial.md",
      permission_level: decision.level,
      decision_source: decision.decision_source,
      decision: decision.decision,
      status: "error",
      started_at: new Date(started).toISOString(),
      ended_at: new Date().toISOString(),
      elapsed_ms: Date.now() - started,
      action: String((error as Error)?.message ?? error),
    });
    addEvent(run, {
      type: "tool.failed",
      summary: String((error as Error)?.message ?? error),
      tool_name: "artifact_write",
      status: "error",
    });
    transition(run, "failed");
    saveTaskRun(root, run);
    return trialResult(run, doctor.status, root);
  }

  let managedArtifact: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).artifact_id === "string" &&
      typeof (parsed as Record<string, unknown>).path === "string"
    ) {
      managedArtifact = parsed as Record<string, unknown>;
    }
  } catch {
    managedArtifact = null;
  }
  run.tool_invocations.push({
    tool_name: "artifact_write",
    capability: decision.capability,
    input_summary: "lifecycle-trial.md",
    permission_level: decision.level,
    decision_source: decision.decision_source,
    decision: decision.decision,
    status: managedArtifact ? "success" : "blocked",
    started_at: new Date(started).toISOString(),
    ended_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    action: output.slice(0, 4_096),
  });
  if (!managedArtifact) {
    addEvent(run, {
      type: "tool.blocked",
      summary: "artifact_write did not produce a managed artifact",
      tool_name: "artifact_write",
      status: "blocked",
    });
    transition(run, "failed");
    saveTaskRun(root, run);
    return trialResult(run, doctor.status, root);
  }
  addEvent(run, {
    type: "tool.succeeded",
    summary: "Registered runtime artifact_write completed",
    tool_name: "artifact_write",
    status: "success",
  });
  transition(run, "extracting_evidence");

  const artifact = newArtifact({
    taskId: run.id,
    type: "report",
    title: "CrewClaw bounded lifecycle trial",
    content: args.content,
  });
  const savedArtifact = saveArtifact(root, artifact);
  if (!savedArtifact.ok) {
    addEvent(run, {
      type: "artifact.failed",
      summary: savedArtifact.error,
      status: "error",
    });
    transition(run, "failed");
    saveTaskRun(root, run);
    return trialResult(run, doctor.status, root);
  }
  const evidence = newEvidenceCard({
    field: "runtime_trial_artifact",
    value: managedArtifact.path,
    sourceRef: String(managedArtifact.path),
    sourceType: "file",
    confidence: "high",
    snippet: "artifact_write completed behind the employee permission gateway",
  });
  const evidenceSaved = addEvidence(root, run.id, evidence);
  if (!evidenceSaved.ok) {
    addEvent(run, {
      type: "evidence.failed",
      summary: evidenceSaved.error,
      status: "error",
    });
    transition(run, "failed");
    saveTaskRun(root, run);
    return trialResult(run, doctor.status, root);
  }
  addEvent(run, {
    type: "evidence.created",
    summary: "Runtime artifact evidence persisted",
    status: "success",
  });
  transition(run, "drafting_artifact");
  run.artifact = artifact.id;
  transition(run, "grading");
  run.output_valid = true;
  run.effective = false;
  transition(run, "delivered");
  addEvent(run, {
    type: "approval.requested",
    summary: "Human trial approval is required before hiring",
    status: "pending",
  });
  const savedRun = saveTaskRun(root, run);
  if (!savedRun.ok) {
    throw new LocalLifecycleError(
      "The trial ran but its TaskRun could not be persisted.",
      500,
      "TRIAL_STATE_NOT_PERSISTED"
    );
  }
  return trialResult(run, doctor.status, root);
}

export async function decideLocalTrial(
  employeeId: string,
  taskRunId: string,
  inputValue: unknown,
  options: LifecycleOptions = {}
): Promise<LocalTrialResult> {
  const input = DecideLocalTrialRequestSchema.parse(inputValue);
  const { root } = roots(options);
  const loaded = loadTaskRun(root, taskRunId);
  if (!loaded.ok || loaded.run.employee_id !== employeeId) {
    throw new LocalLifecycleError(
      "The trial TaskRun was not found for this employee.",
      404,
      "TRIAL_NOT_FOUND"
    );
  }
  const run = loaded.run;
  const targetStatus = input.decision === "accept" ? "accepted" : "rejected";
  if (run.status !== "delivered" && run.status !== targetStatus) {
    throw new LocalLifecycleError(
      `A trial in state ${run.status} cannot be decided.`,
      409,
      "TRIAL_NOT_AWAITING_APPROVAL"
    );
  }
  if (run.status === "delivered") {
    if (input.decision === "accept") {
      const accepted = markAccepted(root, run.artifact);
      if (!accepted.ok) {
        throw new LocalLifecycleError(
          "The trial artifact could not be marked accepted.",
          500,
          "TRIAL_ARTIFACT_ACCEPT_FAILED"
        );
      }
      transition(run, "accepted");
      run.effective = true;
      run.user_feedback = "useful";
    } else {
      transition(run, "rejected");
      run.effective = false;
      run.user_feedback = "not_useful";
    }
    const saved = saveTaskRun(root, run);
    if (!saved.ok) {
      throw new LocalLifecycleError(
        "The trial decision could not be persisted.",
        500,
        "TRIAL_DECISION_NOT_PERSISTED"
      );
    }
  }

  // These derived records are keyed by TaskRun. Always reconcile them on replay
  // so a crash after the terminal run write cannot silently skip KPI or learning.
  const kpi = recordTaskOutcome(root, employeeId, {
    taskRunId: run.id,
    taskKind: "formal",
    outcome: input.decision === "accept" ? "accepted" : "rejected",
    acceptanceSource: input.decision === "accept" ? "user" : "none",
    cost: 0,
    durationMs: Math.max(
      0,
      Date.parse(run.updated_at) - Date.parse(run.started_at)
    ),
    evidenceCount: loadEvidence(root, run.id).cards?.length ?? 0,
  });
  if (!kpi) {
    throw new LocalLifecycleError(
      "The trial settled, but its KPI ledger could not be reconciled.",
      500,
      "TRIAL_KPI_NOT_PERSISTED"
    );
  }
  const reflection = buildReflection(run, {
    evidenceIds: [`trial:${run.id}:artifact`],
    createdAt: run.updated_at,
  });
  const reflected = writeReflection(root, reflection);
  if (!reflected.ok) {
    throw new LocalLifecycleError(
      "The trial was settled but its learning record could not be persisted.",
      500,
      "TRIAL_REFLECTION_NOT_PERSISTED"
    );
  }
  return trialResult(run, "healthy", root);
}

export async function hireLocalEmployeeFromTrial(
  inputValue: unknown,
  options: LifecycleOptions = {}
) {
  const input = HireFromLocalTrialRequestSchema.parse(inputValue);
  const { root } = roots(options);
  const loaded = loadTaskRun(root, input.trial_task_run_id);
  if (
    !loaded.ok ||
    loaded.run.employee_id !== input.employee_id ||
    loaded.run.trial !== true
  ) {
    throw new LocalLifecycleError(
      "The accepted trial was not found for this employee.",
      404,
      "ACCEPTED_TRIAL_NOT_FOUND"
    );
  }
  if (loaded.run.status !== "accepted") {
    throw new LocalLifecycleError(
      "Hiring is blocked until the trial delivery is explicitly accepted.",
      409,
      "TRIAL_NOT_ACCEPTED"
    );
  }
  const trialGrants = Array.isArray(loaded.run.trial_permissions_granted)
    ? loaded.run.trial_permissions_granted.map(String).sort()
    : [];
  const requestedGrants = [...input.permissions_granted].sort();
  const requestedTrialCapabilities = requestedGrants
    .filter(grant => grant.startsWith("capability:"))
    .map(grant => grant.slice("capability:".length))
    .sort();
  if (
    requestedTrialCapabilities.length !== requestedGrants.length ||
    trialGrants.length !== requestedTrialCapabilities.length ||
    trialGrants.some(
      (grant: string, index: number) =>
        grant !== requestedTrialCapabilities[index]
    )
  ) {
    throw new LocalLifecycleError(
      "The requested hire permissions differ from the permissions verified by Doctor and trial.",
      409,
      "TRIAL_PERMISSION_DRIFT"
    );
  }
  return hireLocalEmployee(
    {
      employee_id: input.employee_id,
      version: input.version,
      permissions_granted: requestedGrants,
    },
    options
  );
}
