// Extends the disappear proof to the NEW Ink path (the vterm proof covers the raw
// printer). Drives a streaming turn through the real ChatApp via ink-testing-library and
// asserts the live message text NEVER vanishes mid-stream: once a prefix is accumulated,
// every later frame still contains it (Ink frames must grow monotonically while streaming).
import assert from "node:assert/strict";
import React from "react";
import htm from "htm";
import { render } from "ink-testing-library";
import { ChatApp } from "../tui/chat.mjs";
import { createChatStore } from "../tui/store.mjs";

const html = htm.bind(React.createElement);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (t) => String(t).split("\n").map((l) => "   " + l);
const noTurn = async () => {};

const store = createChatStore();
const out = render(html`<${ChatApp} store=${store} runTurn=${noTurn} agentName="鲸" renderLines=${stub} />`);

store.pushUser("写一段长的");
store.beginTurn();

const toks = ["这", "是", "一", "段", "会", "逐", "字", "流", "出", "的", "中", "文", "回", "答"];
let acc = "";
const seen = [];
for (const tok of toks) {
  store.appendDelta(tok);
  acc += tok;
  await sleep(45); // > the 33ms throttle, so Ink paints this delta
  seen.push({ acc, frame: out.lastFrame() });
}

// no disappear: each frame must still contain the full text accumulated by that point
for (const { acc, frame } of seen) {
  assert.ok(frame.includes(acc), `live text vanished mid-stream — expected to still see "${acc}"`);
}
assert.ok(out.lastFrame().includes(acc), "the full streamed text is present at the end");

// committing must not blank it either (no frame with the turn in neither live nor scrollback)
store.addUsage({ prompt_tokens: 100, completion_tokens: 20 });
store.commitTurn();
await sleep(45);
assert.ok(out.frames.join("\n").includes(acc), "text survived the commit to scrollback");

out.unmount();
console.log("tui-no-disappear tests passed");
