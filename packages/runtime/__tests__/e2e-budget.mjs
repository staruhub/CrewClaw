// Proof of Step 5 — Budget Guard: a research task that keeps hitting JS shells stops
// after 2 (instead of flailing across 8 steps for $1.83). Serves the shell locally.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOT = "/c/Users/12117/Playground/crewclaw/crewhire";
const ROOT_NATIVE = "C:/Users/12117/Playground/crewclaw/crewhire";
const RUN = "C:/Users/12117/Playground/crewclaw/crewhire/packages/runtime/run.mjs";
const stripAnsi = (t) => t.replace(ANSI_RE, "");

const SHELL_HTML =
  '<!doctype html><html><head><title>火山方舟</title></head><body>' +
  '<nav><a href="/">Home</a></nav><div id="root"></div>' +
  '<script>window.__NEXT_DATA__={}</script></body></html>';

async function run() {
  const page = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(SHELL_HTML);
  });
  await new Promise((r) => page.listen(0, "127.0.0.1", r));
  const port = page.address().port;
  const target = `http://127.0.0.1:${port}/docs/seed`;

  // The model keeps fetching the same JS shell — the guard must cut it off at 2.
  const fetchTurn = () => [{ tool_calls: [{ index: 0, id: "f", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: target }) } }] }];
  const scenario = [fetchTurn(), fetchTurn(), [{ content: "（不该到这）" }]];
  const { url, close } = await startMockModel(scenario);
  let taskId = "";

  try {
    const child = spawn("node", [RUN, "ai-adoption-whale", "--task", "research-seed-2.1"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CREW_MD: "1",
        ZENMUX_API_KEY: "test",
        ZENMUX_BASE_URL: url,
        HERMES_MODEL: "anthropic/claude-opus-4.8",
        CREWCLAW_ROOT: ROOT,
        TAVILY_API_KEY: "test", // skip preflight — we're testing the budget guard, not preflight
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
    assert.match(plain, /预算守门/, "should announce the budget guard stop");
    assert.match(plain, /多次抓到 JS 空壳/, "should stop after repeated JS shells, not keep flailing");
    assert.match(plain, /📕 复盘出 \d+ 条失败教训/, "Dream should learn failure lessons from the run (Step 6)");

    console.log("e2e-budget: repeated JS-shell flail stopped by the budget guard — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    await new Promise((r) => page.close(r));
    if (taskId) {
      for (const p of [`${taskId}.json`, `${taskId}.report.md`, `${taskId}.evidence.json`]) {
        try { rmSync(join(ROOT_NATIVE, ".crewclaw", "runs", p), { force: true }); } catch {}
      }
      try { rmSync(join(ROOT_NATIVE, ".crewclaw", "memory", "ai-adoption-whale.json"), { force: true }); } catch {}
    }
  }
}

await run();
