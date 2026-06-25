// Proof of Step 1 — Search Provider Preflight: a research task with NO search
// provider configured must NOT silently flail. Non-interactive → auto-degrade to
// "知识库初判" (not counted effective), with a clear preflight notice. (Search Harness v1.)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOT = "/c/Users/12117/Playground/crewclaw/crewhire";
const ROOT_NATIVE = "C:/Users/12117/Playground/crewclaw/crewhire";
const RUN = "C:/Users/12117/Playground/crewclaw/crewhire/packages/runtime/run.mjs";
const stripAnsi = (t) => t.replace(ANSI_RE, "");

async function run() {
  const scenario = [
    [{ content: "（降级初判）基于已有知识，Seed 2.1 可能存在但 [需核实]。来源：暂无可靠来源。置信度：低。建议：先配置搜索 key。" }],
  ];
  const { url, close } = await startMockModel(scenario);
  let taskId = "";

  try {
    // Strip every search-provider key so pickBackend() falls back to ddg (no provider).
    const env = { ...process.env };
    delete env.TAVILY_API_KEY;
    delete env.SERPER_API_KEY;
    delete env.BRAVE_API_KEY;

    const child = spawn("node", [RUN, "ai-adoption-whale", "--task", "research-seed-2.1"], {
      cwd: process.cwd(),
      env: {
        ...env,
        CREW_MD: "1",
        ZENMUX_API_KEY: "test",
        ZENMUX_BASE_URL: url,
        HERMES_MODEL: "anthropic/claude-opus-4.8",
        CREWCLAW_ROOT: ROOT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

    assert.match(plain, /Preflight/, "should announce the search-provider preflight");
    assert.match(plain, /未配置 Web Search Provider/, "should name the missing provider");
    assert.match(plain, /降级运行/, "non-interactive should auto-degrade, not flail");
    assert.match(plain, /✗ 有效任务/, "a degraded run must not count as an effective task");

    console.log("e2e-preflight: no-provider research task degrades cleanly — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    if (taskId) {
      for (const p of [`${taskId}.json`, `${taskId}.report.md`]) {
        try { rmSync(join(ROOT_NATIVE, ".crewclaw", "runs", p), { force: true }); } catch {}
      }
    }
  }
}

await run();
