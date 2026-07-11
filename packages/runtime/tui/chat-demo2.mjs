// tui/chat-demo2.mjs — exercises the FULL turn lifecycle of the real chat app (store +
// components + REPL) with a fake runTurn + a programmatic submit (no keyboard, so it runs
// non-TTY). Proves: user bubble commits to scrollback → live message streams with caret →
// tool line folds in → turn commits → status bar reflects state.
//   FORCE_COLOR=1 node tui/chat-demo2.mjs
import { mountChat } from "./chat.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stub = text =>
  String(text)
    .split("\n")
    .map(l => "   " + l); // until ui-markdown lands

// interleaved: plan text → two tool reads → answer text (tools land WHERE they happened)
const fakeRunTurn = async (text, cb) => {
  for (const ch of "计划：先查一下数据源，再给你结构化结果。") {
    cb.onDelta(ch);
    await sleep(6);
  }
  cb.onInvocation({
    toolName: "web_fetch",
    args: { url: "https://wttr.in/Hangzhou" },
    output: "x".repeat(412),
    status: "success",
  });
  cb.onInvocation({
    toolName: "web_fetch",
    args: { url: "https://wttr.in/Hangzhou?m" },
    output: "y".repeat(388),
    status: "success",
  });
  for (const ch of "\n\n根据数据源，杭州明天多云转晴，最高 30°C、最低 21°C。") {
    cb.onDelta(ch);
    await sleep(6);
  }
  cb.onUsage({ prompt_tokens: 800, completion_tokens: 120 });
};

const { submit, unmount, waitUntilExit } = mountChat({
  runTurn: fakeRunTurn,
  agentName: "鲸",
  renderLines: stub,
  meta: { role: "落地顾问", mode: "Chat", model: "anthropic/claude-opus-4.8" },
});

setTimeout(() => submit("查一下最近发布"), 120);
setTimeout(() => unmount(), 2800);
await waitUntilExit();
console.log("[chat-demo2] full turn lifecycle rendered & exited cleanly");
