// L2 approval over the process boundary (Ratatui path): the jsonl-bridge must emit
// approval.required and BLOCK until the front sends back an a/d line — not auto-yes. Drives the
// real startJsonlBridge with injected streams + a fake agentLoop that calls confirm().
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const input = new Readable({ read() {} });
const lines = [];
const output = new Writable({
  write(chunk, _enc, cb) { for (const l of String(chunk).split("\n")) { const t = l.trim(); if (t) lines.push(JSON.parse(t)); } cb(); },
});
const types = () => lines.map((e) => e.type);

// fake engine turn: streams, asks approval before a "sensitive" tool, reports the decision
const agentLoop = async (deps) => {
  deps.onDelta("准备执行 rm…");
  const ok = await deps.confirm("执行命令: rm -rf ./tmp");
  deps.onDelta(ok ? "已执行" : "已取消");
  return ok ? "done" : "skipped";
};

const done = startJsonlBridge({ agentLoop, agentLoopDeps: { confirm: async () => true }, meta: { mode: "Chat" }, input, output });
await sleep(20);
assert.ok(types().includes("session.ready"), "bridge emits session.ready on start");

// a formal task → model turn → confirm() → approval.required, then BLOCK
input.push("给我一份服务器清理报告\n");
await sleep(80);
assert.ok(types().includes("approval.required"), "bridge emits approval.required (NOT auto-yes)");
assert.ok(!types().includes("approval.resolved"), "blocked — no decision emitted yet");
assert.ok(!lines.some((e) => e.type === "token.delta" && /已执行/.test(e.data.text)), "tool has NOT run yet");

// the front sends back the decision line "a" → resolve allow → agent proceeds
input.push("a\n");
await sleep(80);
const resolved = lines.find((e) => e.type === "approval.resolved");
assert.ok(resolved && resolved.data.decision === "allow", "the a-line resolved the approval to allow");
assert.ok(lines.some((e) => e.type === "token.delta" && /已执行/.test(e.data.text)), "agent proceeded after approval");

input.push("/exit\n");
await sleep(20);
await done;

// ── v0.18 P0-b regression: a STRUCTURED approval.resolve (tool authorization) must resolve the
// confirm but emit ONLY approval.resolved — never approval.accepted/rejected, whose semantics are
// deliverable acceptance (the front-end counts them into the 已验收 KPI + notification).
{
  const input2 = new Readable({ read() {} });
  const lines2 = [];
  const output2 = new Writable({
    write(chunk, _enc, cb) { for (const l of String(chunk).split("\n")) { const t = l.trim(); if (t) lines2.push(JSON.parse(t)); } cb(); },
  });
  const types2 = () => lines2.map((e) => e.type);
  const done2 = startJsonlBridge({ agentLoop, agentLoopDeps: { confirm: async () => true }, meta: { mode: "Chat" }, input: input2, output: output2 });
  await sleep(20);
  input2.push("给我一份服务器清理报告\n");
  await sleep(80);
  assert.ok(types2().includes("approval.required"), "scenario2: approval.required emitted");

  input2.push('{"type":"approval.resolve","data":{"id":"appr1","decision":"allow"}}\n');
  await sleep(80);
  const resolved2 = lines2.find((e) => e.type === "approval.resolved");
  assert.ok(resolved2 && resolved2.data.decision === "allow", "structured approval.resolve resolves to allow");
  assert.ok(!types2().includes("approval.accepted"), "tool authorization must NOT emit approval.accepted (KPI pollution)");
  assert.ok(!types2().includes("approval.rejected"), "tool authorization must NOT emit approval.rejected");
  assert.ok(lines2.some((e) => e.type === "token.delta" && /已执行/.test(e.data.text)), "agent proceeded after structured allow");

  // Stale approval.resolve (no pending confirm) → silently dropped, still no acceptance events.
  input2.push('{"type":"approval.resolve","data":{"id":"stale","decision":"allow"}}\n');
  await sleep(50);
  assert.ok(!types2().includes("approval.accepted"), "stale approval.resolve emits nothing");

  input2.push("/exit\n");
  await sleep(20);
  await done2;
}

console.log("tui-jsonl-approval tests passed");
