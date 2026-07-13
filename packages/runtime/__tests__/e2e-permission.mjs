// Proof that an L2 (confirm) tool surfaces a human-readable permission request
// before acting — the gateway "讲人话" path. (PRD v0.3 §13.2.) The model attempts a
// test_run; the runtime should print the permission copy, then (non-interactive)
// decline to execute it. The employee contract explicitly disables arbitrary writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startMockModel } from "./mock-model.mjs";
import {
  createRuntimeTestRoot,
  REPO_ROOT,
  RUNTIME_ENTRY,
} from "./test-paths.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = t => t.replace(ANSI_RE, "");

async function run() {
  const scenario = [
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "w1",
            type: "function",
            function: {
              name: "test_run",
              arguments: JSON.stringify({ script: "test" }),
            },
          },
        ],
      },
    ],
    [{ content: "已停止：非交互模式不写入。" }],
  ];

  const { url, close } = await startMockModel(scenario);
  const root = createRuntimeTestRoot("crew-e2e-permission-");
  mkdirSync(join(root, ".crewclaw"), { recursive: true });
  writeFileSync(
    join(root, ".crewclaw", "team.json"),
    JSON.stringify([
      {
        employee_id: "code-review-shrimp",
        status: "active",
        permissions_granted: ["capability:test.run"],
      },
    ])
  );

  try {
    const child = spawn(
      process.execPath,
      [RUNTIME_ENTRY, "code-review-shrimp", "请运行仓库测试"],
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
    assert.match(
      plain,
      /想使用 test_run/,
      "should announce the tool in human terms"
    );
    assert.match(
      plain,
      /读写你工作区的文件/,
      "should translate the scope to plain language"
    );
    assert.match(
      plain,
      /风险等级：中/,
      "should state the risk level for an L2 write"
    );

    console.log(
      "e2e-permission: confirm-path permission copy surfaced — all assertions passed"
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
