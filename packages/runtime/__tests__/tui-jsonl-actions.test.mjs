// The Ratatui bridge carries PendingActions across lines: a task that produces an artifact emits
// accept/revise/reveal actions, and a later "1" line ACCEPTS it (the digit matches the action,
// not a model guess) — across the process boundary. Controlled streams so we push "1" only AFTER
// the first task finishes (the busy guard correctly ignores input mid-task).
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import os from "node:os";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const input = new Readable({ read() {} });
const lines = [];
const output = new Writable({
  write(chunk, _enc, cb) { for (const l of String(chunk).split("\n")) { const t = l.trim(); if (t) lines.push(JSON.parse(t)); } cb(); },
});
const types = () => lines.map((e) => e.type);

// a fake engine turn that returns a real deliverable → route persists it + emits pending.actions
const agentLoop = async () => "# 服务器清理报告\n\n## 结论\n年化节省约 30 万元。\n".repeat(8);

const done = startJsonlBridge({ agentLoop, meta: { mode: "Chat" }, input, output, root: os.tmpdir() });
await sleep(20);

input.push("给我一份服务器清理报告\n"); // employee_task → artifact → pending.actions
await sleep(80);
const pa = lines.find((e) => e.type === "pending.actions");
assert.ok(pa, "bridge emits pending.actions after a deliverable");
assert.ok(pa.data.actions.some((a) => a.action_type === "accept" && a.key === "1"), "[1] accept offered");
assert.ok(lines.some((e) => e.type === "artifact.created"), "real artifact created");

// the task has finished (busy cleared) — now "1" accepts it across the boundary
input.push("1\n");
await sleep(80);
const upd = lines.find((e) => e.type === "artifact.updated");
assert.ok(upd && upd.data.patch.status === "accepted", "the '1' line accepted the artifact via the bridge");

input.push("/exit\n");
await sleep(20);
await done;

console.log("tui-jsonl-actions tests passed");
