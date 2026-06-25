// tui/chat-demo2.mjs — exercises the FULL turn lifecycle of the real chat app (store +
// components + REPL) with a fake runTurn + a programmatic submit (no keyboard, so it runs
// non-TTY). Proves: user bubble commits to scrollback → live message streams with caret →
// tool line folds in → turn commits → status bar reflects state.
//   FORCE_COLOR=1 node tui/chat-demo2.mjs
import { mountChat } from "./chat.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (text) => String(text).split("\n").map((l) => "   " + l); // until ui-markdown lands

const fakeRunTurn = async (text, cb) => {
  const reply = "收到，正在处理：" + text + "。\n\n这是分两段的回答，第二段在这里继续，用来验证多行流式。";
  for (const ch of reply) { cb.onDelta(ch); await sleep(6); }
  cb.onInvocation({ action: "⌕ web_search「" + text + "」(2 处)", status: "success" });
  cb.onUsage({ prompt_tokens: 800, completion_tokens: 120 });
};

const { submit, unmount, waitUntilExit } = mountChat({
  runTurn: fakeRunTurn,
  agentName: "鲸",
  renderLines: stub,
});

setTimeout(() => submit("查一下最近发布"), 120);
setTimeout(() => unmount(), 2800);
await waitUntilExit();
console.log("[chat-demo2] full turn lifecycle rendered & exited cleanly");
