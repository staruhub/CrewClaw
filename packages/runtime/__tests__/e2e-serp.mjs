// Proof that web_fetch refuses to scrape a search-engine result page (the $1.83
// flail from the real run: it fetched duckduckgo.com/html). The block is enforced
// in runTool, not just the prompt, so a stuck agent cannot burn budget on SERPs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startMockModel } from "./mock-model.mjs";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOT = "/c/Users/12117/Playground/crewclaw/crewhire";
const RUN = "C:/Users/12117/Playground/crewclaw/crewhire/packages/runtime/run.mjs";
const stripAnsi = (t) => t.replace(ANSI_RE, "");

async function run() {
  const scenario = [
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "f1",
            type: "function",
            function: { name: "web_fetch", arguments: JSON.stringify({ url: "https://duckduckgo.com/html/?q=Seed+2.1+volcengine" }) },
          },
        ],
      },
    ],
    [{ content: "明白，改用 web_search 找来源。" }],
  ];

  const { url, close } = await startMockModel(scenario);

  try {
    const child = spawn("node", [RUN, "ai-adoption-whale", "查一下 Seed 2.1"], {
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
    assert.match(plain, /duckduckgo\.com.*已跳过/, `the SERP fetch should render as refused, got:\n${plain}`);
    assert.match(plain, /改用 web_search/, "the agent should continue past the block, not re-flail");

    console.log("e2e-serp: SERP scrape blocked at the tool level — all assertions passed");
  } catch (error) {
    console.error(`Assertion failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

await run();
