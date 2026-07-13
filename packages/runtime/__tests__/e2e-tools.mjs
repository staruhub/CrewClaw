import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

function visibleLen(text) {
  let n = 0;
  for (const ch of text)
    n +=
      /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
        ch
      )
        ? 2
        : 1;
  return n;
}

function contentLines(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map(line => line.replace(/^.*?› ?/u, ""))
    .filter(line => line.trim() !== "")
    .filter(line => !/· model .* · \d+ skills · live$/.test(line))
    .filter(line => !/^\s*→ workspace-file\.txt \(\d+ 行\)$/.test(line));
}

async function run() {
  const scenario = [
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "c1",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "workspace-file.txt" }),
            },
          },
        ],
      },
    ],
    [{ content: "工具调用完成。\n" }, { content: "这是最终中文文本。" }],
  ];

  const { url, close } = await startMockModel(scenario);
  const root = createRuntimeTestRoot("crew-e2e-tools-");
  // Seed a workspace file so a role-allowed structured read renders one compact activity line.
  writeFileSync(join(root, "workspace-file.txt"), "seeded for ls\n");

  try {
    const child = spawn(
      process.execPath,
      [
        RUNTIME_ENTRY,
        "code-review-shrimp",
        "请先读取 workspace-file.txt，然后用中文给出最终答复",
      ],
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
    const lines = plain.split(/\r?\n/);
    const toolLines = lines.filter(line =>
      /^\s*→ workspace-file\.txt \(\d+ 行\)$/.test(line)
    );

    assert.equal(
      toolLines.length,
      1,
      `expected one compact tool line, got:\n${plain}`
    );
    assert.doesNotMatch(
      plain,
      /╭─|╰─|│ /,
      "expected compact tool output, not a multi-line card"
    );

    const finalLines = contentLines(stdout).filter(line =>
      /工具调用完成|这是最终中文文本/u.test(line)
    );
    assert.ok(
      finalLines.length >= 2,
      `expected final rendered text lines, got:\n${plain}`
    );
    assert.deepEqual(
      finalLines.filter(line => !line.startsWith("   ")),
      [],
      "expected each final non-empty content line to start at the 3-space content column"
    );

    const longLines = lines.filter(line => visibleLen(line) > 79);
    assert.deepEqual(
      longLines,
      [],
      "expected no visible output line to exceed 79 columns"
    );

    console.log("All assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    if (error.actual !== undefined || error.expected !== undefined) {
      console.error("Actual:", error.actual);
      console.error("Expected:", error.expected);
    }
    process.exitCode = 1;
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

await run();
