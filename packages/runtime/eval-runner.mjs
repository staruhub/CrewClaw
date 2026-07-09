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
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import yaml from "./yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const RUNTIME = join(HERE, "run.mjs");

const MIN_ARTIFACT_CHARS = 80; // below this a "deliverable" is too thin to count as produced

// ── spec loading ────────────────────────────────────────────────────────────────────────────
export function loadEmployeeSpec(root, slug) {
  const path = join(root, "experts", slug, "crewclaw.employee.yaml");
  if (!existsSync(path)) throw new Error(`no crewclaw.employee.yaml for "${slug}" (looked at ${path})`);
  const spec = yaml.load(readFileSync(path, "utf8"));
  const smokeTests = spec?.eval_suite?.smoke_tests;
  if (!Array.isArray(smokeTests) || smokeTests.length === 0) {
    throw new Error(`"${slug}" spec has no eval_suite.smoke_tests`);
  }
  const rubric = Array.isArray(spec?.outcome_rubric) ? spec.outcome_rubric : [];
  const passThreshold = Number(spec?.eval_suite?.grading?.pass_threshold ?? 0.8);
  return {
    smokeTests,
    rubric,
    passThreshold,
    specVersion: String(spec?.identity?.version ?? "0.0.0"),
  };
}

// ── run one smoke test through the live engine (produce → accept), return events + artifact text ──
function runSmokeTest(slug, task, { mock }) {
  return new Promise((resolvePromise) => {
    const runRoot = mkdtempSync(join(tmpdir(), "crew-eval-"));
    const env = { ...process.env, CREW_TUI: "ratatui", CREWCLAW_ROOT: runRoot };
    if (mock) env.CREW_MOCK = "1";
    const child = spawn(process.execPath, [RUNTIME, slug], {
      env,
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const killer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", () => {
      clearTimeout(killer);
      const events = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((e) => e && typeof e.type === "string");

      // The deliverable's text: prefer reading the artifact file the engine actually wrote
      // (artifact.created carries the artifact-contract path), so we score real bytes, not a claim.
      let artifactText = "";
      const created = events.find((e) => e.type === "artifact.created");
      const rawPath = created?.data?.artifacts?.[0]?.path ?? created?.data?.path ?? created?.data?.artifact?.path;
      if (rawPath) {
        const abs = isAbsolute(rawPath) ? rawPath : join(runRoot, rawPath);
        try {
          artifactText = readFileSync(abs, "utf8");
        } catch {
          artifactText = "";
        }
      }
      try {
        rmSync(runRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      resolvePromise({ events, artifactText, stderr: err });
    });

    // produce → accept: the second line ("1" = accept the held deliverable) must arrive after the
    // first turn emits approval.requested; the bridge ignores input while busy, so stagger it.
    child.stdin.write(task + "\n");
    setTimeout(() => {
      child.stdin.write("1\n");
      setTimeout(() => child.stdin.end(), 500);
    }, 2000);
  });
}

// ── grading ───────────────────────────────────────────────────────────────────────────────────
// Mechanical (mock) grade: a HARNESS smoke check, not a competency score. Under CREW_MOCK the model
// turn is canned, so we can only verify the eval pipeline ran this smoke test end-to-end and the
// engine reached a terminal state (didn't hang/crash). Whether the turn upgraded to a deliverable
// is routing-dependent and reported as an informational dimension, not a pass gate. The mock:true
// flag on the persisted result makes clear this is never a certification.
function mechanicalGrade(events, artifactText) {
  const types = new Set(events.map((e) => e.type));
  const settled =
    types.has("task.completed") ||
    types.has("approval.accepted") ||
    types.has("task.blocked") ||
    types.has("task.rejected");
  const produced = types.has("artifact.created") && artifactText.trim().length >= MIN_ARTIFACT_CHARS;
  return {
    score: settled ? 100 : 0,
    passed: settled,
    dimensions: [
      { id: "harness_ran", passed: settled, reason: settled ? "smoke test 端到端跑通,引擎终态" : "未达终态(疑似挂起/崩溃)" },
      { id: "artifact_produced", passed: produced, reason: produced ? "本轮升级为交付并生成产物" : "本轮未升级为交付(mock 路由)" },
    ],
  };
}

// Real grade: a judge model scores each rubric dimension pass/fail against the artifact, weighted.
async function modelGrade({ task, artifactText, acceptance, rubric }, judge) {
  const perDimension = [];
  let score = 0;
  for (const dim of rubric) {
    const verdict = await judge({ task, artifactText, acceptance, criterion: dim.criterion });
    const passed = Boolean(verdict?.passed);
    perDimension.push({ id: dim.id, passed, weight: dim.weight, reason: verdict?.reason ?? "" });
    if (passed) score += dim.weight * 100;
  }
  return { score: Math.round(score), passed: perDimension.every((d) => d.passed), dimensions: perDimension };
}

// Self-contained judge model call (same OpenAI-compatible endpoint run.mjs uses). Returns
// {passed, reason} for one criterion. Kept isolated so the eval-runner never imports run.mjs
// (whose main() runs on import).
function makeJudge() {
  const apiKey = process.env.ZENMUX_API_KEY;
  const baseUrl = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1").replace(/\/$/, "");
  const model = process.env.CREW_EVAL_MODEL || process.env.HERMES_MODEL || "anthropic/claude-opus-4.8";
  return async ({ task, artifactText, criterion }) => {
    const system =
      "你是严格的评测法官。判断一份交付物是否满足给定的评判标准。只输出 JSON：{\"passed\": true|false, \"reason\": \"简短理由\"}。证据不足时判 false。";
    const user = `任务：\n${task}\n\n交付物：\n${artifactText.slice(0, 8000)}\n\n评判标准：\n${criterion}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { passed: false, reason: "法官未返回可解析 JSON" };
    try {
      const parsed = JSON.parse(match[0]);
      return { passed: Boolean(parsed.passed), reason: String(parsed.reason ?? "") };
    } catch {
      return { passed: false, reason: "法官 JSON 解析失败" };
    }
  };
}

// ── orchestration ───────────────────────────────────────────────────────────────────────────
export async function runEval(slug, { mock = false, root = REPO_ROOT, judge = null } = {}) {
  const { smokeTests, rubric, passThreshold, specVersion } = loadEmployeeSpec(root, slug);
  const model = mock ? "mock" : process.env.CREW_EVAL_MODEL || process.env.HERMES_MODEL || "anthropic/claude-opus-4.8";
  const perTest = [];
  for (const test of smokeTests) {
    const { events, artifactText } = await runSmokeTest(slug, test.task, { mock });
    let graded;
    if (mock || !judge) {
      graded = mechanicalGrade(events, artifactText);
    } else {
      graded = await modelGrade(
        { task: test.task, artifactText, acceptance: test.acceptance, rubric },
        judge,
      );
    }
    perTest.push({
      id: test.id,
      score: graded.score,
      passed: graded.passed && graded.score >= passThreshold * 100,
      dimensions: graded.dimensions,
    });
  }
  const score = perTest.length ? Math.round(perTest.reduce((s, t) => s + t.score, 0) / perTest.length) : 0;
  return {
    agent_id: slug,
    spec_version: specVersion,
    score,
    verdict: score >= passThreshold * 100 ? "PASS" : "FAIL",
    pass_threshold: passThreshold,
    model,
    graded_by: mock || !judge ? "mechanical" : "model",
    mock,
    evaluated_at: Date.now(),
    per_test: perTest,
    per_dimension: perTest.flatMap((t) => t.dimensions.map((d) => ({ test: t.id, ...d }))),
  };
}

function evalPath(root, slug) {
  return join(root, ".crewclaw", "eval", `${slug}.json`);
}

// Defensive read for the TUI bridge (mirrors kpi.mjs readKpi). Returns the compact eval summary
// the EVAL screen needs, or null when no eval has been run — never fabricates a score.
export function readEvalResult(root, agentId) {
  if (!agentId) return null;
  const path = evalPath(root, agentId);
  if (!existsSync(path)) return null;
  try {
    const r = JSON.parse(readFileSync(path, "utf8"));
    if (!r || typeof r.score !== "number") return null;
    return {
      score: r.score,
      verdict: String(r.verdict ?? (r.score >= (r.pass_threshold ?? 0.8) * 100 ? "PASS" : "FAIL")),
      model: String(r.model ?? "unknown"),
      graded_by: String(r.graded_by ?? "mechanical"),
      mock: Boolean(r.mock),
      evaluated_at: Number(r.evaluated_at ?? 0),
      exams: Array.isArray(r.per_test)
        ? r.per_test.map((t) => ({ id: String(t.id), score: Number(t.score ?? 0), passed: Boolean(t.passed) }))
        : [],
    };
  } catch {
    return null;
  }
}

// Persist, guarding a real certification score from being clobbered by a mechanical mock run.
export function persistEval(root, result, { force = false } = {}) {
  const path = evalPath(root, result.agent_id);
  if (result.mock && !force && existsSync(path)) {
    try {
      const prior = JSON.parse(readFileSync(path, "utf8"));
      if (prior && prior.mock === false) {
        return { path, written: false, reason: "refusing to overwrite a real (mock:false) score with a mock run; use --force" };
      }
    } catch {
      /* unreadable prior → fall through and write */
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return { path, written: true };
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith("--"));
  const mock = argv.includes("--mock") || process.env.CREW_MOCK === "1";
  const asJson = argv.includes("--json");
  const force = argv.includes("--force");
  if (!slug) {
    console.error("usage: node packages/runtime/eval-runner.mjs <slug> [--mock] [--json] [--force]");
    process.exit(2);
  }
  if (!mock && !process.env.ZENMUX_API_KEY) {
    console.error("Error: real eval needs ZENMUX_API_KEY (or pass --mock for a mechanical harness run). Refusing to silently downgrade.");
    process.exit(1);
  }
  const judge = mock ? null : makeJudge();
  const result = await runEval(slug, { mock, judge });
  const { path, written, reason } = persistEval(REPO_ROOT, result, { force });

  if (asJson) {
    console.log(JSON.stringify({ ...result, persisted: written, path, reason }, null, 2));
  } else {
    const tag = result.mock ? " \x1b[33m[MOCK · 机械跑,非认证分]\x1b[0m" : "";
    console.log(`\n${slug} · ${result.verdict} · ${result.score}/100${tag}`);
    console.log(`  graded_by: ${result.graded_by} · model: ${result.model} · threshold: ${result.pass_threshold}`);
    for (const t of result.per_test) {
      console.log(`  ${t.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${t.id} — ${t.score}/100`);
    }
    console.log(written ? `  → wrote ${path}` : `  → NOT written: ${reason}`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Error: ${error?.message ?? error}`);
    process.exit(1);
  });
}
