// Renders the real ChatApp via ink-testing-library and drives a full turn through the
// store, asserting the frames. No TTY needed. lastFrame() = current dynamic frame;
// frames.join() = everything ever rendered (committed turns go to <Static> once).
import assert from "node:assert/strict";
import React from "react";
import htm from "htm";
import { render } from "ink-testing-library";
import { ChatApp } from "../tui/chat.mjs";
import { createChatStore } from "../tui/store.mjs";

const html = htm.bind(React.createElement);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (text) => String(text).split("\n").map((l) => "   " + l); // until ui-markdown lands
const noTurn = async () => {};

const store = createChatStore();
const out = render(html`<${ChatApp} store=${store} runTurn=${noTurn} agentName="鲸" renderLines=${stub} />`);
const all = () => out.frames.join("\n");

// 1) idle shell: status bar + composer
await sleep(20);
assert.match(out.lastFrame(), /就绪/, "status bar shows the idle label");

// 2) a streaming turn: user bubble + live assistant + streaming status
store.pushUser("查一下最近发布");
store.beginTurn();
store.appendDelta("我先搜一下");
await sleep(60); // > the 33ms throttle window
assert.match(all(), /查一下最近发布/, "user message rendered (to scrollback)");
assert.match(out.lastFrame(), /我先搜一下/, "live assistant text in the dynamic frame");
assert.match(out.lastFrame(), /回答中/, "status reflects streaming");

// 3) tool + usage + commit → tool line shown, tokens summed, status back to idle
store.addTool({ toolName: "web_search", args: { query: "最近发布" }, output: "（3 条结果）", status: "success" });
store.addUsage({ prompt_tokens: 500, completion_tokens: 100 });
await sleep(60);
assert.match(all(), /最近发布/, "tool activity line rendered (query summary)");
store.commitTurn();
await sleep(60);
assert.match(out.lastFrame(), /600 tok/, "token count summed in the status bar");
assert.match(out.lastFrame(), /就绪/, "status back to idle after commit");
assert.match(all(), /我先搜一下/, "the committed turn's text persisted (to <Static> scrollback)");
assert.equal(store.get().live, null, "live turn cleared after commit");

out.unmount();
console.log("tui-chat tests passed");
