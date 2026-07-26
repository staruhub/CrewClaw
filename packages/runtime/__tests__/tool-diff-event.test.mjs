import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { runTool } from "../run.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await pause(10);
  }
  assert.fail(message);
}

const root = mkdtempSync(join(tmpdir(), "crewclaw-tool-diff-"));
try {
  writeFileSync(join(root, "note.txt"), "before\nkeep\n", "utf8");
  const result = await runTool(
    "edit_file",
    { path: "note.txt", old_string: "before", new_string: "after" },
    {
      root,
      quiet: true,
      permission: { decision: "allow", scope: "workspace", level: "L1" },
    }
  );
  assert.match(result, /✓ 已写入 note\.txt/);
  assert.match(result, /- before/);
  assert.match(result, /\+ after/);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "after\nkeep\n");

  // W2 process-boundary proof: the exact real tool result, including diff rows, survives the
  // Node JSONL bridge as tool.succeeded.detail for the Rust timeline renderer.
  const input = new Readable({ read() {} });
  const events = [];
  let outputBuffer = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputBuffer += String(chunk);
      const lines = outputBuffer.split("\n");
      outputBuffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
      callback();
    },
  });
  const done = startJsonlBridge({
    root,
    input,
    output,
    meta: { mode: "Chat", agentId: "diff-tester" },
    agentLoop: async options => {
      options.onToolEvent({
        id: "edit-diff-call",
        toolName: "edit_file",
        phase: "requested",
        args: { path: "note.txt" },
      });
      options.onToolEvent({
        id: "edit-diff-call",
        toolName: "edit_file",
        phase: "running",
      });
      options.onToolEvent({
        id: "edit-diff-call",
        toolName: "edit_file",
        phase: "succeeded",
        summary: "已更新 note.txt",
        detail: result,
      });
      options.onDelta("文件已更新。");
      return "文件已更新。";
    },
  });
  await pause(10);
  input.push("请编辑 note.txt 并汇报差异\n");
  const event = await waitFor(
    () =>
      events.find(
        candidate =>
          candidate.type === "tool.succeeded" &&
          candidate.data.id === "edit-diff-call"
      ),
    `JSONL tool diff event missing: ${JSON.stringify(events)}`
  );
  assert.match(event.data.detail, /- before/);
  assert.match(event.data.detail, /\+ after/);
  input.push("/exit\n");
  await done;
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("tool-diff-event.test.mjs passed");
