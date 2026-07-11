// M1 behavior-level guard: the legacy_learning rollback switch must actually gate active-memory
// writes end to end. task-mode-approval.test.mjs already proves flag=ON writes memory (it injects
// a dream review and asserts memory.length >= 2). This is the flag=OFF counterpart: same accepted
// flow, CREW_LEGACY_LEARNING=0 → zero active-memory writes, but the approval chain stays intact
// and an immutable Reflection is still written (the new pipeline is always on in this branch).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { loadMemory } from "../memory-store.mjs";
import { startMockModel } from "./mock-model.mjs";
import { REPO_ROOT, RUNTIME_ENTRY } from "./test-paths.mjs";

const AGENT_ID = "ai-adoption-whale";
const TASK_ID = "research-seed-2.1";
const DELIVERABLE = [
  "## 官方名称",
  "Doubao-Seed-2.1（火山引擎 Seed 2.1）。",
  "",
  "## 价格",
  "输入 6 元 / 输出 30 元（每百万 token）。",
  "",
  "## 上下文",
  "256k token。",
  "",
  "## 能力",
  "Coding、Agent、推理、多模态。",
  "",
  "## 来源",
  "https://www.volcengine.com/product/ark （官方文档）。",
  "",
  "## 置信度",
  "高（官方文档交叉验证）。",
  "",
  "## 建议",
  "推荐接入 CrewClaw，作为选型候选之一。",
].join("\n");

const DREAM_REVIEW = {
  summary: "复盘：官方来源可靠。",
  new_memory_candidates: [
    { category: "reliable_sources", text: "https://www.volcengine.com/product/ark", confidence: "high" },
  ],
  new_playbook_candidates: [],
  confidence: "high",
  needs_user_review: true,
};

function runOnce(root, modelUrl, legacyFlag) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(RUNTIME_ENTRY ? process.execPath : "node", [RUNTIME_ENTRY, AGENT_ID, "--task", TASK_ID], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CREW_TUI: "ratatui",
        CREW_MOCK: "0",
        CREW_LEGACY_LEARNING: legacyFlag,
        CREWCLAW_ROOT: root,
        ZENMUX_API_KEY: "test",
        ZENMUX_BASE_URL: modelUrl,
        TAVILY_API_KEY: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    const events = [];
    let buffer = "";
    let stderr = "";
    let sentAccept = false;

    const handleLine = line => {
      const text = line.trim();
      if (!text) return;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        return;
      }
      events.push(event);
      if (event.type === "approval.requested" && !sentAccept) {
        sentAccept = true;
        child.stdin.write(
          `${JSON.stringify({
            type: "approval.resolve",
            data: { id: event.data.id, kind: "deliverable_acceptance", decision: "accept" },
          })}\n`
        );
      }
    };

    child.stdout.on("data", chunk => {
      buffer += decoder.write(chunk);
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (buffer.trim()) handleLine(buffer);
      // give the child a moment; close after accept settles
      resolvePromise({ code, events, stderr });
    });

    // safety timeout
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 40_000).unref();
  });
}

const model = await startMockModel([{ content: DELIVERABLE }], { dreamResponse: DREAM_REVIEW });
try {
  // flag OFF: no active-memory write, approval chain intact, reflection still written.
  const off = mkdtempSync(join(tmpdir(), "crew-legacy-off-"));
  try {
    const result = await runOnce(off, model.url, "0");
    const types = result.events.map(e => e.type);
    assert.ok(types.includes("approval.requested"), "approval chain still runs with legacy off");
    assert.ok(
      types.includes("approval.accepted") || types.includes("task.completed"),
      `accept settled with legacy off\n${result.stderr}`
    );

    const mem = loadMemory(off, AGENT_ID);
    const items = mem.ok ? mem.items : [];
    assert.equal(items.length, 0, "legacy_learning=0 must write ZERO active memory");

    // The new pipeline is always on: an immutable reflection lands regardless of the legacy flag.
    const reflectDir = join(off, ".crewclaw", "reflections", AGENT_ID);
    assert.ok(existsSync(reflectDir), "reflection directory created");
    assert.ok(
      readdirSync(reflectDir).some(f => f.endsWith(".json")),
      "an immutable reflection was written even with legacy learning off"
    );
  } finally {
    rmSync(off, { recursive: true, force: true });
  }

  console.log("dream-legacy-flag.test.mjs passed");
} finally {
  await model.close();
}
