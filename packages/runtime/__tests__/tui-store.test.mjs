// Unit tests for the Ink chat store — the state machine that bridges the raw runtime
// (agentLoop callbacks) and the Ink UI. No TTY needed; this is pure state.
import assert from "node:assert/strict";
import { createChatStore } from "../tui/store.mjs";

// 1) a full turn: user prompt → begin → stream → tool → usage → commit
{
  const s = createChatStore();
  let snaps = 0;
  const off = s.subscribe(() => snaps++);

  s.pushUser("查一下最近的发布");
  assert.equal(s.get().messages.length, 1);
  assert.equal(s.get().messages[0].role, "user");
  assert.equal(s.get().messages[0].text, "查一下最近的发布");

  s.beginTurn();
  assert.equal(s.get().status, "thinking");
  assert.deepEqual(s.get().live, { text: "", tools: [] });

  s.appendDelta("我先"); s.appendDelta("搜一下");
  assert.equal(s.get().live.text, "我先搜一下");
  assert.equal(s.get().status, "streaming");

  s.addTool({ action: "web_search「最近发布」", status: "success" });
  assert.equal(s.get().live.tools.length, 1);
  assert.equal(s.get().status, "tool");

  s.addUsage({ prompt_tokens: 1200, completion_tokens: 300 });
  assert.equal(s.get().usage.promptTok, 1200);
  assert.equal(s.get().usage.completionTok, 300);
  assert.equal(s.get().usage.lastPromptTok, 1200);

  s.commitTurn();
  assert.equal(s.get().messages.length, 2);
  assert.equal(s.get().messages[1].role, "assistant");
  assert.equal(s.get().messages[1].text, "我先搜一下");
  assert.equal(s.get().messages[1].tools.length, 1);
  assert.equal(s.get().live, null);
  assert.equal(s.get().status, "idle");

  assert.ok(snaps >= 7, "subscribers were notified on every change");
  off();
}

// 2) a tool-only turn with no prose still commits (so the tool activity isn't lost)
{
  const s = createChatStore();
  s.beginTurn();
  s.addTool({ action: "bash「ls」", status: "success" });
  s.commitTurn();
  assert.equal(s.get().messages.length, 1);
  assert.equal(s.get().messages[0].tools.length, 1);
}

// 3) an empty turn (no prose, no tools) is dropped, not committed as a blank bubble
{
  const s = createChatStore();
  s.beginTurn();
  s.commitTurn();
  assert.equal(s.get().messages.length, 0);
  assert.equal(s.get().status, "idle");
}

// 4) an errored turn keeps the partial text in history (so the user can say 继续)
{
  const s = createChatStore();
  s.beginTurn();
  s.appendDelta("答案的前半段");
  s.setError("timeout");
  assert.equal(s.get().messages.length, 1);
  assert.equal(s.get().messages[0].text, "答案的前半段");
  assert.equal(s.get().messages[0].errored, true);
  assert.equal(s.get().live, null);
  assert.equal(s.get().status, "error");
}

console.log("tui-store tests passed");
