// End-to-end proof that the Permission Gateway is wired into the live agent loop:
// when the model tries an unauthorized (L4) tool, the gateway DENIES it before
// runTool ever sees it, feeds the refusal back to the model, and the run still
// completes cleanly. (PRD v0.3 §13 — declare in manifest, enforce at the gateway.)
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

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

async function run() {
  // Turn 1: the model asks to delete a file (L4 dangerous → must be denied).
  // Turn 2: the model acknowledges and gives a final answer.
  const scenario = [
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "d1",
            type: "function",
            function: {
              name: "delete_file",
              arguments: JSON.stringify({ path: "important.txt" }),
            },
          },
        ],
      },
    ],
    [{ content: "我没有删除文件的权限，已停止操作。" }],
  ];

  const { url, close } = await startMockModel(scenario);
  const root = createRuntimeTestRoot("crew-e2e-gateway-");

  try {
    const child = spawn(
      process.execPath,
      [RUNTIME_ENTRY, "ai-adoption-whale", "请删除 important.txt 这个文件"],
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
    child.stdout.on("data", data => {
      stdout += data;
    });
    child.stderr.on("data", data => {
      stderr += data;
    });

    const [code] = await once(child, "close");
    assert.equal(
      code,
      0,
      `run.mjs exited with ${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`
    );

    const plain = stripAnsi(stdout);

    // The dangerous call was refused at the gateway (surfaced as a skipped tool line).
    assert.match(
      plain,
      /已跳过/,
      `expected the denied tool to show as skipped, got:\n${plain}`
    );
    // The run continued to the model's final answer rather than crashing.
    assert.match(
      plain,
      /我没有删除文件的权限/,
      `expected the final answer after the deny, got:\n${plain}`
    );
    // The gateway blocked it BEFORE runTool, so we never see the unknown-tool fallthrough.
    assert.doesNotMatch(
      plain,
      /未知工具：delete_file/,
      "gateway should deny before runTool's unknown-tool path"
    );

    console.log("e2e-gateway: deny path enforced — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

await run();
