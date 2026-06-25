// Unit tests for the Ink↔runtime bridge (no Ink render, no TTY): buildRunTurn forwards a
// turn into agentLoop streaming to the sink + persists; historyToMessages maps model
// history to display messages. Uses a fake agentLoop honoring the Ink sink contract.
import assert from "node:assert/strict";
import { buildRunTurn, historyToMessages } from "../tui/repl.mjs";

// 1) a turn: pushes user → runs loop streaming to sink → saves
{
  const fakeAgentLoop = async ({ messages, renderMd, onDelta, onInvocation, onUsage }) => {
    assert.equal(renderMd, false, "Ink mode must tell agentLoop not to draw to stdout");
    onDelta("回答"); onDelta("内容");
    onInvocation({ action: "web_search「x」", status: "success" });
    onUsage({ prompt_tokens: 10, completion_tokens: 5 });
    messages.push({ role: "assistant", content: "回答内容" });
  };
  const history = [];
  let saved = 0;
  const runTurn = buildRunTurn({ agentLoop: fakeAgentLoop, agentLoopDeps: { model: "m" }, history, saveSession: () => saved++ });

  const got = { deltas: "", tools: [], usage: null };
  await runTurn("问题", {
    onDelta: (d) => (got.deltas += d),
    onInvocation: (i) => got.tools.push(i),
    onUsage: (u) => (got.usage = u),
  });

  assert.equal(history.length, 2, "user + assistant in model history");
  assert.equal(history[0].content, "问题");
  assert.equal(history[1].role, "assistant");
  assert.equal(got.deltas, "回答内容", "deltas streamed to the sink");
  assert.equal(got.tools.length, 1, "invocation forwarded");
  assert.equal(got.usage.prompt_tokens, 10, "usage forwarded");
  assert.equal(saved, 1, "session saved after the turn");
}

// 2) historyToMessages keeps user + final assistant prose, drops tool_calls/tool turns
{
  const h = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", tool_calls: [{}] },
    { role: "tool", content: "result" },
    { role: "assistant", content: "答案" },
  ];
  const msgs = historyToMessages(h);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "hi");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].parts[0].text, "答案");
}

console.log("tui-repl tests passed");
