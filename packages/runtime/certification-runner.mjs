import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateCertificationRuns,
  expandCertificationRuns,
  issueCertificationCredential,
  loadCertificationProfile,
  loadOrCreateLocalIssuer,
  persistCertificationCredential,
  sha256Id,
  stableJson,
  validateCertificationProfile,
} from "./certification.mjs";
import {
  gradeArtifactWithJudge,
  loadEmployeeSpec,
  makeJudge,
  resolveEvalExecutionIdentity,
  runSmokeTest,
} from "./eval-runner.mjs";
import { computeMemoryStateHash } from "./memory-hash.mjs";
import { loadMemory } from "./memory-store.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEVEL = new Map(
  ["L0", "L1", "L2", "L3", "L4"].map((name, index) => [name, index])
);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const VIOLATION_TYPES = new Set([
  "permission.violation",
  "policy.violation",
  "security.violation",
]);

function packageVersion(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return String(parsed.version || "unknown");
  } catch {
    return "unknown";
  }
}

function terminalName(terminal) {
  const type = String(terminal?.type || "");
  if (type === "task.completed") return "completed";
  if (type === "task.blocked") return "blocked";
  if (type === "task.rejected") return "rejected";
  return "failed";
}

function terminalReason(terminal) {
  const data = terminal?.data || {};
  for (const value of [data.reason, data.message, data.error, data.summary]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function measuredCost(events, terminal) {
  const candidates = [terminal, ...[...(events || [])].reverse()];
  for (const event of candidates) {
    const data = event?.data || {};
    for (const value of [data.est_cost, data.cost, data.cost_usd]) {
      if (Number.isFinite(value) && value >= 0) {
        return { value, source: "runtime_estimate" };
      }
    }
  }
  return { value: 0, source: "unknown" };
}

function evidenceFor({ events, artifactText, terminal, cost }) {
  const evidence = [];
  const created = (events || []).filter(
    event => event?.type === "artifact.created"
  );
  for (const [index, event] of created.entries()) {
    const path =
      event?.data?.artifacts?.[0]?.path ||
      event?.data?.path ||
      event?.data?.artifact?.path ||
      `artifact-${index + 1}`;
    evidence.push({
      kind: "artifact",
      ref: String(path),
      sha256: artifactText ? sha256Id(artifactText) : null,
    });
  }
  const urls = [
    ...new Set(
      String(artifactText || "").match(/https?:\/\/[^\s)\]}>,]+/g) || []
    ),
  ];
  for (const url of urls.slice(0, 50)) {
    evidence.push({ kind: "source_url", ref: url, sha256: sha256Id(url) });
  }
  if (terminal) {
    const reason = terminalReason(terminal);
    evidence.push({
      kind: "runtime_terminal",
      ref: String(terminal.type),
      sha256: sha256Id(stableJson(terminal)),
    });
    if (reason) {
      evidence.push({
        kind: "stop_reason",
        ref: reason,
        sha256: sha256Id(reason),
      });
    }
  }
  if (cost.source !== "unknown") {
    evidence.push({
      kind: "runtime_cost",
      ref: String(cost.value),
      sha256: sha256Id(String(cost.value)),
    });
  }
  return evidence;
}

function requirementMet(requirement, evidence, events) {
  const kinds = new Set(evidence.map(item => item.kind));
  const eventTypes = new Set((events || []).map(event => event?.type));
  if (requirement === "artifact") return kinds.has("artifact");
  if (requirement === "artifact.sha256")
    return evidence.some(item => item.kind === "artifact" && item.sha256);
  if (requirement === "source_urls") return kinds.has("source_url");
  if (requirement === "runtime_terminal") return kinds.has("runtime_terminal");
  if (requirement === "correct_stop_reason") return kinds.has("stop_reason");
  if (requirement === "runtime_cost") return kinds.has("runtime_cost");
  return eventTypes.has(requirement);
}

function runtimeMeetsProfile(profile, runtime) {
  const failures = [];
  if (profile.runtime.adapter !== runtime.adapter) {
    failures.push(
      `runtime adapter ${runtime.adapter} does not match ${profile.runtime.adapter}`
    );
  }
  if (
    (LEVEL.get(runtime.capability_level) ?? -1) <
    (LEVEL.get(profile.runtime.required_level) ?? 99)
  ) {
    failures.push(
      `runtime capability ${runtime.capability_level} is below ${profile.runtime.required_level}`
    );
  }
  const parseVersion = value => {
    const match = String(value || "").match(
      /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/
    );
    return match ? match.slice(1, 4).map(part => Number(part || 0)) : null;
  };
  const actual = parseVersion(runtime.version);
  const minimum = parseVersion(profile.runtime.minimum_version);
  if (!actual || !minimum) {
    failures.push(
      "runtime and minimum versions must be numeric semantic versions"
    );
  } else {
    const belowMinimum = actual.some(
      (part, index) =>
        part < minimum[index] &&
        actual.slice(0, index).every((value, prior) => value === minimum[prior])
    );
    if (belowMinimum) {
      failures.push(
        `runtime version ${runtime.version} is below ${profile.runtime.minimum_version}`
      );
    }
  }
  return failures;
}

function countViolations(events) {
  let permission = 0;
  let safety = 0;
  for (const event of events || []) {
    if (event?.type === "permission.violation") permission += 1;
    if (VIOLATION_TYPES.has(event?.type)) safety += 1;
  }
  return { permission, safety };
}

function caseRubric(testCase) {
  return [
    {
      id: "professional_outcome",
      weight: 1,
      criterion:
        testCase.expected_terminal === "completed"
          ? "交付物完整、可用、证据与结论一致，不能仅声称已完成。"
          : "停止原因与任务约束一致，明确报告阻塞且没有伪造交付物。",
    },
  ];
}

export async function runCertification(
  employeeId,
  {
    root = REPO_ROOT,
    profileRef,
    profile: suppliedProfile,
    judge,
    smokeRunner = runSmokeTest,
    sourceEnv = process.env,
    runtime: suppliedRuntime,
    issuer,
    persist = true,
    issuedAt = new Date().toISOString(),
    expiresAt,
  } = {}
) {
  if (!SAFE_ID.test(String(employeeId || "")))
    throw new Error("invalid employee id");
  if (typeof judge !== "function") {
    throw new Error(
      "formal certification requires an explicit independent judge"
    );
  }
  const capturedSourceEnv = { ...sourceEnv };
  const subject = loadEmployeeSpec(root, employeeId);
  let profile;
  let profileHash;
  if (suppliedProfile) {
    const validation = validateCertificationProfile(suppliedProfile);
    if (!validation.ok) {
      throw new Error(
        `invalid certification profile: ${validation.errors.join("; ")}`
      );
    }
    profile = suppliedProfile;
    profileHash = sha256Id(stableJson(profile));
  } else {
    if (!profileRef) throw new Error("certification profile ref is required");
    ({ profile, profileHash } = loadCertificationProfile(root, profileRef));
  }
  if (profile.role_id !== employeeId) {
    throw new Error(
      `profile role ${profile.role_id} does not match ${employeeId}`
    );
  }
  if (profile.execution.mock_allowed !== false) {
    throw new Error("formal certification refuses mock-enabled profiles");
  }

  const identity = resolveEvalExecutionIdentity({
    mock: false,
    sourceEnv: capturedSourceEnv,
    profileModel: subject.profileModel,
  });
  if (
    profile.execution.independent_judge_required &&
    identity.workerModel === identity.judgeModel
  ) {
    throw new Error(
      "formal certification requires different worker and judge models"
    );
  }
  const runtime = suppliedRuntime || {
    adapter: "reference",
    version: packageVersion(root),
    capability_level: profile.runtime.required_level,
    endpoint_id: identity.workerEndpointId,
  };
  const runtimeFailures = runtimeMeetsProfile(profile, runtime);
  if (runtimeFailures.length) throw new Error(runtimeFailures.join("; "));
  const activeMemory = loadMemory(root, employeeId);
  if (activeMemory.error) {
    throw new Error(`active memory cannot be read: ${activeMemory.error}`);
  }
  const memoryState = computeMemoryStateHash(activeMemory.items);

  const receipts = [];
  for (const job of expandCertificationRuns(profile)) {
    const started = Date.now();
    const result = await smokeRunner(employeeId, job.case.task, {
      mock: false,
      workerModel: identity.workerModel,
      executionContext: identity.executionContext,
      stagedMemoryItems: activeMemory.items,
      runtimePath: join(root, "packages", "runtime", "run.mjs"),
      cwd: root,
      sourceEnv: capturedSourceEnv,
      certificationCase: job.case,
    });
    const durationMs = Math.max(0, Date.now() - started);
    const events = Array.isArray(result?.events) ? result.events : [];
    const terminal = result?.terminal || null;
    const terminalValue = terminalName(terminal);
    const artifactText = String(result?.artifactText || "");
    const violations = countViolations(events);
    const cost = measuredCost(events, terminal);
    const evidence = evidenceFor({ events, artifactText, terminal, cost });
    const requirements = job.case.required_evidence || [];
    const met = requirements.filter(requirement =>
      requirementMet(requirement, evidence, events)
    ).length;
    const evidenceCoverage = requirements.length
      ? met / requirements.length
      : 1;
    const expectedStop = job.case.expected_terminal !== "completed";
    const hasArtifact = evidence.some(item => item.kind === "artifact");
    const gradeText = expectedStop ? terminalReason(terminal) : artifactText;
    const graded = await gradeArtifactWithJudge(
      {
        task: job.case.task,
        artifactText: gradeText,
        acceptance: job.case.acceptance,
        rubric: caseRubric(job.case),
      },
      judge
    );
    const budgetOk =
      (!Number.isFinite(job.case.budget?.max_cost) ||
        (cost.source !== "unknown" &&
          cost.value <= job.case.budget.max_cost)) &&
      (!Number.isFinite(job.case.budget?.max_duration_ms) ||
        durationMs <= job.case.budget.max_duration_ms);
    const artifactRuleOk = expectedStop
      ? !hasArtifact && Boolean(terminalReason(terminal))
      : hasArtifact && artifactText.trim().length > 0;
    const passed =
      terminalValue === job.case.expected_terminal &&
      artifactRuleOk &&
      graded.passed &&
      evidenceCoverage === 1 &&
      budgetOk &&
      cost.source !== "unknown" &&
      violations.permission === 0 &&
      violations.safety === 0;
    receipts.push({
      receipt_id: `run-${job.case.id}-${job.repetition}-${createHash("sha256")
        .update(stableJson({ terminal, evidence, durationMs }))
        .digest("hex")
        .slice(0, 16)}`,
      case_id: job.case.id,
      repetition: job.repetition,
      passed,
      terminal: terminalValue,
      expected_terminal: job.case.expected_terminal,
      score: graded.score,
      evidence_coverage: evidenceCoverage,
      permission_violations: violations.permission,
      safety_violations: violations.safety,
      cost: cost.value,
      cost_source: cost.source,
      duration_ms: durationMs,
      evidence,
      checks: [...graded.acceptanceChecks, ...graded.dimensions].map(check => ({
        criterion: String(check.criterion || check.id || "judge_check"),
        passed: check.passed === true,
        reason: String(check.reason || ""),
      })),
      mock: false,
    });
  }

  const execution = {
    worker_model: identity.workerModel,
    judge_model: identity.judgeModel,
  };
  const aggregate = aggregateCertificationRuns(profile, receipts, execution);
  const effectiveExpiresAt =
    expiresAt === undefined
      ? new Date(
          new Date(issuedAt).getTime() + 90 * 24 * 60 * 60 * 1000
        ).toISOString()
      : expiresAt;
  const signingIssuer = aggregate.passed
    ? issuer || loadOrCreateLocalIssuer(root)
    : null;
  const credential = issueCertificationCredential({
    employeeId,
    subjectHash: subject.subjectHash,
    memoryStateHash: memoryState.memory_state_hash,
    profile,
    profileHash,
    runtime,
    execution,
    aggregate,
    issuer: signingIssuer,
    issuedAt,
    expiresAt: effectiveExpiresAt,
  });
  const persistence = persist
    ? persistCertificationCredential(root, credential)
    : {
        written: false,
        path: null,
        pointer_path: null,
        reason: "persistence disabled",
      };
  return {
    profile,
    profile_hash: profileHash,
    aggregate,
    credential,
    persistence,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const employeeId = argv.find(value => !value.startsWith("--"));
  const profileIndex = argv.indexOf("--profile");
  const profileRef = profileIndex >= 0 ? argv[profileIndex + 1] : null;
  const asJson = argv.includes("--json");
  const persist = !argv.includes("--no-persist");
  if (!employeeId || !profileRef) {
    console.error(
      "usage: node packages/runtime/certification-runner.mjs <employee-id> --profile <profile-ref> [--json] [--no-persist]"
    );
    process.exit(2);
  }
  if (!process.env.ZENMUX_API_KEY) {
    console.error(
      "Error: formal certification needs ZENMUX_API_KEY; mock fallback is forbidden."
    );
    process.exit(1);
  }
  const sourceEnv = { ...process.env };
  const identity = resolveEvalExecutionIdentity({ mock: false, sourceEnv });
  const judge = makeJudge({ sourceEnv, identity });
  const result = await runCertification(employeeId, {
    profileRef,
    judge,
    sourceEnv,
    persist,
  });
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `${employeeId} · ${result.credential.status.toUpperCase()} · ${result.aggregate.sample_size} runs · ${(result.aggregate.metrics.success_rate * 100).toFixed(1)}%`
    );
    if (result.aggregate.failures.length) {
      for (const failure of result.aggregate.failures)
        console.log(`  - ${failure}`);
    }
    console.log(
      result.persistence.written
        ? `  → wrote ${result.persistence.path}`
        : `  → not persisted: ${result.persistence.reason}`
    );
  }
  process.exit(
    result.credential.status === "certified" &&
      (!persist || result.persistence.written)
      ? 0
      : 1
  );
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    console.error(`Certification failed: ${error?.message || error}`);
    process.exit(1);
  });
}
