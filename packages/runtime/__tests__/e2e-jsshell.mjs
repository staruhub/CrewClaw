// Proof of WebFetchExtract's requires_render state (the火山 JS-shell fix): fetching
// a JS-rendered shell page returns a clean "requires_render" refusal — NOT 8000 chars
// of nav chrome — so the agent pivots instead of flailing. Serves the shell locally.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOT = "/c/Users/12117/Playground/crewclaw/crewhire";
const RUN = "C:/Users/12117/Playground/crewclaw/crewhire/packages/runtime/run.mjs";
const stripAnsi = (t) => t.replace(ANSI_RE, "");

const SHELL_HTML =
  '<!doctype html><html><head><title>火山方舟 模型文档</title></head><body>' +
  '<nav><a href="/">首页</a><a href="/docs">文档</a><a href="/login">登录</a></nav>' +
  '<div id="root"></div>' +
  '<script>window.__NEXT_DATA__={"props":{}}</script></body></html>';

async function run() {
  const page = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(SHELL_HTML);
  });
  await new Promise((r) => page.listen(0, "127.0.0.1", r));
  const port = page.address().port;
  const target = `http://127.0.0.1:${port}/docs/seed-2-1`;

  const scenario = [
    [{ tool_calls: [{ index: 0, id: "f1", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: target, extract: "Seed 2.1 价格与上下文" }) } }] }],
    [{ content: "这页是 JS 空壳，我改用 web_search 找可读来源。" }],
  ];
  const { url, close } = await startMockModel(scenario);

  try {
    const child = spawn("node", [RUN, "ai-adoption-whale", "查 Seed 2.1"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
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
    // A real-content page would dump text; a JS shell renders as a skipped fetch.
    assert.match(plain, /已跳过/, `JS-shell fetch should become a requires_render/skipped state, got:\n${plain}`);
    assert.match(plain, /改用 web_search/, "the agent should pivot, not eat nav chrome");

    console.log("e2e-jsshell: JS-shell page → requires_render (no chrome dump) — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    await new Promise((r) => page.close(r));
  }
}

await run();
