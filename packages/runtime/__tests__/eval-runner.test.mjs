// eval-runner.test.mjs — unit tests for the pure pieces of the eval runner (v0.18 Milestone B):
// spec loading, the persist guard, and the defensive read. The spawn-driven scoring itself is a
// separate slow e2e (eval-runner drives the real engine), kept out of the fast unit suite.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionForEvalEvent,
  buildEvalChildEnv,
  gradeArtifactWithJudge,
  JUDGE_PROMPT_VERSION,
  loadEmployeeSpec,
  persistEval,
  readEvalResult,
  resolveEvalExecutionIdentity,
  runEval,
  runSmokeTest,
  validateEvalResult,
} from "../eval-runner.mjs";
import { EVAL_SUBJECT_CONTRACT_VERSION } from "../eval-subject.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";

// M0.3：评测结果绑定的空记忆状态（当前评测在隔离空 root 运行，不注入记忆）。
const EMPTY_MEMORY_STATE = computeMemoryStateHash([]);

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-runner-test-"));
}

const SPEC_HASH = "a".repeat(64);
const SUBJECT_HASH = "c".repeat(64);
const DEPENDENCY_HASH = "d".repeat(64);
const ENDPOINT_ID = `sha256:${"e".repeat(64)}`;
const SYNTHETIC_EXECUTION = resolveEvalExecutionIdentity({
  mock: false,
  sourceEnv: {
    HERMES_MODEL: "worker/model-v1",
    CREW_EVAL_MODEL: "judge/model-v1",
  },
});
const EXECUTION_CONTEXT = SYNTHETIC_EXECUTION.executionContext;
const EXECUTION_CONTEXT_HASH = SYNTHETIC_EXECUTION.executionContextHash;
const RUNTIME_IDENTITY = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  node_abi: String(process.versions.modules ?? "unknown"),
};
const SMOKE_TESTS = [
  {
    id: "smoke-1",
    task: "produce a quality artifact",
    acceptance: ["artifact satisfies the requested quality bar"],
  },
];
const RUBRIC = [
  {
    id: "quality",
    weight: 1,
    criterion: "artifact meets the quality rubric",
  },
];

function validationContract() {
  return {
    expectedSpecVersion: "1.2.3",
    expectedSpecHash: SPEC_HASH,
    expectedSubjectContract: EVAL_SUBJECT_CONTRACT_VERSION,
    expectedSubjectHash: SUBJECT_HASH,
    expectedDependencyHash: DEPENDENCY_HASH,
    expectedRuntimeIdentity: RUNTIME_IDENTITY,
    expectedExecutionContext: EXECUTION_CONTEXT,
    expectedExecutionContextHash: EXECUTION_CONTEXT_HASH,
    expectedPassThreshold: 0.8,
    expectedSmokeTests: SMOKE_TESTS,
    expectedRubric: RUBRIC,
    expectedWorkerModel: "worker/model-v1",
    expectedJudgeModel: "judge/model-v1",
    expectedWorkerEndpointId: ENDPOINT_ID,
    expectedJudgeEndpointId: ENDPOINT_ID,
  };
}

function contractForSpec(spec, identity) {
  return {
    expectedSpecVersion: spec.specVersion,
    expectedSpecHash: spec.specHash,
    expectedSubjectContract: spec.subjectContract,
    expectedSubjectHash: spec.subjectHash,
    expectedDependencyHash: spec.dependencyHash,
    expectedRuntimeIdentity: spec.runtimeIdentity,
    expectedExecutionContext: identity.executionContext,
    expectedExecutionContextHash: identity.executionContextHash,
    expectedPassThreshold: spec.passThreshold,
    expectedSmokeTests: spec.smokeTests,
    expectedRubric: spec.rubric,
    expectedWorkerModel: identity.workerModel,
    expectedJudgeModel: identity.judgeModel,
    expectedWorkerEndpointId: identity.workerEndpointId,
    expectedJudgeEndpointId: identity.judgeEndpointId,
  };
}

function validEval({ agentId = "guard", mock = false, ...overrides } = {}) {
  const score = overrides.score ?? 100;
  const evidencePassed = score === 100;
  const dimensions = mock
    ? [
        {
          id: "harness_ran",
          passed: evidencePassed,
          reason: evidencePassed ? "settled" : "not settled",
        },
        {
          id: "artifact_produced",
          passed: evidencePassed,
          reason: evidencePassed ? "produced" : "not produced",
        },
      ]
    : [
        {
          id: "quality",
          passed: evidencePassed,
          weight: 1,
          reason: evidencePassed ? "meets rubric" : "does not meet rubric",
        },
      ];
  const perTest = [
    {
      id: "smoke-1",
      score,
      passed: evidencePassed,
      acceptance_checks: mock
        ? []
        : [
            {
              criterion: SMOKE_TESTS[0].acceptance[0],
              passed: evidencePassed,
              reason: evidencePassed ? "meets acceptance" : "does not meet",
            },
          ],
      dimensions,
    },
  ];
  return {
    agent_id: agentId,
    spec_version: "1.2.3",
    spec_hash: SPEC_HASH,
    subject_contract: EVAL_SUBJECT_CONTRACT_VERSION,
    subject_hash: SUBJECT_HASH,
    dependency_hash: DEPENDENCY_HASH,
    runtime_identity: RUNTIME_IDENTITY,
    execution_context: EXECUTION_CONTEXT,
    execution_context_hash: EXECUTION_CONTEXT_HASH,
    score,
    verdict: evidencePassed ? "PASS" : "FAIL",
    pass_threshold: 0.8,
    model: mock ? "mock" : "judge/model-v1",
    worker_model: mock ? "mock" : "worker/model-v1",
    judge_model: mock ? null : "judge/model-v1",
    worker_endpoint_id: mock ? null : ENDPOINT_ID,
    judge_endpoint_id: mock ? null : ENDPOINT_ID,
    graded_by: mock ? "mechanical" : "model",
    mock,
    // M0.3：合法结果必须绑定记忆状态（当前评测不注入记忆 → 空集哈希）与判官提示词版本。
    memory_state_hash: EMPTY_MEMORY_STATE.memory_state_hash,
    memory_hash_schema: EMPTY_MEMORY_STATE.memory_hash_schema,
    memory_item_count: 0,
    memory_injection_tokens: 0,
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    evaluated_at: 123,
    per_test: perTest,
    per_dimension: dimensions.map(dimension => ({
      test: "smoke-1",
      ...dimension,
    })),
    ...overrides,
  };
}

function writeRawEval(root, agentId, value) {
  const dir = path.join(root, ".crewclaw", "eval");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${agentId}.json`),
    `${JSON.stringify(value)}\n`
  );
}

// packages/runtime/__tests__/ → repo root is three levels up (cross-platform via fileURLToPath).
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const RUNTIME_FIXTURE = path.join(
  REPO_ROOT,
  "packages",
  "runtime",
  "__tests__",
  "fixtures",
  "eval-runtime-child.mjs"
);
const STATE_WORKER = path.join(
  REPO_ROOT,
  "packages",
  "runtime",
  "__tests__",
  "fixtures",
  "state-store-worker.mjs"
);

function runEvalWorker(root, result) {
  const payload = Buffer.from(
    JSON.stringify({
      result,
      options: { validationContract: validationContract() },
    })
  ).toString("base64url");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [STATE_WORKER, "eval", root, result.agent_id, payload],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.once("error", reject);
    child.once("close", code => {
      if (code !== 0) return reject(new Error(stderr || `worker exit ${code}`));
      resolve(JSON.parse(stdout));
    });
  });
}

async function acceptanceCriteriaAreHardGates() {
  const calls = [];
  const graded = await gradeArtifactWithJudge(
    {
      task: "write a report",
      artifactText: "report",
      acceptance: ["criterion A", "criterion B"],
      rubric: [{ id: "quality", weight: 1, criterion: "quality rubric" }],
    },
    async request => {
      calls.push(request);
      return request.criterion === "criterion B"
        ? { passed: "false", reason: "wrong type" }
        : { passed: true, reason: "ok" };
    }
  );
  assert.equal(graded.score, 100, "rubric score remains independently visible");
  assert.equal(graded.passed, false, "failed acceptance is a hard gate");
  assert.deepEqual(
    calls.map(call => call.criterionKind),
    ["smoke_acceptance", "smoke_acceptance", "outcome_rubric"]
  );
  assert.equal(graded.acceptanceChecks[1].passed, false);
  console.log("  ✓ smoke acceptance criteria are explicit hard gates");
}

async function failedRuntimeLifecycleIsNeverJudged() {
  let judgeCalls = 0;
  const result = await runEval("ai-adoption-whale", {
    root: REPO_ROOT,
    mock: false,
    judge: async () => {
      judgeCalls++;
      return { passed: true, reason: "must not be used" };
    },
    smokeRunner: async () => ({
      events: [
        {
          protocol_version: 1,
          type: "task.blocked",
          ts: 1,
          data: { id: "task-fixture", reason: "blocked" },
        },
      ],
      artifactText: "",
      terminal: { type: "task.blocked" },
    }),
  });
  assert.equal(judgeCalls, 0);
  assert.equal(result.score, 0);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.per_test[0].passed, false);
  console.log("  ✓ failed runtime lifecycles receive zero without judge calls");
}

function persistSyntheticEval(root, result, options = {}) {
  return persistEval(root, result, {
    ...options,
    validationContract: validationContract(),
  });
}

function readSyntheticEval(root, agentId) {
  return readEvalResult(root, agentId, {
    validationContract: validationContract(),
  });
}

function approvalActionsAreExplicitAndCorrelated() {
  assert.deepEqual(
    actionForEvalEvent({
      type: "approval.required",
      data: {
        id: "tool-1",
        taskRunId: "task-1",
        kind: "tool_authorization",
        tool: "browser_render",
        scope: "browser",
      },
    }),
    {
      type: "approval.resolve",
      data: {
        id: "tool-1",
        taskRunId: "task-1",
        kind: "tool_authorization",
        decision: "allow",
      },
    }
  );
  assert.deepEqual(
    actionForEvalEvent({
      type: "approval.requested",
      data: {
        id: "delivery-1",
        taskRunId: "task-1",
        kind: "deliverable_acceptance",
      },
    }),
    {
      type: "approval.resolve",
      data: {
        id: "delivery-1",
        taskRunId: "task-1",
        kind: "deliverable_acceptance",
        decision: "accept",
      },
    }
  );
  assert.equal(
    actionForEvalEvent({
      type: "approval.requested",
      data: { id: "delivery-1", kind: "deliverable_acceptance" },
    }),
    null,
    "uncorrelated approvals are never auto-accepted"
  );
  assert.equal(
    actionForEvalEvent({
      type: "approval.required",
      data: {
        id: "shell-1",
        taskRunId: "task-1",
        kind: "tool_authorization",
        tool: "bash",
        scope: "workspace",
      },
    })?.data?.decision,
    "deny",
    "the evaluator never auto-authorizes a shell tool"
  );
  console.log("  ✓ evaluator approval actions are explicit and correlated");
}

function evalChildEnvironmentIsAllowlisted() {
  const env = buildEvalChildEnv({
    mock: true,
    runRoot: "/isolated/eval",
    sourceEnv: {
      PATH: "/bin",
      ZENMUX_API_KEY: "needed-provider-key",
      GITHUB_TOKEN: "must-not-leak",
      AWS_SECRET_ACCESS_KEY: "must-not-leak",
      NODE_OPTIONS: "--require=untrusted.js",
    },
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.ZENMUX_API_KEY, "needed-provider-key");
  assert.equal(env.CREWCLAW_ROOT, "/isolated/eval");
  assert.equal(env.CREW_DISABLE_DOTENV, "1");
  assert.equal(env.CREW_MOCK, "1");
  assert.equal(env.HERMES_MODEL, "mock");
  assert.equal(env.HERMES_TIMEOUT_MS, "45000");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(
    buildEvalChildEnv({
      mock: true,
      runRoot: "/isolated/eval",
      sourceEnv: {},
    }).ZENMUX_API_KEY,
    "eval-mock",
    "mechanical eval remains key-free"
  );
  const realEnv = buildEvalChildEnv({
    mock: false,
    runRoot: "/isolated/eval",
    workerModel: "worker/model-captured",
    sourceEnv: {
      HERMES_MODEL: "worker/model-mutated",
      HERMES_TIMEOUT_MS: "60001",
    },
  });
  assert.equal(
    realEnv.HERMES_MODEL,
    "worker/model-captured",
    "the child receives the exact worker model bound into evidence"
  );
  assert.equal(realEnv.HERMES_TIMEOUT_MS, "60001");
  const identity = resolveEvalExecutionIdentity({
    mock: false,
    sourceEnv: {
      HERMES_MODEL: "worker/model-v1",
      CREW_EVAL_MODEL: "judge/model-v1",
      HERMES_TIMEOUT_MS: "60000",
      TAVILY_API_KEY: "search-secret",
      TAVILY_BASE_URL:
        "https://search-user:search-secret@search.example/private-token?api_key=hidden",
      ZENMUX_BASE_URL:
        "https://user:secret@provider.example/api/v1/private-token?api_key=super-secret#fragment",
    },
  });
  assert.match(identity.workerEndpointId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(identity.workerEndpointId, identity.judgeEndpointId);
  assert.equal(identity.workerModel, "worker/model-v1");
  assert.equal(identity.judgeModel, "judge/model-v1");
  assert.equal(identity.executionContext.timeout_ms, 60000);
  assert.equal(identity.executionContext.search_provider, "tavily");
  assert.equal(identity.executionContext.search_credential_present, true);
  assert.match(
    identity.executionContext.search_endpoint_id,
    /^sha256:[a-f0-9]{64}$/
  );
  assert.match(identity.executionContextHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(identity), /secret|private-token|api_key/);
  console.log(
    "  ✓ evaluator child environment binds its worker model and stores only opaque endpoint ids"
  );
}

async function smokeRunnerIsEventDrivenAndFailClosed() {
  const success = await runSmokeTest("success", "fixture task", {
    mock: true,
    runtimePath: RUNTIME_FIXTURE,
    cwd: REPO_ROOT,
    timeoutMs: 2_000,
  });
  assert.match(success.artifactText, /event-driven evaluator/);
  assert.deepEqual(
    success.events
      .filter(event =>
        [
          "approval.required",
          "approval.resolved",
          "approval.requested",
          "approval.accepted",
          "task.completed",
        ].includes(event.type)
      )
      .map(event => event.type),
    [
      "approval.required",
      "approval.resolved",
      "approval.requested",
      "approval.accepted",
      "task.completed",
    ]
  );

  await assert.rejects(
    runSmokeTest("nonzero", "fixture task", {
      mock: true,
      runtimePath: RUNTIME_FIXTURE,
      cwd: REPO_ROOT,
      timeoutMs: 2_000,
    }),
    /exited code=7/
  );
  await assert.rejects(
    runSmokeTest("malformed", "fixture task", {
      mock: true,
      runtimePath: RUNTIME_FIXTURE,
      cwd: REPO_ROOT,
      timeoutMs: 2_000,
    }),
    /not JSONL/
  );
  await assert.rejects(
    runSmokeTest("no-terminal", "fixture task", {
      mock: true,
      runtimePath: RUNTIME_FIXTURE,
      cwd: REPO_ROOT,
      timeoutMs: 2_000,
    }),
    /without a terminal task event/
  );
  await assert.rejects(
    runSmokeTest("timeout", "fixture task", {
      mock: true,
      runtimePath: RUNTIME_FIXTURE,
      cwd: REPO_ROOT,
      timeoutMs: 80,
    }),
    /timed out/
  );
  console.log(
    "  ✓ smoke runner follows approval events and rejects timeout/nonzero/malformed lifecycles"
  );
}

function loadsRealWhaleSpec() {
  // The runner reads a real employee's eval_suite + rubric off disk.
  const spec = loadEmployeeSpec(REPO_ROOT, "ai-adoption-whale");
  assert.ok(spec.smokeTests.length >= 1, "whale has at least one smoke test");
  assert.ok(spec.rubric.length >= 1, "whale has an outcome_rubric");
  assert.equal(
    spec.specVersion,
    "0.2.0",
    "spec version read from identity.version"
  );
  assert.ok(
    spec.passThreshold > 0 && spec.passThreshold <= 1,
    "pass_threshold in (0,1]"
  );
  assert.match(spec.specHash, /^[a-f0-9]{64}$/);
  assert.match(spec.subjectHash, /^[a-f0-9]{64}$/);
  assert.equal(spec.subjectContract, EVAL_SUBJECT_CONTRACT_VERSION);
  assert.match(spec.dependencyHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(spec.runtimeIdentity, RUNTIME_IDENTITY);
  assert.equal(spec.profileModel, "");
  console.log(
    "  ✓ loadEmployeeSpec reads a real employee's eval_suite + rubric"
  );
}

function refusesUnknownEmployee() {
  assert.throws(
    () => loadEmployeeSpec(REPO_ROOT, "no-such-employee"),
    /no crewclaw\.employee\.yaml/
  );
  assert.throws(
    () => loadEmployeeSpec(REPO_ROOT, "../outside"),
    /invalid employee slug/,
    "employee spec lookup rejects path traversal"
  );
  console.log("  ✓ loadEmployeeSpec throws for an employee with no spec file");
}

function persistGuardProtectsRealScores() {
  const root = tmpRoot();
  const real = validEval();
  const mock = validEval({
    mock: true,
    score: 100,
  });

  // First real write lands.
  assert.equal(persistSyntheticEval(root, real).written, true);
  // A mock run must NOT clobber the real certification score.
  const blocked = persistSyntheticEval(root, mock);
  assert.equal(blocked.written, false, "mock refused over real");
  assert.match(blocked.reason, /real/);
  // --force overrides.
  assert.equal(
    persistSyntheticEval(root, mock, { force: true }).written,
    true,
    "force overrides"
  );
  // A mock over a mock is fine (no real score to protect).
  assert.equal(
    persistSyntheticEval(
      root,
      validEval({
        mock: true,
        score: 0,
      })
    ).written,
    true
  );
  assert.equal(
    persistSyntheticEval(root, { ...real, agent_id: "../escape" }).written,
    false,
    "unsafe agent id is rejected before a path is constructed"
  );
  console.log(
    "  ✓ persistEval guards a real (mock:false) score from mock overwrites unless --force"
  );
}

function readEvalResultShapeAndAbsence() {
  const root = tmpRoot();
  assert.equal(
    readEvalResult(root, "nobody"),
    null,
    "no file → null (never fabricated)"
  );
  assert.equal(readEvalResult(root, undefined), null, "no agentId → null");

  const stored = validEval({
    agentId: "shape",
    mock: true,
    score: 100,
  });
  persistSyntheticEval(root, stored);
  const r = readSyntheticEval(root, "shape");
  assert.equal(r.score, 100);
  assert.equal(r.mock, true);
  assert.equal(r.graded_by, "mechanical");
  assert.equal(r.worker_model, "mock");
  assert.equal(r.judge_model, null);
  assert.deepEqual(r.exams, [{ id: "smoke-1", score: 100, passed: true }]);
  console.log(
    "  ✓ readEvalResult returns the compact TUI shape, null when absent"
  );
}

function rejectsUntrustedCertificationRecords() {
  const root = tmpRoot();
  const cases = [
    ["missing explicit mock", { mock: undefined }],
    ["legacy record missing subject contract", { subject_contract: undefined }],
    ["legacy record missing dependency hash", { dependency_hash: undefined }],
    ["legacy record missing runtime identity", { runtime_identity: undefined }],
    [
      "legacy record missing execution context",
      { execution_context: undefined },
    ],
    [
      "legacy record missing execution context hash",
      { execution_context_hash: undefined },
    ],
    ["legacy record missing worker model", { worker_model: undefined }],
    ["legacy record missing judge model", { judge_model: undefined }],
    [
      "legacy record missing worker endpoint",
      { worker_endpoint_id: undefined },
    ],
    ["legacy record missing judge endpoint", { judge_endpoint_id: undefined }],
    [
      "stale subject contract",
      { subject_contract: "crewclaw.eval-subject/v1" },
    ],
    ["stale spec", { spec_version: "0.9.0" }],
    ["changed spec contents", { spec_hash: "b".repeat(64) }],
    ["changed eval subject", { subject_hash: "b".repeat(64) }],
    ["changed dependencies", { dependency_hash: "b".repeat(64) }],
    [
      "changed Node runtime",
      { runtime_identity: { ...RUNTIME_IDENTITY, node: "v0.0.0" } },
    ],
    [
      "changed timeout",
      {
        execution_context: {
          ...EXECUTION_CONTEXT,
          timeout_ms: EXECUTION_CONTEXT.timeout_ms + 1,
        },
      },
    ],
    [
      "forged execution context hash",
      { execution_context_hash: "f".repeat(64) },
    ],
    ["wrong employee", { agent_id: "someone-else" }],
    ["mechanical provenance on real score", { graded_by: "mechanical" }],
    ["unknown judge", { model: "unknown" }],
    ["unexpected worker", { worker_model: "worker/model-v2" }],
    [
      "unexpected judge",
      { model: "judge/model-v2", judge_model: "judge/model-v2" },
    ],
    ["raw endpoint must never persist", { endpoint: "https://secret.test" }],
    ["inconsistent verdict", { verdict: "FAIL" }],
    ["missing evidence", { per_test: [] }],
    [
      "fabricated smoke id",
      {
        per_test: [{ ...validEval().per_test[0], id: "fabricated-test" }],
      },
    ],
    [
      "fabricated rubric dimension",
      {
        per_test: [
          {
            ...validEval().per_test[0],
            dimensions: [
              {
                id: "fabricated-dimension",
                passed: true,
                weight: 1,
                reason: "forged",
              },
            ],
          },
        ],
        per_dimension: [
          {
            test: "smoke-1",
            id: "fabricated-dimension",
            passed: true,
            weight: 1,
            reason: "forged",
          },
        ],
      },
    ],
    [
      "missing acceptance evidence",
      {
        per_test: [{ ...validEval().per_test[0], acceptance_checks: [] }],
      },
    ],
    ["forged total", { score: 0, verdict: "FAIL" }],
    [
      "forged test score",
      {
        per_test: [
          {
            ...validEval().per_test[0],
            score: 0,
            passed: false,
          },
        ],
      },
    ],
  ];
  for (const [label, patch] of cases) {
    writeRawEval(root, "guard", { ...validEval(), ...patch });
    assert.equal(readSyntheticEval(root, "guard"), null, label);
  }
  assert.equal(
    readSyntheticEval(root, "../escape"),
    null,
    "unsafe read id is rejected"
  );
  writeRawEval(root, "guard", validEval());
  assert.equal(
    readSyntheticEval(root, "guard")?.mock,
    false,
    "fully attributed current record remains a real certification score"
  );
  console.log(
    "  ✓ stale, ambiguous, or unattributed eval records never become real scores"
  );
}

function createSubjectFixture(root, slug = "subject-agent") {
  const profile = path.join(root, "experts", slug);
  fs.mkdirSync(path.join(profile, "skills", "writer"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "contracts", "schema"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    '{"name":"eval-subject-fixture","version":"1.0.0"}\n'
  );
  fs.writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n"
  );
  fs.writeFileSync(path.join(profile, "SOUL.md"), "# Subject soul\n");
  fs.writeFileSync(path.join(profile, "config.yaml"), "temperature: 0.2\n");
  fs.writeFileSync(
    path.join(profile, "hire.yaml"),
    "metadata:\n  name: Subject\n"
  );
  fs.writeFileSync(
    path.join(profile, "skills", "writer", "SKILL.md"),
    "# Writer\nAlways cite evidence.\n"
  );
  fs.writeFileSync(
    path.join(profile, "crewclaw.employee.yaml"),
    `identity:
  version: 1.2.3
eval_suite:
  smoke_tests:
    - id: smoke-1
      task: ${SMOKE_TESTS[0].task}
      acceptance:
        - ${SMOKE_TESTS[0].acceptance[0]}
  grading:
    pass_threshold: 0.8
outcome_rubric:
  - id: quality
    weight: 1
    criterion: ${RUBRIC[0].criterion}
`
  );
  fs.writeFileSync(
    path.join(root, "packages", "runtime", "run.mjs"),
    "export const runtimeFixture = 1;\n"
  );
  fs.writeFileSync(
    path.join(root, "packages", "runtime", "eval-runner.mjs"),
    "export const evaluatorFixture = 1;\n"
  );
  fs.writeFileSync(
    path.join(root, "contracts", "employee-spec.ts"),
    "export const contractVersion = 1;\n"
  );
  fs.writeFileSync(
    path.join(root, "contracts", "schema", "employee.spec.schema.json"),
    '{"version":1}\n'
  );
  return profile;
}

function subjectHashTracksEveryBehaviorInput() {
  const sourceRoot = tmpRoot();
  const stateRoot = tmpRoot();
  const previousJudgeModel = process.env.CREW_EVAL_MODEL;
  const previousWorkerModel = process.env.HERMES_MODEL;
  try {
    const profile = createSubjectFixture(sourceRoot);
    process.env.CREW_EVAL_MODEL = "judge/model-v1";
    process.env.HERMES_MODEL = "worker/model-v1";
    const spec = loadEmployeeSpec(sourceRoot, "subject-agent");
    const execution = resolveEvalExecutionIdentity({
      mock: false,
      profileModel: spec.profileModel,
    });
    const result = validEval({
      agentId: "subject-agent",
      spec_hash: spec.specHash,
      subject_contract: spec.subjectContract,
      subject_hash: spec.subjectHash,
      dependency_hash: spec.dependencyHash,
      runtime_identity: spec.runtimeIdentity,
      execution_context: execution.executionContext,
      execution_context_hash: execution.executionContextHash,
      model: execution.judgeModel,
      worker_model: execution.workerModel,
      judge_model: execution.judgeModel,
      worker_endpoint_id: execution.workerEndpointId,
      judge_endpoint_id: execution.judgeEndpointId,
    });
    assert.equal(
      persistEval(stateRoot, result, { specRoot: sourceRoot }).written,
      true
    );
    assert.ok(
      readEvalResult(stateRoot, "subject-agent", { specRoot: sourceRoot })
    );

    for (const relativePath of [
      ["SOUL.md"],
      ["config.yaml"],
      ["skills", "writer", "SKILL.md"],
      ["..", "..", "packages", "runtime", "run.mjs"],
      ["..", "..", "package.json"],
      ["..", "..", "pnpm-lock.yaml"],
    ]) {
      const target = path.resolve(profile, ...relativePath);
      const original = fs.readFileSync(target);
      fs.appendFileSync(target, "\n// subject changed\n");
      assert.equal(
        readEvalResult(stateRoot, "subject-agent", { specRoot: sourceRoot }),
        null,
        `${relativePath.join("/")} change invalidates the stored score`
      );
      assert.equal(
        persistEval(stateRoot, result, { specRoot: sourceRoot }).written,
        false,
        `${relativePath.join("/")} change refuses persistence of the stale score`
      );
      fs.writeFileSync(target, original);
      assert.ok(
        readEvalResult(stateRoot, "subject-agent", { specRoot: sourceRoot }),
        `${relativePath.join("/")} restore restores the original subject hash`
      );
    }
  } finally {
    if (previousJudgeModel === undefined) delete process.env.CREW_EVAL_MODEL;
    else process.env.CREW_EVAL_MODEL = previousJudgeModel;
    if (previousWorkerModel === undefined) delete process.env.HERMES_MODEL;
    else process.env.HERMES_MODEL = previousWorkerModel;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
  console.log(
    "  ✓ subject v2 invalidates scores after profile, runtime, or dependency changes"
  );
}

async function modelIdentityChangesInvalidateTheContract() {
  const root = tmpRoot();
  try {
    createSubjectFixture(root, "model-subject");
    const envA = {
      HERMES_MODEL: "worker/model-a",
      CREW_EVAL_MODEL: "judge/model-a",
      ZENMUX_BASE_URL: "https://provider-a.example/api/v1",
    };
    const envB = {
      HERMES_MODEL: "worker/model-b",
      CREW_EVAL_MODEL: "judge/model-b",
      ZENMUX_BASE_URL: "https://provider-b.example/api/v1",
    };
    const observedWorkers = [];
    const smokeRunner = async (_slug, _task, options) => {
      observedWorkers.push(options.workerModel);
      return {
        events: [],
        artifactText:
          "A sufficiently complete artifact for identity binding tests.",
        terminal: { type: "task.completed" },
      };
    };
    const judge = async () => ({ passed: true, reason: "meets criterion" });
    const resultA = await runEval("model-subject", {
      root,
      mock: false,
      judge,
      smokeRunner,
      sourceEnv: envA,
    });
    const resultB = await runEval("model-subject", {
      root,
      mock: false,
      judge,
      smokeRunner,
      sourceEnv: envB,
    });
    assert.deepEqual(observedWorkers, ["worker/model-a", "worker/model-b"]);
    assert.equal(resultA.worker_model, "worker/model-a");
    assert.equal(resultA.judge_model, "judge/model-a");
    assert.equal(resultA.model, resultA.judge_model);
    assert.equal(resultB.worker_model, "worker/model-b");
    assert.equal(resultB.judge_model, "judge/model-b");
    assert.notEqual(resultA.worker_endpoint_id, resultB.worker_endpoint_id);
    const spec = loadEmployeeSpec(root, "model-subject");
    const contractB = contractForSpec(
      spec,
      resolveEvalExecutionIdentity({ mock: false, sourceEnv: envB })
    );
    const validation = validateEvalResult(resultA, {
      ...contractB,
      agentId: "model-subject",
    });
    assert.equal(validation.ok, false);
    assert.match(validation.reason, /worker\/judge models/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ model A/B runs record distinct worker/judge identities and invalidate mismatched contracts"
  );
}

async function profileModelOverridesEnvironmentModel() {
  const root = tmpRoot();
  try {
    const profile = createSubjectFixture(root, "profile-model-subject");
    fs.writeFileSync(
      path.join(profile, "config.yaml"),
      "model:\n  default: profile/model-b\ntemperature: 0.2\n"
    );
    const spec = loadEmployeeSpec(root, "profile-model-subject");
    assert.equal(spec.profileModel, "profile/model-b");
    let observedWorker = null;
    const result = await runEval("profile-model-subject", {
      root,
      mock: false,
      sourceEnv: {
        HERMES_MODEL: "environment/model-a",
        CREW_EVAL_MODEL: "judge/model-a",
      },
      judge: async () => ({ passed: true, reason: "meets criterion" }),
      smokeRunner: async (_slug, _task, options) => {
        observedWorker = options.workerModel;
        return {
          events: [],
          artifactText: "A complete artifact proving profile model priority.",
          terminal: { type: "task.completed" },
        };
      },
    });
    assert.equal(observedWorker, "profile/model-b");
    assert.equal(result.worker_model, "profile/model-b");
    assert.equal(result.judge_model, "judge/model-a");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ profile model B overrides environment model A in worker evidence"
  );
}

async function executionContextChangesInvalidateTheContract() {
  const root = tmpRoot();
  try {
    createSubjectFixture(root, "context-subject");
    const baseEnv = {
      HERMES_MODEL: "worker/model-a",
      CREW_EVAL_MODEL: "judge/model-a",
      HERMES_TIMEOUT_MS: "45000",
    };
    const result = await runEval("context-subject", {
      root,
      mock: false,
      sourceEnv: baseEnv,
      judge: async () => ({ passed: true, reason: "meets criterion" }),
      smokeRunner: async () => ({
        events: [],
        artifactText: "A complete artifact proving execution context binding.",
        terminal: { type: "task.completed" },
      }),
    });
    assert.equal(result.execution_context.timeout_ms, 45000);
    assert.equal(result.execution_context.search_provider, "ddg");
    assert.equal(result.execution_context.search_credential_present, false);

    const spec = loadEmployeeSpec(root, "context-subject");
    const changedContexts = [
      {
        label: "timeout",
        env: { ...baseEnv, HERMES_TIMEOUT_MS: "60000" },
      },
      {
        label: "provider capability",
        env: { ...baseEnv, SERPER_API_KEY: "never-persist-this-key" },
      },
      {
        label: "provider endpoint",
        env: {
          ...baseEnv,
          TAVILY_API_KEY: "never-persist-this-key",
          TAVILY_BASE_URL:
            "https://user:secret@search.example/private?api_key=hidden",
        },
      },
    ];
    for (const { label, env } of changedContexts) {
      const identity = resolveEvalExecutionIdentity({
        mock: false,
        sourceEnv: env,
        profileModel: spec.profileModel,
      });
      const validation = validateEvalResult(result, {
        ...contractForSpec(spec, identity),
        agentId: "context-subject",
      });
      assert.equal(validation.ok, false, `${label} change must invalidate`);
      assert.match(validation.reason, /execution_context/);
      assert.doesNotMatch(
        JSON.stringify(identity),
        /never-persist-this-key|user:secret|api_key=hidden/
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ timeout, search provider presence/name, and provider endpoint changes invalidate old evidence"
  );
}

function subjectSnapshotRejectsLinkedInputs() {
  const junctionRoot = tmpRoot();
  const junctionOutside = tmpRoot();
  try {
    const profile = createSubjectFixture(junctionRoot, "junction-subject");
    fs.rmSync(path.join(profile, "skills"), { recursive: true, force: true });
    fs.mkdirSync(path.join(junctionOutside, "writer"), { recursive: true });
    fs.writeFileSync(
      path.join(junctionOutside, "writer", "SKILL.md"),
      "outside skill"
    );
    fs.symlinkSync(
      junctionOutside,
      path.join(profile, "skills"),
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.throws(
      () => loadEmployeeSpec(junctionRoot, "junction-subject"),
      /symbolic links are not allowed/
    );
  } finally {
    fs.rmSync(junctionRoot, { recursive: true, force: true });
    fs.rmSync(junctionOutside, { recursive: true, force: true });
  }

  const hardRoot = tmpRoot();
  const hardOutside = tmpRoot();
  try {
    const profile = createSubjectFixture(hardRoot, "hard-subject");
    const specPath = path.join(profile, "crewclaw.employee.yaml");
    const outsideSpec = path.join(hardOutside, "employee.yaml");
    fs.copyFileSync(specPath, outsideSpec);
    fs.rmSync(specPath);
    fs.linkSync(outsideSpec, specPath);
    assert.throws(
      () => loadEmployeeSpec(hardRoot, "hard-subject"),
      /crewclaw\.employee\.yaml must be a single-link regular file/
    );
  } finally {
    fs.rmSync(hardRoot, { recursive: true, force: true });
    fs.rmSync(hardOutside, { recursive: true, force: true });
  }
  console.log(
    "  ✓ eval subject snapshot rejects junction and hard-linked behavior inputs"
  );
}

function overallVerdictRequiresEverySmokeTest() {
  const first = validEval().per_test[0];
  const failed = {
    ...structuredClone(first),
    id: "smoke-2",
    score: 0,
    passed: false,
    acceptance_checks: [
      {
        criterion: "second acceptance",
        passed: false,
        reason: "failed",
      },
    ],
    dimensions: [
      {
        id: "quality",
        passed: false,
        weight: 1,
        reason: "failed",
      },
    ],
  };
  const result = {
    ...validEval(),
    score: 50,
    verdict: "PASS",
    pass_threshold: 0.5,
    per_test: [first, failed],
    per_dimension: [
      ...validEval().per_dimension,
      ...failed.dimensions.map(dimension => ({
        test: failed.id,
        ...dimension,
      })),
    ],
  };
  const validation = validateEvalResult(result, {
    ...validationContract(),
    agentId: result.agent_id,
    expectedPassThreshold: 0.5,
    expectedSmokeTests: [
      ...SMOKE_TESTS,
      {
        id: "smoke-2",
        task: "second task",
        acceptance: ["second acceptance"],
      },
    ],
  });
  assert.equal(validation.ok, false);
  assert.match(validation.reason, /verdict/);
  console.log("  ✓ overall PASS requires every smoke test to pass");
}

async function concurrentPersistenceAndPathGuards() {
  const root = tmpRoot();
  try {
    const real = validEval({ agentId: "parallel-guard" });
    const mocks = Array.from({ length: 12 }, (_, index) =>
      validEval({
        agentId: "parallel-guard",
        mock: true,
        evaluated_at: 1_000 + index,
      })
    );
    const results = await Promise.all([
      runEvalWorker(root, real),
      ...mocks.map(result => runEvalWorker(root, result)),
    ]);
    assert.equal(results[0].written, true, "the real writer always persists");
    const stored = JSON.parse(
      fs.readFileSync(
        path.join(root, ".crewclaw", "eval", "parallel-guard.json"),
        "utf8"
      )
    );
    assert.equal(
      stored.mock,
      false,
      "a parallel mock writer can never win after a real certification"
    );

    const junctionRoot = path.join(root, "junction-root");
    const outsideEval = path.join(root, "outside-eval");
    fs.mkdirSync(path.join(junctionRoot, ".crewclaw"), { recursive: true });
    fs.mkdirSync(outsideEval);
    fs.symlinkSync(
      outsideEval,
      path.join(junctionRoot, ".crewclaw", "eval"),
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.equal(
      persistSyntheticEval(junctionRoot, validEval({ agentId: "junction" }))
        .written,
      false,
      "eval parent junction is rejected"
    );
    assert.equal(readSyntheticEval(junctionRoot, "junction"), null);
    assert.deepEqual(fs.readdirSync(outsideEval), []);

    const hardRoot = path.join(root, "hardlink-root");
    const hardDir = path.join(hardRoot, ".crewclaw", "eval");
    fs.mkdirSync(hardDir, { recursive: true });
    const outsideRecord = path.join(root, "outside-eval.json");
    const hardRecord = path.join(hardDir, "hard-guard.json");
    fs.writeFileSync(
      outsideRecord,
      `${JSON.stringify(validEval({ agentId: "hard-guard" }))}\n`
    );
    fs.linkSync(outsideRecord, hardRecord);
    const outsideBefore = fs.readFileSync(outsideRecord, "utf8");
    assert.equal(
      readSyntheticEval(hardRoot, "hard-guard"),
      null,
      "eval final hardlink is rejected on read"
    );
    assert.equal(
      persistSyntheticEval(hardRoot, validEval({ agentId: "hard-guard" }))
        .written,
      false,
      "eval final hardlink is rejected on write"
    );
    assert.equal(fs.readFileSync(outsideRecord, "utf8"), outsideBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ eval persistence serializes real-vs-mock and rejects junction/hardlink state"
  );
}

async function main() {
  console.log("eval-runner.mjs: spec loading + persist guard + defensive read");
  approvalActionsAreExplicitAndCorrelated();
  evalChildEnvironmentIsAllowlisted();
  await smokeRunnerIsEventDrivenAndFailClosed();
  await acceptanceCriteriaAreHardGates();
  await failedRuntimeLifecycleIsNeverJudged();
  loadsRealWhaleSpec();
  refusesUnknownEmployee();
  persistGuardProtectsRealScores();
  readEvalResultShapeAndAbsence();
  rejectsUntrustedCertificationRecords();
  subjectHashTracksEveryBehaviorInput();
  await modelIdentityChangesInvalidateTheContract();
  await profileModelOverridesEnvironmentModel();
  await executionContextChangesInvalidateTheContract();
  subjectSnapshotRejectsLinkedInputs();
  overallVerdictRequiresEverySmokeTest();
  await concurrentPersistenceAndPathGuards();
  console.log("eval-runner.test.mjs passed");
}

await main();
