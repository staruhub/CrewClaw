// L2 approval (§14.3): agentLoop's confirm() now surfaces as a workbench modal and BLOCKS until
// the human picks allow/deny — replacing the old confirm:async()=>true auto-yes. Tests the core
// machinery (event-bridge) + that the modal renders + that resolving lets the turn proceed.
// (The literal a/d keypress→resolveApproval mapping is useInput, inactive without a TTY — same
// keyboard layer the user verifies live; here we call store.resolveApproval as the handler does.)
import assert from "node:assert/strict";
import React from "react";
import htm from "htm";
import { render } from "ink-testing-library";
import { ChatApp } from "../tui/chat.mjs";
import { createWorkbenchStore } from "../tui/workbench-store.mjs";
import { createTaskRun } from "../tui/event-bridge.mjs";
import { buildRunTurn } from "../tui/repl.mjs";

const html = htm.bind(React.createElement);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (text) => String(text).split("\n").map((l) => "   " + l);

// 1) core machinery: confirm() blocks → awaitingApproval → allow resolves true
{
  const run = createTaskRun({});
  run.start("t");
  let resolved = null;
  const p = run.sink.confirm("执行命令: rm -rf x").then((v) => { resolved = v; });
  assert.ok(run.awaitingApproval(), "confirm() makes the run await a decision");
  assert.ok(run.get().approval, "APPROVAL_REQUIRED set state.approval (modal data)");
  assert.equal(resolved, null, "BLOCKED until decided — no auto-yes");
  run.resolveApproval("allow");
  await p;
  assert.equal(resolved, true, "allow → confirm() resolves true (tool proceeds)");
  assert.ok(!run.awaitingApproval(), "cleared after decision");
  assert.equal(run.get().approval, null, "approval cleared in state");
}

// 2) deny path → confirm() resolves false (tool is skipped)
{
  const run = createTaskRun({});
  let resolved = null;
  const p = run.sink.confirm("删除文件?").then((v) => { resolved = v; });
  run.resolveApproval("deny");
  await p;
  assert.equal(resolved, false, "deny → confirm() resolves false");
}

// 3) the modal RENDERS in the real ChatApp, the agent is blocked, and resolving (what the a-key
//    handler calls) lets the turn proceed.
{
  let decided = null;
  const runTurn = async (text, sink) => {
    sink.onDelta("准备执行命令…");
    decided = await sink.confirm("执行命令: rm -rf ./tmp");
    sink.onDelta(decided ? "\n已执行。" : "\n已取消。");
  };
  const store = createWorkbenchStore({ employee: { name: "鲸" }, mode: "Chat" });
  const submitRef = { current: null };
  const out = render(html`<${ChatApp} store=${store} runTurn=${runTurn} agentName="鲸" renderLines=${stub} submitRef=${submitRef} meta=${{ model: "anthropic/claude-opus-4.8" }} />`);
  await sleep(20);
  submitRef.current("给我一份服务器清理报告"); // employee_task → runs the model turn → confirm()
  await sleep(90);
  assert.match(out.lastFrame(), /需要授权/, "approval modal shown in the workbench");
  assert.match(out.lastFrame(), /\[a\] 允许/, "modal shows allow/deny choices");
  assert.equal(decided, null, "agent BLOCKED awaiting the human decision");
  store.resolveApproval("allow"); // what the a-key handler invokes
  await sleep(90);
  assert.equal(decided, true, "approval resolved → the turn proceeds");
  assert.match(out.frames.join("\n"), /已执行/, "post-approval output rendered");
  out.unmount();
}

// 4) the REAL path: buildRunTurn must hand the run's sink.confirm to agentLoop, so crew chat
//    uses the modal gate — NOT the confirm:async()=>true auto-yes fallback. If this regressed,
//    awaitingApproval() would be false (auto-yes resolves instantly) and this would fail.
{
  let confirmReceived = false;
  const agentLoop = async (deps) => {
    confirmReceived = typeof deps.confirm === "function";
    const ok = await deps.confirm("执行命令: rm -rf x"); // blocks until the UI decides
    return ok ? "done" : "skipped";
  };
  const run = createTaskRun({});
  run.start("t");
  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps: { confirm: async () => true }, history: [], saveSession: null });
  const pending = runTurn("删点东西", run.sink); // don't await — it blocks on approval
  await sleep(10);
  assert.ok(confirmReceived, "agentLoop received a confirm()");
  assert.ok(run.awaitingApproval(), "buildRunTurn wired sink.confirm → run AWAITS the modal (auto-yes overridden)");
  run.resolveApproval("allow");
  assert.equal(await pending, "done", "allow → agentLoop proceeded");
}

console.log("tui-approval tests passed");
