// Proof of Step 5 — Budget Guard: a research task that keeps hitting JS shells stops
// after 2 (instead of flailing across 8 steps for $1.83). The shell fixture must be public because
// the production SSRF boundary correctly rejects loopback fetches.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { loadMemory } from "../memory-store.mjs";
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

  // The model keeps fetching the same JS shell — the guard must cut it off at 2.
  const fetchTurn = () => [
    {
      tool_calls: [
        {
          index: 0,
          id: "f",
          type: "function",
          function: {
            name: "web_fetch",
            arguments: JSON.stringify({ url: target }),
          },
        },
      ],
    },
  ];
  const scenario = [fetchTurn(), fetchTurn(), [{ content: "（不该到这）" }]];
  const { url, close } = await startMockModel(scenario);
  const root = createRuntimeTestRoot("crew-e2e-budget-");

  try {
    const child = spawn(
      process.execPath,
      [RUNTIME_ENTRY, "ai-adoption-whale", "--task", "research-seed-2.1"],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          CREW_MD: "1",
          ZENMUX_API_KEY: "test",
          ZENMUX_BASE_URL: url,
          HERMES_MODEL: "anthropic/claude-opus-4.8",
          CREWCLAW_ROOT: root,
          TAVILY_API_KEY: "test", // skip preflight — we're testing the budget guard, not preflight
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
    assert.match(plain, /预算守门/, "should announce the budget guard stop");
    assert.match(
      plain,
      /多次抓到 JS 空壳/,
      "should stop after repeated JS shells, not keep flailing"
    );
    assert.doesNotMatch(
      plain,
      /📕 复盘出 \d+ 条失败教训/,
      "an unaccepted failed output must not claim committed failure memory"
    );
    assert.deepEqual(
      loadMemory(root, "ai-adoption-whale").items,
      [],
      "failure lessons from an unaccepted output remain unsearchable"
    );

    console.log(
      "e2e-budget: repeated JS-shell flail stopped by the budget guard — all assertions passed"
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
