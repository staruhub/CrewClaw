// Proof of WebFetchExtract's requires_render state (the火山 JS-shell fix): fetching
// a JS-rendered shell page returns a clean "requires_render" refusal — NOT 8000 chars
// of nav chrome — so the agent pivots instead of flailing. The fixture must be a public URL because
// the production SSRF boundary correctly rejects loopback fetches.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { startMockModel } from "./mock-model.mjs";
import {
  createRuntimeTestRoot,
  REPO_ROOT,
  RUNTIME_ENTRY,
} from "./test-paths.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = t => t.replace(ANSI_RE, "");

async function run() {
  const target = process.env.CREW_LIVE_JS_SHELL_URL;
  assert.match(
    target || "",
    /^https?:\/\//,
    "CREW_LIVE_JS_SHELL_URL must be a public http(s) fixture"
  );

  const scenario = [
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "f1",
            type: "function",
            function: {
              name: "web_fetch",
              arguments: JSON.stringify({
                url: target,
                extract: "Seed 2.1 价格与上下文",
              }),
            },
          },
        ],
      },
    ],
    [{ content: "这页是 JS 空壳，我改用 web_search 找可读来源。" }],
  ];
  const { url, close } = await startMockModel(scenario);
  const root = createRuntimeTestRoot("crew-e2e-jsshell-");

  try {
    const child = spawn(
      process.execPath,
      [RUNTIME_ENTRY, "ai-adoption-whale", "查 Seed 2.1"],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          CREW_MD: "1",
          ZENMUX_API_KEY: "test",
          ZENMUX_BASE_URL: url,
          HERMES_MODEL: "anthropic/claude-opus-4.8",
          CREWCLAW_ROOT: root,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", d => {
      stdout += d;
    });
    child.stderr.on("data", d => {
      stderr += d;
    });

    const [code] = await once(child, "close");
    assert.equal(
      code,
      0,
      `run.mjs exited with ${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`
    );

    const plain = stripAnsi(stdout);
    // A real-content page would dump text; a JS shell renders as a skipped fetch.
    assert.match(
      plain,
      /已跳过/,
      `JS-shell fetch should become a requires_render/skipped state, got:\n${plain}`
    );
    assert.match(
      plain,
      /改用 web_search/,
      "the agent should pivot, not eat nav chrome"
    );

    console.log(
      "e2e-jsshell: JS-shell page → requires_render (no chrome dump) — all assertions passed"
    );
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

await run();
