// eval-runner.mjs — v0.18 Milestone B: run an employee's eval_suite for a REAL benchmark score.
//
// This is the differentiator: CrewClaw doesn't just list employees, it proves which one deserves
// hiring. The runner loads crewclaw.employee.yaml's eval_suite.smoke_tests, drives each one through
// the SAME live engine the workbench spawns (reusing the conformance runner's spawn skeleton),
// reads the produced artifact, and scores it against the spec's weighted outcome_rubric.
//
// Two honest modes (never conflated):
//   --mock / CREW_MOCK=1  → the model turn is canned, so grading is MECHANICAL only (did the task
//                           run and produce a non-empty artifact?). Result is flagged mock:true and
//                           graded_by:"mechanical" — a harness smoke check, NOT a certification.
//   real (default)        → needs ZENMUX_API_KEY; a judge model scores each acceptance criterion and
//                           rubric dimension → weighted 0-100. graded_by:"model", mock:false.
// A mock result never overwrites a real one (unless --force). No key + no --mock → error, no silent
// downgrade.
//
// Usage:  node packages/runtime/eval-runner.mjs <slug> [--mock] [--json] [--keep] [--force]
//   pnpm eval:expert <slug> [--mock]
// Persists .crewclaw/eval/<slug>.json in the repo root and prints a summary.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { readArtifactFileGuarded } from "./artifact-contract.mjs";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";
import { validateTaskEvent } from "./tui/protocol.mjs";
import { snapshotEvalSubject } from "./eval-subject.mjs";
import yaml from "./yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const RUNTIME = join(HERE, "run.mjs");

// Same .env.local loading as run.mjs (which can't be imported — its main() is unguarded; known
// debt, engine库化 Phase 2). Without this, real evals fail even though the key is on disk.
function loadDotEnv() {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  let text;
  try {
    text = readStateFileGuarded(path, {
      root: REPO_ROOT,
      maxBytes: 1024 * 1024,
    }).toString("utf8");
  } catch (error) {
    throw new Error(`refusing unsafe .env.local: ${error?.message || error}`);
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2].replace(/\s+#.*$/, "").trim();
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const MIN_ARTIFACT_CHARS = 80; // below this a "deliverable" is too thin to count as produced
const SAFE_AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const DEFAULT_WORKER_MODEL = "anthropic/claude-opus-4.8";
const DEFAULT_JUDGE_MODEL = "anthropic/claude-opus-4.8";
const DEFAULT_PROVIDER_BASE_URL = "https://zenmux.ai/api/v1";
const DEFAULT_HERMES_TIMEOUT_MS = 45_000;
const MAX_HERMES_TIMEOUT_MS = 2_147_483_647;
const SEARCH_ENDPOINTS = {
  tavily: "https://api.tavily.com",
  serper: "https://google.serper.dev/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  ddg: "https://lite.duckduckgo.com/lite/",
};
const SMOKE_TIMEOUT_MS = 120_000;
const JUDGE_TIMEOUT_MS = 60_000;
const MAX_RUNTIME_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_STDERR_BYTES = 1024 * 1024;
const MAX_JUDGE_RESPONSE_BYTES = 256 * 1024;
const EVAL_RESULT_FIELDS = new Set([
  "agent_id",
  "spec_version",
  "spec_hash",
  "subject_contract",
  "subject_hash",
  "dependency_hash",
  "runtime_identity",
  "execution_context",
  "execution_context_hash",
  "score",
  "verdict",
  "pass_threshold",
  "model",
  "worker_model",
  "judge_model",
  "worker_endpoint_id",
  "judge_endpoint_id",
  "graded_by",
  "mock",
  "evaluated_at",
  "per_test",
  "per_dimension",
]);
const RUNTIME_IDENTITY_FIELDS = ["arch", "node", "node_abi", "platform"];
const EXECUTION_CONTEXT_FIELDS = [
  "search_credential_present",
  "search_endpoint_id",
  "search_provider",
  "timeout_ms",
];
const TERMINAL_EVENTS = new Set([
  "task.completed",
  "task.rejected",
  "task.blocked",
  "task.failed",
  "task.revision_needed",
]);
const EVAL_CHILD_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ZENMUX_API_KEY",
  "ZENMUX_BASE_URL",
  "HERMES_MODEL",
  "HERMES_TIMEOUT_MS",
  "TAVILY_API_KEY",
  "TAVILY_BASE_URL",
  "BRAVE_API_KEY",
  "SERPER_API_KEY",
];

function isSafeAgentId(agentId) {
  return typeof agentId === "string" && SAFE_AGENT_ID.test(agentId);
}

function normalizeModelId(value, label) {
  const model = String(value ?? "").trim();
  if (!SAFE_MODEL_ID.test(model)) {
    throw new Error(`${label} is missing or is not a safe model identifier`);
  }
  return model;
}

function hasControlCharacter(value) {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function configuredWorkerModel(sourceEnv = process.env, profileModel = null) {
  if (profileModel) {
    const normalized = normalizeModelId(profileModel, "profile worker model");
    if (normalized !== profileModel) {
      throw new Error("profile worker model must already be normalized");
    }
    return normalized;
  }
  return normalizeModelId(
    sourceEnv.HERMES_MODEL || DEFAULT_WORKER_MODEL,
    "worker model"
  );
}

function configuredJudgeModel(sourceEnv = process.env) {
  return normalizeModelId(
    sourceEnv.CREW_EVAL_MODEL || sourceEnv.HERMES_MODEL || DEFAULT_JUDGE_MODEL,
    "judge model"
  );
}

function normalizeHttpEndpoint(rawEndpoint, label = "provider endpoint") {
  const raw = String(rawEndpoint).trim();
  if (!raw || hasControlCharacter(raw)) {
    throw new Error(`${label} is missing or contains control bytes`);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP(S)`);
  }
  return raw.replace(/\/$/, "");
}

function configuredProviderBaseUrl(sourceEnv = process.env) {
  return normalizeHttpEndpoint(
    sourceEnv.ZENMUX_BASE_URL || DEFAULT_PROVIDER_BASE_URL
  );
}

// Results never persist the configured URL itself. Hashing the normalized URL binds routing while
// keeping credentials, query tokens, and secret-looking path components out of certification JSON.
export function evalEndpointId(rawEndpoint) {
  const parsed = new URL(normalizeHttpEndpoint(rawEndpoint));
  return `sha256:${createHash("sha256").update(parsed.href).digest("hex")}`;
}

function normalizedHermesTimeoutMs(sourceEnv = process.env) {
  const value = Number(
    sourceEnv.HERMES_TIMEOUT_MS || DEFAULT_HERMES_TIMEOUT_MS
  );
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_HERMES_TIMEOUT_MS
  ) {
    throw new Error(
      `HERMES_TIMEOUT_MS must be an integer within 1..${MAX_HERMES_TIMEOUT_MS}`
    );
  }
  return value;
}

function resolveSearchExecutionContext(sourceEnv = process.env) {
  let searchProvider = "ddg";
  let searchCredentialPresent = false;
  if (sourceEnv.TAVILY_API_KEY) {
    searchProvider = "tavily";
    searchCredentialPresent = true;
  } else if (sourceEnv.SERPER_API_KEY) {
    searchProvider = "serper";
    searchCredentialPresent = true;
  } else if (sourceEnv.BRAVE_API_KEY) {
    searchProvider = "brave";
    searchCredentialPresent = true;
  }
  const endpoint =
    searchProvider === "tavily"
      ? normalizeHttpEndpoint(
          String(sourceEnv.TAVILY_BASE_URL || SEARCH_ENDPOINTS.tavily).replace(
            /\/+$/,
            ""
          ),
          "Tavily endpoint"
        )
      : SEARCH_ENDPOINTS[searchProvider];
  return {
    search_provider: searchProvider,
    search_credential_present: searchCredentialPresent,
    search_endpoint_id: evalEndpointId(endpoint),
  };
}

function hashExecutionContext(context) {
  const canonical = {
    timeout_ms: context?.timeout_ms,
    search_provider: context?.search_provider,
    search_credential_present: context?.search_credential_present,
    search_endpoint_id: context?.search_endpoint_id,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function resolveEvalExecutionIdentity({
  mock = false,
  sourceEnv = process.env,
  profileModel = null,
} = {}) {
  const executionContext = {
    timeout_ms: normalizedHermesTimeoutMs(sourceEnv),
    ...resolveSearchExecutionContext(sourceEnv),
  };
  const executionContextHash = hashExecutionContext(executionContext);
  if (mock) {
    return {
      workerModel: "mock",
      judgeModel: null,
      workerEndpointId: null,
      judgeEndpointId: null,
      executionContext,
      executionContextHash,
    };
  }
  const endpointId = evalEndpointId(configuredProviderBaseUrl(sourceEnv));
  return {
    workerModel: configuredWorkerModel(sourceEnv, profileModel),
    judgeModel: configuredJudgeModel(sourceEnv),
    workerEndpointId: endpointId,
    judgeEndpointId: endpointId,
    executionContext,
    executionContextHash,
  };
}

// ── spec loading ────────────────────────────────────────────────────────────────────────────
export function loadEmployeeSpec(root, slug) {
  if (!isSafeAgentId(slug))
    throw new Error(`invalid employee slug: ${String(slug)}`);
  const path = join(root, "experts", slug, "crewclaw.employee.yaml");
  if (!existsSync(path))
    throw new Error(
      `no crewclaw.employee.yaml for "${slug}" (looked at ${path})`
    );
  const subject = snapshotEvalSubject(root, slug);
  const source = subject.specSource;
  const spec = yaml.load(source);
  const smokeTests = spec?.eval_suite?.smoke_tests;
  if (!Array.isArray(smokeTests) || smokeTests.length === 0) {
    throw new Error(`"${slug}" spec has no eval_suite.smoke_tests`);
  }
  const rubric = Array.isArray(spec?.outcome_rubric) ? spec.outcome_rubric : [];
  const passThreshold = Number(
    spec?.eval_suite?.grading?.pass_threshold ?? 0.8
  );
  const smokeIds = new Set();
  for (const test of smokeTests) {
    if (
      !test ||
      typeof test.id !== "string" ||
      !test.id.trim() ||
      smokeIds.has(test.id) ||
      typeof test.task !== "string" ||
      !test.task.trim() ||
      !Array.isArray(test.acceptance) ||
      test.acceptance.length === 0 ||
      test.acceptance.some(item => typeof item !== "string" || !item.trim())
    ) {
      throw new Error(`"${slug}" spec has an invalid smoke test contract`);
    }
    smokeIds.add(test.id);
  }
  const rubricIds = new Set();
  for (const dimension of rubric) {
    if (
      !dimension ||
      typeof dimension.id !== "string" ||
      !dimension.id.trim() ||
      rubricIds.has(dimension.id) ||
      !Number.isFinite(dimension.weight) ||
      dimension.weight <= 0 ||
      dimension.weight > 1 ||
      typeof dimension.criterion !== "string" ||
      !dimension.criterion.trim()
    ) {
      throw new Error(`"${slug}" spec has an invalid outcome rubric`);
    }
    rubricIds.add(dimension.id);
  }
  const rubricWeight = rubric.reduce(
    (sum, dimension) => sum + dimension.weight,
    0
  );
  if (rubric.length === 0 || Math.abs(rubricWeight - 1) > 0.01) {
    throw new Error(`"${slug}" outcome rubric weights must sum to 1 (±0.01)`);
  }
  if (
    !Number.isFinite(passThreshold) ||
    passThreshold <= 0 ||
    passThreshold > 1
  ) {
    throw new Error(`"${slug}" pass_threshold must be within (0,1]`);
  }
  return {
    smokeTests,
    rubric,
    passThreshold,
    specVersion: String(spec?.identity?.version ?? "0.0.0"),
    specHash: createHash("sha256").update(source).digest("hex"),
    subjectContract: subject.contractVersion,
    subjectHash: subject.subjectHash,
    dependencyHash: subject.dependencyHash,
    runtimeIdentity: subject.runtimeIdentity,
    profileModel: subject.profileModel,
  };
}

// Translate only correlated approval events into the action the runtime expects. Keeping this
// pure makes the evaluator's auto-approval policy auditable without timing-dependent tests.
export function actionForEvalEvent(event) {
  const data = event?.data;
  if (
    !data ||
    typeof data.id !== "string" ||
    !data.id ||
    typeof data.taskRunId !== "string" ||
    !data.taskRunId
  ) {
    return null;
  }
  if (
    event.type === "approval.required" &&
    data.kind === "tool_authorization"
  ) {
    const allowBrowserRender =
      data.tool === "browser_render" && data.scope === "browser";
    return {
      type: "approval.resolve",
      data: {
        id: data.id,
        taskRunId: data.taskRunId,
        kind: data.kind,
        decision: allowBrowserRender ? "allow" : "deny",
      },
    };
  }
  if (
    event.type === "approval.requested" &&
    data.kind === "deliverable_acceptance"
  ) {
    return {
      type: "approval.resolve",
      data: {
        id: data.id,
        taskRunId: data.taskRunId,
        kind: data.kind,
        decision: "accept",
      },
    };
  }
  return null;
}

export function buildEvalChildEnv({
  mock,
  runRoot,
  sourceEnv = process.env,
  workerModel,
  executionContext,
}) {
  const env = {};
  for (const key of EVAL_CHILD_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  env.CREW_TUI = "ratatui";
  env.CREWCLAW_ROOT = runRoot;
  env.CREW_DISABLE_DOTENV = "1";
  env.HERMES_TIMEOUT_MS = String(
    executionContext?.timeout_ms ?? normalizedHermesTimeoutMs(sourceEnv)
  );
  if (env.TAVILY_BASE_URL !== undefined) {
    env.TAVILY_BASE_URL = normalizeHttpEndpoint(
      String(env.TAVILY_BASE_URL).replace(/\/+$/, ""),
      "Tavily endpoint"
    );
  }
  if (mock) {
    env.HERMES_MODEL = "mock";
    // Belt and braces: the child is mock by env contract too (run.mjs honors CREW_MOCK=1), so a
    // mishandled --mock flag can never silently run a real model inside a mechanical eval. The
    // placeholder key keeps mechanical eval key-free without weakening the parent's real-mode gate.
    env.CREW_MOCK = "1";
    if (env.ZENMUX_API_KEY === undefined) env.ZENMUX_API_KEY = "eval-mock";
  } else {
    // Capture once in runEval and force that exact identifier into the child. The persisted
    // worker_model therefore describes the model the runtime actually received, even if the
    // parent environment is mutated while the benchmark is running.
    env.HERMES_MODEL = normalizeModelId(
      workerModel ?? configuredWorkerModel(sourceEnv),
      "worker model"
    );
  }
  return env;
}

function shortDiagnostic(value, limit = 1200) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

async function readJudgeResponseJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JUDGE_RESPONSE_BYTES) {
    throw new Error("judge response exceeds size limit");
  }
  if (!response.body) throw new Error("judge response body is missing");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JUDGE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("judge response exceeds size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

// ── run one smoke test through the live engine (produce → accept), return events + artifact text ──
export function runSmokeTest(
  slug,
  task,
  {
    mock,
    runtimePath = RUNTIME,
    cwd = REPO_ROOT,
    timeoutMs = SMOKE_TIMEOUT_MS,
    workerModel,
    executionContext,
    sourceEnv = process.env,
  } = {}
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const runRoot = mkdtempSync(join(tmpdir(), "crew-eval-"));
    const env = buildEvalChildEnv({
      mock,
      runRoot,
      sourceEnv,
      workerModel,
      executionContext,
    });
    const childArgs = [runtimePath, slug, ...(mock ? ["--mock"] : [])];
    const child = spawn(process.execPath, childArgs, {
      env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    const events = [];
    const answeredApprovals = new Set();
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let err = "";
    let taskRunId = null;
    let terminal = null;
    let failure = null;
    let timedOut = false;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(runRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    };
    const fail = error => {
      if (!failure) failure = error instanceof Error ? error : new Error(error);
      if (!child.killed) child.kill("SIGKILL");
    };
    const writeAction = action => {
      if (child.stdin.destroyed || child.stdin.writableEnded) {
        fail(
          new Error("runtime closed stdin before an approval could be resolved")
        );
        return;
      }
      child.stdin.write(`${JSON.stringify(action)}\n`, error => {
        if (error && !terminal) fail(error);
      });
    };
    const endInput = () => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end();
      }
    };
    const acceptLine = raw => {
      const line = raw.trim();
      if (!line || failure) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        fail(
          new Error(
            `runtime stdout is not JSONL: ${error?.message || error}: ${shortDiagnostic(line, 240)}`
          )
        );
        return;
      }
      const validation = validateTaskEvent(event);
      if (!validation.ok) {
        fail(
          new Error(
            `runtime emitted an invalid event: ${validation.errors.join("; ")}: ${shortDiagnostic(line, 320)}`
          )
        );
        return;
      }
      events.push(event);

      if (event.type === "task.started") {
        if (taskRunId && taskRunId !== event.data.id) {
          fail(
            new Error("runtime emitted multiple task.started correlation ids")
          );
          return;
        }
        taskRunId = event.data.id;
      }

      const correlatedTaskRunId = event.data?.taskRunId;
      if (correlatedTaskRunId && !taskRunId) {
        fail(
          new Error(`runtime event ${event.type} arrived before task.started`)
        );
        return;
      }
      if (
        correlatedTaskRunId &&
        taskRunId &&
        correlatedTaskRunId !== taskRunId
      ) {
        fail(
          new Error(
            `runtime event ${event.type} does not match the active taskRunId`
          )
        );
        return;
      }

      const action = actionForEvalEvent(event);
      if (action) {
        const approvalKey = `${event.type}:${event.data.id}`;
        if (!answeredApprovals.has(approvalKey)) {
          answeredApprovals.add(approvalKey);
          writeAction(action);
        }
      }

      if (TERMINAL_EVENTS.has(event.type)) {
        const terminalTaskRunId = event.data?.taskRunId || event.data?.id;
        if (!taskRunId || terminalTaskRunId !== taskRunId) {
          fail(
            new Error(
              `runtime terminal ${event.type} has no matching task.started event`
            )
          );
          return;
        }
        if (terminal) {
          fail(new Error("runtime emitted more than one terminal event"));
          return;
        }
        terminal = event;
        endInput();
      }
    };
    const consumeStdout = ({ final = false } = {}) => {
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline === -1) break;
        acceptLine(stdoutBuffer.slice(0, newline));
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
      }
      if (final && stdoutBuffer.trim()) {
        acceptLine(stdoutBuffer);
        stdoutBuffer = "";
      }
    };

    const killer = setTimeout(() => {
      timedOut = true;
      fail(new Error(`runtime smoke test timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_RUNTIME_STDOUT_BYTES) {
        fail(new Error("runtime stdout exceeded the evaluator limit"));
        return;
      }
      stdoutBuffer += decoder.write(chunk);
      consumeStdout();
    });
    child.stderr.on("data", chunk => {
      if (Buffer.byteLength(err) < MAX_RUNTIME_STDERR_BYTES) {
        err += chunk.toString();
        if (Buffer.byteLength(err) > MAX_RUNTIME_STDERR_BYTES) {
          err = Buffer.from(err)
            .subarray(0, MAX_RUNTIME_STDERR_BYTES)
            .toString();
        }
      }
    });
    child.stdin.on("error", error => {
      if (!terminal) fail(error);
    });
    child.once("error", error => {
      clearTimeout(killer);
      cleanup();
      rejectPromise(
        new Error(`failed to spawn runtime: ${error?.message || error}`)
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(killer);
      stdoutBuffer += decoder.end();
      consumeStdout({ final: true });

      const stderr = shortDiagnostic(err);
      if (failure || timedOut || code !== 0 || signal || !terminal) {
        const cause =
          failure?.message ||
          (code !== 0 || signal
            ? `runtime exited code=${String(code)} signal=${String(signal)}`
            : "runtime exited without a terminal task event");
        cleanup();
        rejectPromise(new Error(stderr ? `${cause}\n${stderr}` : cause));
        return;
      }

      // The deliverable's text: prefer reading the artifact file the engine actually wrote
      // (artifact.created carries the artifact-contract path), so we score real bytes, not a claim.
      let artifactText = "";
      const created = events.find(e => e.type === "artifact.created");
      const rawPath =
        created?.data?.artifacts?.[0]?.path ??
        created?.data?.path ??
        created?.data?.artifact?.path;
      if (rawPath) {
        const abs = isAbsolute(rawPath) ? rawPath : join(runRoot, rawPath);
        const read = readArtifactFileGuarded(runRoot, abs);
        if (!read.ok) {
          cleanup();
          rejectPromise(
            new Error(
              `runtime artifact could not be read safely: ${read.reason}`
            )
          );
          return;
        }
        artifactText = read.data.toString("utf8");
      }
      cleanup();
      resolvePromise({ events, artifactText, stderr: err, terminal });
    });

    writeAction({ type: "user.message", data: { text: task } });
  });
}

// ── grading ───────────────────────────────────────────────────────────────────────────────────
// Mechanical (mock) grade: a HARNESS smoke check, not a competency score. Under CREW_MOCK the model
// turn is canned, so we can only verify the eval pipeline ran this smoke test end-to-end and the
// engine reached a terminal state (didn't hang/crash). Whether the turn upgraded to a deliverable
// is routing-dependent and reported as an informational dimension, not a pass gate. The mock:true
// flag on the persisted result makes clear this is never a certification.
function mechanicalGrade(events, artifactText) {
  const types = new Set(events.map(e => e.type));
  const settled = types.has("task.completed");
  const produced =
    types.has("artifact.created") &&
    artifactText.trim().length >= MIN_ARTIFACT_CHARS;
  return {
    score: settled ? 100 : 0,
    passed: settled,
    dimensions: [
      {
        id: "harness_ran",
        passed: settled,
        reason: settled
          ? "smoke test 端到端跑通,引擎终态"
          : "未达终态(疑似挂起/崩溃)",
      },
      {
        id: "artifact_produced",
        passed: produced,
        reason: produced
          ? "本轮升级为交付并生成产物"
          : "本轮未升级为交付(mock 路由)",
      },
    ],
    acceptanceChecks: [],
  };
}

function lifecycleFailureGrade({ acceptance, rubric, terminal }) {
  const reason = `runtime ended with ${terminal?.type || "an unknown terminal"}`;
  return {
    score: 0,
    passed: false,
    acceptanceChecks: acceptance.map(criterion => ({
      criterion,
      passed: false,
      reason,
    })),
    dimensions: rubric.map(dimension => ({
      id: dimension.id,
      passed: false,
      weight: dimension.weight,
      reason,
    })),
  };
}

// Real grade: smoke acceptance criteria are hard gates, while the outcome rubric supplies the
// weighted score. A high average can never hide a failed acceptance criterion.
export async function gradeArtifactWithJudge(
  { task, artifactText, acceptance, rubric },
  judge
) {
  const acceptanceChecks = [];
  for (const criterion of acceptance) {
    const verdict = await judge({
      task,
      artifactText,
      acceptance,
      criterion,
      criterionKind: "smoke_acceptance",
    });
    acceptanceChecks.push({
      criterion,
      passed: verdict?.passed === true,
      reason: typeof verdict?.reason === "string" ? verdict.reason : "",
    });
  }
  const perDimension = [];
  let score = 0;
  const weightTotal = rubric.reduce(
    (sum, dimension) => sum + dimension.weight,
    0
  );
  for (const dim of rubric) {
    const verdict = await judge({
      task,
      artifactText,
      acceptance,
      criterion: dim.criterion,
      criterionKind: "outcome_rubric",
    });
    const passed = verdict?.passed === true;
    perDimension.push({
      id: dim.id,
      passed,
      weight: dim.weight,
      reason: typeof verdict?.reason === "string" ? verdict.reason : "",
    });
    if (passed) score += dim.weight * 100;
  }
  return {
    score: Math.round(score / weightTotal),
    passed:
      acceptanceChecks.every(check => check.passed) &&
      perDimension.every(dimension => dimension.passed),
    acceptanceChecks,
    dimensions: perDimension,
  };
}

// Self-contained judge model call (same OpenAI-compatible endpoint run.mjs uses). Returns
// {passed, reason} for one criterion. Kept isolated so the eval-runner never imports run.mjs
// (whose main() runs on import).
function makeJudge({ sourceEnv = process.env, identity } = {}) {
  const apiKey = sourceEnv.ZENMUX_API_KEY;
  const baseUrl = configuredProviderBaseUrl(sourceEnv);
  const model = identity?.judgeModel ?? configuredJudgeModel(sourceEnv);
  return async ({
    task,
    artifactText,
    acceptance,
    criterion,
    criterionKind,
  }) => {
    const system =
      '你是严格的评测法官。判断一份交付物是否满足给定的评判标准。只输出 JSON：{"passed": true|false, "reason": "简短理由"}。证据不足时判 false。';
    const acceptanceList = acceptance
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n");
    const user = `任务：\n${task}\n\n该 smoke test 的全部验收标准：\n${acceptanceList}\n\n交付物：\n${artifactText.slice(0, 8000)}\n\n本次检查类型：${criterionKind}\n本次评判标准：\n${criterion}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`judge model HTTP ${res.status}`);
    const data = await readJudgeResponseJson(res);
    const content = data?.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { passed: false, reason: "法官未返回可解析 JSON" };
    try {
      const parsed = JSON.parse(match[0]);
      return normalizeJudgeVerdict(parsed);
    } catch {
      return { passed: false, reason: "法官 JSON 解析失败" };
    }
  };
}

export function normalizeJudgeVerdict(value) {
  if (!value || typeof value.passed !== "boolean") {
    return { passed: false, reason: "法官 passed 字段不是布尔值" };
  }
  return {
    passed: value.passed,
    reason: typeof value.reason === "string" ? value.reason : "",
  };
}

// ── orchestration ───────────────────────────────────────────────────────────────────────────
export async function runEval(
  slug,
  {
    mock = false,
    root = REPO_ROOT,
    judge = null,
    smokeRunner = runSmokeTest,
    sourceEnv = process.env,
  } = {}
) {
  if (!mock && typeof judge !== "function") {
    throw new Error(
      "real eval requires an explicit judge model; refusing mechanical downgrade"
    );
  }
  // process.env is a live object. Snapshot it once so every smoke child and all persisted
  // provenance fields bind the same worker model and provider endpoint for the entire run.
  const capturedSourceEnv = { ...sourceEnv };
  const {
    smokeTests,
    rubric,
    passThreshold,
    specVersion,
    specHash,
    subjectContract,
    subjectHash,
    dependencyHash,
    runtimeIdentity,
    profileModel,
  } = loadEmployeeSpec(root, slug);
  const executionIdentity = resolveEvalExecutionIdentity({
    mock,
    sourceEnv: capturedSourceEnv,
    profileModel,
  });
  const perTest = [];
  for (const test of smokeTests) {
    const { events, artifactText, terminal } = await smokeRunner(
      slug,
      test.task,
      {
        mock,
        workerModel: executionIdentity.workerModel,
        executionContext: executionIdentity.executionContext,
        sourceEnv: capturedSourceEnv,
      }
    );
    let graded;
    if (mock || !judge) {
      graded = mechanicalGrade(events, artifactText);
    } else if (terminal.type !== "task.completed") {
      graded = lifecycleFailureGrade({
        acceptance: test.acceptance,
        rubric,
        terminal,
      });
    } else {
      graded = await gradeArtifactWithJudge(
        { task: test.task, artifactText, acceptance: test.acceptance, rubric },
        judge
      );
    }
    perTest.push({
      id: test.id,
      score: graded.score,
      passed: graded.passed && graded.score >= passThreshold * 100,
      acceptance_checks: graded.acceptanceChecks,
      dimensions: graded.dimensions,
    });
  }
  const score = perTest.length
    ? Math.round(perTest.reduce((s, t) => s + t.score, 0) / perTest.length)
    : 0;
  const result = {
    agent_id: slug,
    spec_version: specVersion,
    spec_hash: specHash,
    subject_contract: subjectContract,
    subject_hash: subjectHash,
    dependency_hash: dependencyHash,
    runtime_identity: runtimeIdentity,
    execution_context: executionIdentity.executionContext,
    execution_context_hash: executionIdentity.executionContextHash,
    score,
    verdict:
      perTest.every(test => test.passed) && score >= passThreshold * 100
        ? "PASS"
        : "FAIL",
    pass_threshold: passThreshold,
    // model is retained for existing TUI consumers and intentionally aliases judge_model.
    model: mock ? "mock" : executionIdentity.judgeModel,
    worker_model: executionIdentity.workerModel,
    judge_model: executionIdentity.judgeModel,
    worker_endpoint_id: executionIdentity.workerEndpointId,
    judge_endpoint_id: executionIdentity.judgeEndpointId,
    graded_by: mock || !judge ? "mechanical" : "model",
    mock,
    evaluated_at: Date.now(),
    per_test: perTest,
    per_dimension: perTest.flatMap(t =>
      t.dimensions.map(d => ({ test: t.id, ...d }))
    ),
  };
  const validation = validateEvalResult(result, {
    agentId: slug,
    expectedSpecVersion: specVersion,
    expectedSpecHash: specHash,
    expectedSubjectContract: subjectContract,
    expectedSubjectHash: subjectHash,
    expectedDependencyHash: dependencyHash,
    expectedRuntimeIdentity: runtimeIdentity,
    expectedExecutionContext: executionIdentity.executionContext,
    expectedExecutionContextHash: executionIdentity.executionContextHash,
    expectedPassThreshold: passThreshold,
    expectedSmokeTests: smokeTests,
    expectedRubric: rubric,
    expectedWorkerModel: executionIdentity.workerModel,
    expectedJudgeModel: executionIdentity.judgeModel,
    expectedWorkerEndpointId: executionIdentity.workerEndpointId,
    expectedJudgeEndpointId: executionIdentity.judgeEndpointId,
  });
  if (!validation.ok) {
    throw new Error(`generated eval evidence is invalid: ${validation.reason}`);
  }
  return result;
}

function evalPath(root, slug) {
  if (!isSafeAgentId(slug))
    throw new Error(`invalid employee slug: ${String(slug)}`);
  return resolveStatePath(
    join(root, ".crewclaw", "eval", `${slug}.json`),
    root
  );
}

export function validateEvalResult(
  result,
  {
    agentId,
    expectedSpecVersion,
    expectedSpecHash,
    expectedSubjectContract,
    expectedSubjectHash,
    expectedDependencyHash,
    expectedRuntimeIdentity,
    expectedExecutionContext,
    expectedExecutionContextHash,
    expectedPassThreshold,
    expectedSmokeTests,
    expectedRubric,
    expectedWorkerModel,
    expectedJudgeModel,
    expectedWorkerEndpointId,
    expectedJudgeEndpointId,
  } = {}
) {
  if (!result || typeof result !== "object")
    return { ok: false, reason: "result must be an object" };
  if (Object.keys(result).some(field => !EVAL_RESULT_FIELDS.has(field)))
    return { ok: false, reason: "result has fields outside the v2 contract" };
  if (!isSafeAgentId(agentId) || result.agent_id !== agentId)
    return { ok: false, reason: "agent_id mismatch or invalid" };
  if (
    typeof expectedSpecVersion !== "string" ||
    !expectedSpecVersion ||
    result.spec_version !== expectedSpecVersion
  )
    return { ok: false, reason: "spec_version mismatch or missing" };
  if (
    typeof expectedSpecHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expectedSpecHash) ||
    result.spec_hash !== expectedSpecHash
  )
    return { ok: false, reason: "spec_hash mismatch or missing" };
  if (
    typeof expectedSubjectContract !== "string" ||
    !expectedSubjectContract ||
    result.subject_contract !== expectedSubjectContract
  )
    return { ok: false, reason: "subject_contract mismatch or missing" };
  if (
    typeof expectedSubjectHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expectedSubjectHash) ||
    result.subject_hash !== expectedSubjectHash
  )
    return { ok: false, reason: "subject_hash mismatch or missing" };
  if (
    typeof expectedDependencyHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expectedDependencyHash) ||
    result.dependency_hash !== expectedDependencyHash
  )
    return { ok: false, reason: "dependency_hash mismatch or missing" };
  const runtimeFields = Object.keys(result.runtime_identity ?? {}).sort();
  const expectedRuntimeFields = Object.keys(
    expectedRuntimeIdentity ?? {}
  ).sort();
  if (
    runtimeFields.length !== RUNTIME_IDENTITY_FIELDS.length ||
    expectedRuntimeFields.length !== RUNTIME_IDENTITY_FIELDS.length ||
    runtimeFields.some(
      (field, index) => field !== RUNTIME_IDENTITY_FIELDS[index]
    ) ||
    expectedRuntimeFields.some(
      (field, index) => field !== RUNTIME_IDENTITY_FIELDS[index]
    ) ||
    RUNTIME_IDENTITY_FIELDS.some(
      field =>
        typeof result.runtime_identity[field] !== "string" ||
        !result.runtime_identity[field] ||
        result.runtime_identity[field] !== expectedRuntimeIdentity[field]
    )
  )
    return { ok: false, reason: "runtime_identity mismatch or missing" };
  const executionContextFields = Object.keys(
    result.execution_context ?? {}
  ).sort();
  const expectedExecutionContextFields = Object.keys(
    expectedExecutionContext ?? {}
  ).sort();
  if (
    executionContextFields.length !== EXECUTION_CONTEXT_FIELDS.length ||
    expectedExecutionContextFields.length !== EXECUTION_CONTEXT_FIELDS.length ||
    executionContextFields.some(
      (field, index) => field !== EXECUTION_CONTEXT_FIELDS[index]
    ) ||
    expectedExecutionContextFields.some(
      (field, index) => field !== EXECUTION_CONTEXT_FIELDS[index]
    ) ||
    !Number.isSafeInteger(result.execution_context.timeout_ms) ||
    result.execution_context.timeout_ms <= 0 ||
    result.execution_context.timeout_ms > MAX_HERMES_TIMEOUT_MS ||
    !["tavily", "serper", "brave", "ddg"].includes(
      result.execution_context.search_provider
    ) ||
    typeof result.execution_context.search_credential_present !== "boolean" ||
    !SHA256_ID.test(result.execution_context.search_endpoint_id) ||
    EXECUTION_CONTEXT_FIELDS.some(
      field =>
        result.execution_context[field] !== expectedExecutionContext[field]
    )
  )
    return { ok: false, reason: "execution_context mismatch or missing" };
  if (
    typeof result.execution_context_hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(result.execution_context_hash) ||
    typeof expectedExecutionContextHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expectedExecutionContextHash) ||
    result.execution_context_hash !== expectedExecutionContextHash ||
    result.execution_context_hash !==
      hashExecutionContext(result.execution_context)
  )
    return { ok: false, reason: "execution_context_hash mismatch or missing" };
  if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100)
    return { ok: false, reason: "score must be finite and within 0..100" };
  if (
    !Number.isFinite(result.pass_threshold) ||
    result.pass_threshold <= 0 ||
    result.pass_threshold > 1
  )
    return { ok: false, reason: "pass_threshold must be within (0,1]" };
  if (
    !Number.isFinite(expectedPassThreshold) ||
    Math.abs(result.pass_threshold - expectedPassThreshold) > 1e-12
  )
    return { ok: false, reason: "pass_threshold does not match the spec" };
  if (
    !Array.isArray(expectedSmokeTests) ||
    expectedSmokeTests.length === 0 ||
    !Array.isArray(expectedRubric) ||
    expectedRubric.length === 0
  )
    return { ok: false, reason: "expected evaluation contract is missing" };
  if (typeof result.mock !== "boolean")
    return { ok: false, reason: "mock must be an explicit boolean" };
  if (typeof result.model !== "string" || !result.model.trim())
    return { ok: false, reason: "grading model is missing" };
  if (result.mock) {
    if (
      result.graded_by !== "mechanical" ||
      result.model !== "mock" ||
      result.worker_model !== "mock" ||
      result.judge_model !== null ||
      result.worker_endpoint_id !== null ||
      result.judge_endpoint_id !== null
    )
      return { ok: false, reason: "mock score provenance is invalid" };
  } else {
    if (
      result.graded_by !== "model" ||
      !SAFE_MODEL_ID.test(result.worker_model) ||
      !SAFE_MODEL_ID.test(result.judge_model) ||
      /^(?:mock|unknown|mechanical)$/i.test(result.worker_model) ||
      /^(?:mock|unknown|mechanical)$/i.test(result.judge_model) ||
      !SAFE_MODEL_ID.test(expectedWorkerModel) ||
      !SAFE_MODEL_ID.test(expectedJudgeModel) ||
      result.worker_model !== expectedWorkerModel ||
      result.judge_model !== expectedJudgeModel ||
      result.model !== result.judge_model
    )
      return {
        ok: false,
        reason: "real score lacks valid worker/judge models",
      };
    if (
      !SHA256_ID.test(result.worker_endpoint_id) ||
      !SHA256_ID.test(result.judge_endpoint_id) ||
      !SHA256_ID.test(expectedWorkerEndpointId) ||
      !SHA256_ID.test(expectedJudgeEndpointId) ||
      result.worker_endpoint_id !== expectedWorkerEndpointId ||
      result.judge_endpoint_id !== expectedJudgeEndpointId
    )
      return { ok: false, reason: "real score endpoint identity is invalid" };
  }
  if (!Number.isFinite(result.evaluated_at) || result.evaluated_at <= 0)
    return { ok: false, reason: "evaluated_at is missing or invalid" };
  if (
    !Array.isArray(result.per_test) ||
    result.per_test.length !== expectedSmokeTests.length
  )
    return { ok: false, reason: "per_test evidence is missing" };
  const testIds = new Set();
  for (let testIndex = 0; testIndex < result.per_test.length; testIndex++) {
    const test = result.per_test[testIndex];
    const expectedTest = expectedSmokeTests[testIndex];
    if (
      !test ||
      typeof test.id !== "string" ||
      !test.id.trim() ||
      !Number.isFinite(test.score) ||
      test.score < 0 ||
      test.score > 100 ||
      typeof test.passed !== "boolean" ||
      !Array.isArray(test.dimensions) ||
      test.dimensions.length === 0 ||
      testIds.has(test.id)
    )
      return { ok: false, reason: "per_test evidence is malformed" };
    if (test.id !== expectedTest?.id)
      return { ok: false, reason: "per_test ids do not match the spec" };
    testIds.add(test.id);
    if (!Array.isArray(test.acceptance_checks))
      return { ok: false, reason: "acceptance evidence is missing" };
    if (result.mock) {
      if (test.acceptance_checks.length !== 0)
        return { ok: false, reason: "mock acceptance evidence is invalid" };
    } else {
      if (
        !Array.isArray(expectedTest?.acceptance) ||
        test.acceptance_checks.length !== expectedTest.acceptance.length
      )
        return { ok: false, reason: "acceptance evidence does not match spec" };
      for (
        let acceptanceIndex = 0;
        acceptanceIndex < test.acceptance_checks.length;
        acceptanceIndex++
      ) {
        const check = test.acceptance_checks[acceptanceIndex];
        if (
          check?.criterion !== expectedTest.acceptance[acceptanceIndex] ||
          typeof check.passed !== "boolean" ||
          typeof check.reason !== "string"
        )
          return {
            ok: false,
            reason: "acceptance evidence does not match spec",
          };
      }
    }
    const dimensionIds = new Set();
    const expectedDimensions = result.mock
      ? [
          { id: "harness_ran", weight: undefined },
          { id: "artifact_produced", weight: undefined },
        ]
      : expectedRubric;
    if (test.dimensions.length !== expectedDimensions.length)
      return { ok: false, reason: "dimension ids do not match the spec" };
    for (
      let dimensionIndex = 0;
      dimensionIndex < test.dimensions.length;
      dimensionIndex++
    ) {
      const dimension = test.dimensions[dimensionIndex];
      const expectedDimension = expectedDimensions[dimensionIndex];
      if (
        !dimension ||
        typeof dimension.id !== "string" ||
        !dimension.id.trim() ||
        dimensionIds.has(dimension.id) ||
        typeof dimension.passed !== "boolean" ||
        typeof dimension.reason !== "string" ||
        (!result.mock &&
          (!Number.isFinite(dimension.weight) ||
            dimension.weight <= 0 ||
            dimension.weight > 1))
      )
        return { ok: false, reason: "dimension evidence is malformed" };
      if (
        dimension.id !== expectedDimension.id ||
        (!result.mock &&
          Math.abs(dimension.weight - expectedDimension.weight) > 1e-12)
      )
        return { ok: false, reason: "dimension evidence does not match spec" };
      dimensionIds.add(dimension.id);
    }
    let recomputedScore;
    let recomputedPassed;
    if (result.mock) {
      const harness = test.dimensions.find(
        dimension => dimension.id === "harness_ran"
      );
      if (!harness)
        return { ok: false, reason: "mock harness evidence is missing" };
      recomputedScore = harness.passed ? 100 : 0;
      recomputedPassed =
        harness.passed && recomputedScore >= result.pass_threshold * 100;
    } else {
      const weightTotal = test.dimensions.reduce(
        (sum, dimension) => sum + dimension.weight,
        0
      );
      if (Math.abs(weightTotal - 1) > 0.01)
        return { ok: false, reason: "dimension weights must sum to 1 (±0.01)" };
      recomputedScore = Math.round(
        test.dimensions.reduce(
          (sum, dimension) =>
            sum + (dimension.passed ? dimension.weight * 100 : 0),
          0
        ) / weightTotal
      );
      recomputedPassed =
        test.acceptance_checks.every(check => check.passed) &&
        test.dimensions.every(dimension => dimension.passed) &&
        recomputedScore >= result.pass_threshold * 100;
    }
    if (test.score !== recomputedScore || test.passed !== recomputedPassed)
      return { ok: false, reason: "per_test score does not match evidence" };
  }
  const recomputedTotal = Math.round(
    result.per_test.reduce((sum, test) => sum + test.score, 0) /
      result.per_test.length
  );
  if (result.score !== recomputedTotal)
    return { ok: false, reason: "total score does not match per_test average" };
  const expectedVerdict =
    result.per_test.every(test => test.passed) &&
    result.score >= result.pass_threshold * 100
      ? "PASS"
      : "FAIL";
  if (result.verdict !== expectedVerdict)
    return { ok: false, reason: "verdict does not match per_test evidence" };
  const flattened = result.per_test.flatMap(test =>
    test.dimensions.map(dimension => ({ test: test.id, ...dimension }))
  );
  if (
    !Array.isArray(result.per_dimension) ||
    result.per_dimension.length !== flattened.length ||
    flattened.some((expected, index) => {
      const actual = result.per_dimension[index];
      return (
        actual?.test !== expected.test ||
        actual?.id !== expected.id ||
        actual?.passed !== expected.passed ||
        actual?.reason !== expected.reason ||
        actual?.weight !== expected.weight
      );
    })
  )
    return { ok: false, reason: "per_dimension evidence does not match tests" };
  return { ok: true };
}

function evalValidationContract(
  specRoot,
  agentId,
  { mock = false, sourceEnv = process.env } = {}
) {
  const spec = loadEmployeeSpec(specRoot, agentId);
  const identity = resolveEvalExecutionIdentity({
    mock,
    sourceEnv,
    profileModel: spec.profileModel,
  });
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

// Defensive read for the TUI bridge (mirrors kpi.mjs readKpi). Returns the compact eval summary
// the EVAL screen needs, or null when no eval has been run — never fabricates a score.
export function readEvalResult(
  root,
  agentId,
  { specRoot = REPO_ROOT, validationContract } = {}
) {
  if (!isSafeAgentId(agentId)) return null;
  try {
    const path = evalPath(root, agentId);
    return withStateLock(
      `${path}.lock`,
      () => {
        if (!existsSync(path)) return null;
        const r = JSON.parse(
          readStateFileGuarded(path, { root }).toString("utf8")
        );
        // Production reads bind the stored result to the employee spec currently on disk. Tests
        // and offline importers may provide the whole contract explicitly, but partial contracts
        // are never filled from the untrusted result itself.
        const contract =
          validationContract ??
          evalValidationContract(specRoot, agentId, { mock: r.mock });
        const validation = validateEvalResult(r, {
          ...contract,
          agentId,
        });
        if (!validation.ok) return null;
        return {
          score: r.score,
          verdict: String(
            r.verdict ??
              (r.score >= (r.pass_threshold ?? 0.8) * 100 ? "PASS" : "FAIL")
          ),
          model: String(r.model ?? "unknown"),
          worker_model: String(r.worker_model ?? "unknown"),
          judge_model:
            r.judge_model === null ? null : String(r.judge_model ?? "unknown"),
          graded_by: String(r.graded_by ?? "mechanical"),
          mock: r.mock,
          evaluated_at: Number(r.evaluated_at ?? 0),
          exams: Array.isArray(r.per_test)
            ? r.per_test.map(t => ({
                id: String(t.id),
                score: Number(t.score ?? 0),
                passed: Boolean(t.passed),
              }))
            : [],
        };
      },
      { root }
    );
  } catch {
    return null;
  }
}

// Persist, guarding a real certification score from being clobbered by a mechanical mock run.
export function persistEval(
  root,
  result,
  { force = false, specRoot = REPO_ROOT, validationContract } = {}
) {
  let contract;
  try {
    contract =
      validationContract ??
      evalValidationContract(specRoot, result?.agent_id, {
        mock: result?.mock,
      });
  } catch (error) {
    return {
      path: null,
      written: false,
      reason: `invalid eval result: ${error?.message || error}`,
    };
  }
  const validation = validateEvalResult(result, {
    ...contract,
    agentId: result?.agent_id,
  });
  if (!validation.ok) {
    return {
      path: null,
      written: false,
      reason: `invalid eval result: ${validation.reason}`,
    };
  }
  let path = null;
  try {
    path = evalPath(root, result.agent_id);
    return withStateLock(
      `${path}.lock`,
      () => {
        // The provenance check and replacement are one critical section. Otherwise a mock writer
        // can observe "no real score" and race a real writer to the final rename.
        if (result.mock && !force && existsSync(path)) {
          let prior;
          try {
            prior = JSON.parse(
              readStateFileGuarded(path, { root }).toString("utf8")
            );
          } catch (error) {
            return {
              path,
              written: false,
              reason: `refusing to overwrite an unreadable existing score with a mock run: ${error?.message || error}`,
            };
          }
          // Protect every explicitly real record, including a certification for an older spec.
          // Stale records are hidden by readEvalResult, but a mock run still cannot erase them.
          if (prior?.mock === false) {
            return {
              path,
              written: false,
              reason:
                "refusing to overwrite a real (mock:false) score with a mock run; use --force",
            };
          }
        }
        writeJsonAtomic(path, result, { root });
        return { path, written: true };
      },
      { root }
    );
  } catch (error) {
    return {
      path,
      written: false,
      reason: `eval result was not persisted safely: ${error?.message || error}`,
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv.find(a => !a.startsWith("--"));
  // Environment variables are not user intent. Only the explicit CLI flag may create a
  // non-certifying mechanical result; inherited CREW_MOCK can never downgrade a real eval.
  const mock = argv.includes("--mock");
  const asJson = argv.includes("--json");
  const force = argv.includes("--force");
  if (!slug) {
    console.error(
      "usage: node packages/runtime/eval-runner.mjs <slug> [--mock] [--json] [--force]"
    );
    process.exit(2);
  }
  if (!mock && !process.env.ZENMUX_API_KEY) {
    console.error(
      "Error: real eval needs ZENMUX_API_KEY (or pass --mock for a mechanical harness run). Refusing to silently downgrade."
    );
    process.exit(1);
  }
  const sourceEnv = { ...process.env };
  const judge = mock ? null : makeJudge({ sourceEnv });
  const result = await runEval(slug, {
    mock,
    judge,
    sourceEnv,
  });
  const { path, written, reason } = persistEval(REPO_ROOT, result, { force });

  if (asJson) {
    console.log(
      JSON.stringify({ ...result, persisted: written, path, reason }, null, 2)
    );
  } else {
    const tag = result.mock ? " \x1b[33m[MOCK · 机械跑,非认证分]\x1b[0m" : "";
    console.log(`\n${slug} · ${result.verdict} · ${result.score}/100${tag}`);
    console.log(
      `  graded_by: ${result.graded_by} · worker: ${result.worker_model} · judge: ${result.judge_model ?? "none"} · threshold: ${result.pass_threshold}`
    );
    for (const t of result.per_test) {
      console.log(
        `  ${t.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${t.id} — ${t.score}/100`
      );
    }
    console.log(written ? `  → wrote ${path}` : `  → NOT written: ${reason}`);
  }
  // A completed grading run that could not be persisted is an infrastructure failure. Returning
  // success here makes CI/release automation treat an invalid, stale, or blocked certification as
  // durable even though the command just printed "NOT written".
  process.exit(written ? 0 : 1);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    console.error(`Error: ${error?.message ?? error}`);
    process.exit(1);
  });
}
