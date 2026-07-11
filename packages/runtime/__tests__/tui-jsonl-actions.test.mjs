// The Ratatui bridge carries PendingActions across lines: a task that produces an artifact emits
// accept/revise/reveal actions, and a later "1" line ACCEPTS it (the digit matches the action,
// not a model guess) — across the process boundary. Controlled streams so we push "1" only AFTER
// the first task finishes (the busy guard correctly ignores input mid-task).
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { createRuntimeTestRoot } from "./test-paths.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const input = new Readable({ read() {} });
const root = createRuntimeTestRoot("crew-tui-jsonl-actions-");
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const lines = [];
const output = new Writable({
  write(chunk, _enc, cb) {
    for (const l of String(chunk).split("\n")) {
      const t = l.trim();
      if (t) lines.push(JSON.parse(t));
    }
    cb();
  },
});
const types = () => lines.map(e => e.type);
async function waitForEvent(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = lines.find(predicate);
    if (event) return event;
    await sleep(10);
  }
  throw new Error(
    `${label}; observed ${types().join(",")}; tail ${JSON.stringify(lines.slice(-3))}`
  );
}

// a fake engine turn that returns a real deliverable → route persists it + emits pending.actions
const agentLoop = async () =>
  "# 服务器清理报告\n\n## 结论\n年化节省约 30 万元。\n".repeat(8);

const done = startJsonlBridge({
  agentLoop,
  meta: { mode: "Chat", agentId: "test-agent" },
  input,
  output,
  root,
});
await waitForEvent(event => event.type === "session.ready", "bridge not ready");

input.push("给我一份服务器清理报告\n"); // employee_task → artifact → pending.actions
const pa = await waitForEvent(
  event =>
    event.type === "pending.actions" &&
    event.data.actions.some(action => action.action_type === "accept"),
  "bridge did not offer artifact acceptance"
);
assert.ok(pa, "bridge emits pending.actions after a deliverable");
assert.ok(
  pa.data.actions.some(a => a.action_type === "accept" && a.key === "1"),
  "[1] accept offered"
);
assert.ok(
  lines.some(e => e.type === "artifact.created"),
  "real artifact created"
);

// the task has finished (busy cleared) — now "1" accepts it across the boundary
input.push("1\n");
const upd = await waitForEvent(
  event =>
    event.type === "artifact.updated" && event.data.patch.status === "accepted",
  "bridge did not accept the artifact"
);
assert.ok(
  upd && upd.data.patch.status === "accepted",
  "the '1' line accepted the artifact via the bridge"
);

// v0.15 P0-1 regression: accepting the deliverable RELEASES the digit bindings. The last
// pending.actions emit must be empty, so a later "2" switches to MARKET instead of re-triggering
// the stale revise action (the user's real bug: digits captured forever after one delivery).
const pendingEmits = lines.filter(e => e.type === "pending.actions");
assert.ok(
  pendingEmits.length >= 2,
  "a second pending.actions (the clear) is emitted after accept"
);
assert.deepEqual(
  pendingEmits[pendingEmits.length - 1].data.actions,
  [],
  "after accept the pending list is empty — digits are free to switch screens again"
);

input.push("/exit\n");
await done;
rmSync(root, { recursive: true, force: true });

console.log("tui-jsonl-actions tests passed");
