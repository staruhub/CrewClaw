// Renders the real ChatApp (workbench / TaskRun model) via ink-testing-library and drives a
// turn through a fake runTurn that streams via the bridge sink, asserting the frames: user
// turn → work timeline + answer → session tokens. No TTY.
import assert from "node:assert/strict";
import React from "react";
import htm from "htm";
import { render } from "ink-testing-library";
import { ChatApp } from "../tui/chat.mjs";
import { createWorkbenchStore } from "../tui/workbench-store.mjs";

const html = htm.bind(React.createElement);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (text) => String(text).split("\n").map((l) => "   " + l);

// fake engine turn: streams an answer + one tool through the bridge sink
const runTurn = async (text, sink) => {
  sink.onDelta("我先搜一下");
  sink.onInvocation({ toolName: "web_search", args: { query: text }, output: "（3 条结果）", line: `🔎 "${text}" (3 条)`, status: "success" });
  sink.onUsage({ prompt_tokens: 500, completion_tokens: 100 });
};

const store = createWorkbenchStore({ employee: { name: "鲸" }, mode: "Chat" });
const submitRef = { current: null };
const out = render(html`<${ChatApp} store=${store} runTurn=${runTurn} agentName="鲸" renderLines=${stub} submitRef=${submitRef} meta=${{ model: "anthropic/claude-opus-4.8" }} />`);
const all = () => out.frames.join("\n");

await sleep(20);
assert.match(out.lastFrame(), /就绪/, "idle status before any turn");

// a formal task → the Router upgrades it to a TaskRun and runs the model turn
await submitRef.current("给我一份内部知识问答 ROI 报告");
await sleep(90);
assert.match(all(), /ROI 报告/, "user turn rendered");
assert.match(all(), /我先搜一下/, "answer text rendered (the model turn ran)");
assert.match(all(), /🔎|ROI/, "tool lands as a timeline line with its result summary");
assert.match(out.lastFrame(), /600\/90k tok/, "session usage + context budget (used/hard) in the status header");
assert.match(out.lastFrame(), /就绪/, "back to idle after the turn");
assert.equal(store.get().live, null, "live turn cleared after commit");
assert.equal(store.get().turns.length, 2, "user + assistant turn committed");

// a quick utility (天气) shows the ⚡ badge — visibly NOT a TaskRun / 不计绩效 (§5.3/§6.2)
await submitRef.current("杭州天气?");
await sleep(90);
assert.match(all(), /快捷工具/, "quick utility shows a distinct ⚡ badge (not counted as employee work)");

out.unmount();
console.log("tui-chat tests passed");
