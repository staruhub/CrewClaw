import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const RUNTIME_LABEL_RE = /^.*?› ?/u;
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const chineseParagraph =
  "这是一个用于验证终端富文本渲染换行能力的中文长段落没有任何空格它必须被按照可见列宽硬换行否则输出会超过终端宽度并破坏阅读体验所以这里继续添加足够多的连续汉字确保测试可以稳定覆盖无空格文本的折行行为";

const assistantText = [
  "## Title",
  "",
  chineseParagraph,
  "",
  "- item1",
  "- item2",
  "- item3",
  "",
  "| Name | Value | Note |",
  "| --- | --- | --- |",
  "| Alpha | One | First row |",
  "| Beta | Two | Second row |",
  "",
].join("\n");

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

function chunkText(text, size = 20) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push({ content: text.slice(i, i + size) });
  }
  return chunks;
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

function renderedContentLines(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map(line => line.replace(RUNTIME_LABEL_RE, ""))
    .filter(line => line.trim() !== "")
    .filter(line => !/· model .* · \d+ skills · live$/.test(line))
    .filter(line => !/下班了/.test(line));
}

function assertRendered(output) {
  const plain = stripAnsi(output);
  const lines = renderedContentLines(output);

  assert.ok(lines.length > 0, "expected rendered assistant output lines");

  const badIndent = lines.filter(line => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const listTextColumn = line.search(/item\d/u);
    const isList = line.includes("• item");
    return isList ? listTextColumn < 4 : indent < 2;
  });
  assert.deepEqual(
    badIndent,
    [],
    "expected each content line to be gutter-indented"
  );

  assert.match(
    plain,
    /┌.*┬.*┐|╔.*╦.*╗/s,
    "expected rendered table to contain box-drawing border chars"
  );

  const longLines = lines.filter(line => visibleLen(line) > 79);
  assert.deepEqual(
    longLines,
    [],
    "expected no visible rendered content line to exceed 79 columns"
  );

  const chineseLines = lines.filter(line => /[\u4e00-\u9fff]/u.test(line));
  assert.ok(
    chineseLines.length >= 2,
    "expected long Chinese paragraph to wrap onto multiple lines"
  );
}

async function run() {
  const scenario = chunkText(assistantText);
  const { url, close } = await startMockModel(scenario);

  try {
    const child = spawn(
      "node",
      ["packages/runtime/run.mjs", "ai-adoption-whale", "test task"],
      {
        cwd,
        env: {
          ...process.env,
          ZENMUX_API_KEY: "test",
          ZENMUX_BASE_URL: url,
          HERMES_MODEL: "anthropic/claude-opus-4.8",
          CREW_MD: "1",
          CREWCLAW_ROOT: cwd,
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
    assertRendered(stdout);
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
  }
}

await run();
