// End-to-end proof of the v0.3 Task Runtime: `crew run <agent> --task <id>`
// resolves a manifest demo task, runs it through the gated agent loop, records a
// TaskRun (state machine), stores an artifact, grades the deliverable against the
// rubric + required sections, and prints the acceptance panel. (PRD v0.3 §8.2/§15.)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOT_POSIX = "/c/Users/12117/Playground/crewclaw/crewhire";
const ROOT_NATIVE = "C:/Users/12117/Playground/crewclaw/crewhire";
const RUN = "C:/Users/12117/Playground/crewclaw/crewhire/packages/runtime/run.mjs";
const stripAnsi = (t) => t.replace(ANSI_RE, "");

async function run() {
  // A well-formed research deliverable: required sections (来源/置信度/建议), a URL
  // source, confidence labels, and several rubric fields — so it should grade valid.
  const deliverable = [
    "## 官方名称", "Doubao-Seed-2.1（火山引擎 Seed 2.1）。", "",
    "## 价格", "输入 6 元 / 输出 30 元（每百万 token）。", "",
    "## 上下文", "256k token。", "",
    "## 能力", "Coding、Agent、推理、多模态。", "",
    "## 来源", "https://www.volcengine.com/product/ark （官方文档）。", "",
    "## 置信度", "高（官方文档交叉验证）。", "",
    "## 建议", "推荐接入 CrewClaw，作为选型候选之一。",
  ].join("\n");

  const scenario = [
    [{ tool_calls: [{ index: 0, id: "b1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) } }] }],
    [{ content: deliverable }],
  ];
  const { url, close } = await startMockModel(scenario);
  let taskId = "";
  let artifactId = "";

  try {
    const child = spawn(
      "node",
      [RUN, "ai-adoption-whale", "--task", "research-seed-2.1"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CREW_MD: "1",
          ZENMUX_API_KEY: "test",
          ZENMUX_BASE_URL: url,
          HERMES_MODEL: "anthropic/claude-opus-4.8",
          CREWCLAW_ROOT: ROOT_POSIX,
          TAVILY_API_KEY: "test", // a provider is configured → no preflight, happy path
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    const [code] = await once(child, "close");
    assert.equal(code, 0, `run.mjs exited with ${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);

    const plain = stripAnsi(stdout);
    taskId = (plain.match(/runs\/(task_\d+)\.json/) || [])[1] || "";
    artifactId = (plain.match(/(artifact_\d+)/) || [])[1] || "";

    assert.match(plain, /研究计划/, "should show the Search Planner before working");
    assert.match(plain, /site:volcengine\.com/, "the plan should include an official-domain query");
    assert.match(plain, /官方名称|Doubao-Seed-2\.1/, "the deliverable should be rendered live");
    assert.match(plain, /任务验收/, "should print the acceptance panel");
    assert.match(plain, /✓ 结构达标/, `required sections should validate, got:\n${plain}`);
    assert.match(plain, /✓ 验收规则/, `rubric rule-check should pass, got:\n${plain}`);
    assert.match(plain, /状态 delivered/, "should reach delivered (no user signal when piped)");
    assert.match(plain, /反馈：skipped/, "effective feedback skipped when stdin is not a TTY");
    assert.match(plain, /TaskRun → \.crewclaw\/runs\/task_/, "should persist a TaskRun record");
    assert.match(plain, /Cost: \$/, "should show the task token cost (Budget Guard)");
    assert.match(plain, /📓 沉淀 \d+ 条记忆/, "should learn memory candidates (sources/facts/playbook) from the run");
    assert.match(plain, /🔖 \d+ 条证据卡/, "should bind cited sources to evidence cards (Evidence Store)");
    assert.match(plain, /员工动作/, "should show the action recap (event summaries)");
    assert.match(plain, /正在执行命令/, "the bash call should render as a human action line");

    console.log("e2e-task: --task closed loop (resolve → gate → grade → record → learn) — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    // best-effort cleanup of the demo artifacts this run created
    for (const p of [
      taskId && join(ROOT_NATIVE, ".crewclaw", "runs", `${taskId}.json`),
      taskId && join(ROOT_NATIVE, ".crewclaw", "runs", `${taskId}.report.md`),
      taskId && join(ROOT_NATIVE, ".crewclaw", "runs", `${taskId}.evidence.json`),
      artifactId && join(ROOT_NATIVE, ".crewclaw", "artifacts", `${artifactId}.json`),
      artifactId && join(ROOT_NATIVE, ".crewclaw", "artifacts", `${artifactId}.md`),
      join(ROOT_NATIVE, ".crewclaw", "memory", "ai-adoption-whale.json"),
    ]) {
      if (p) { try { rmSync(p, { force: true }); } catch {} }
    }
  }
}

await run();
