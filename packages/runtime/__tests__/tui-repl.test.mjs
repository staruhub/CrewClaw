// Unit tests for the Ink↔runtime bridge (no Ink render, no TTY): buildRunTurn forwards a
// turn into agentLoop streaming to the sink + persists; historyToMessages maps model
// history to display messages. Uses a fake agentLoop honoring the Ink sink contract.
import assert from "node:assert/strict";
import {
  buildRunTurn,
  buildQuickUtilityTurn,
  historyToTurns,
} from "../tui/repl.mjs";

// 1) a turn: pushes user → runs loop streaming to sink → saves
{
  const fakeAgentLoop = async ({
    messages,
    renderMd,
    onDelta,
    onInvocation,
    onUsage,
  }) => {
    assert.equal(
      renderMd,
      false,
      "Ink mode must tell agentLoop not to draw to stdout"
    );
    onDelta("回答");
    onDelta("内容");
    onInvocation({ action: "web_search「x」", status: "success" });
    onUsage({ prompt_tokens: 10, completion_tokens: 5 });
    messages.push({ role: "assistant", content: "回答内容" });
  };
  const history = [];
  let saved = 0;
  const runTurn = buildRunTurn({
    agentLoop: fakeAgentLoop,
    agentLoopDeps: { model: "m" },
    history,
    saveSession: () => saved++,
  });

  const got = { deltas: "", tools: [], usage: null };
  await runTurn("问题", {
    onDelta: d => (got.deltas += d),
    onInvocation: i => got.tools.push(i),
    onUsage: u => (got.usage = u),
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
  const turns = historyToTurns(h);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[0].text, "hi");
  assert.equal(turns[1].role, "assistant");
  assert.equal(turns[1].app.answer, "答案");
}

// 3) buildQuickUtilityTurn (§10.2): a LIGHT turn — generic minimal system, just the one question,
//    NOT the employee's full system / chat history.
{
  let captured = null;
  const fakeAgentLoop = async opts => {
    captured = opts;
    opts.onDelta?.("28°C 晴");
  };
  const employeeSystem =
    "你是 AI 落地鲸,企业大模型落地顾问……(很长的员工人设/技能/记忆)";
  const runQuickUtility = buildQuickUtilityTurn({
    agentLoop: fakeAgentLoop,
    agentLoopDeps: { model: "m", system: employeeSystem },
  });
  await runQuickUtility("杭州天气？", {
    onDelta() {},
    onInvocation() {},
    onUsage() {},
  });

  assert.notEqual(
    captured.system,
    employeeSystem,
    "quick utility does NOT use the employee's full system prompt"
  );
  assert.ok(
    !/落地鲸|顾问/.test(captured.system),
    "the light system carries no employee identity"
  );
  assert.equal(
    captured.messages.length,
    1,
    "only the one question — no full chat history loaded (§10.2)"
  );
  assert.equal(captured.messages[0].content, "杭州天气？");
  assert.equal(captured.renderMd, false, "still Ink mode (no stdout draw)");
}

console.log("tui-repl tests passed");
