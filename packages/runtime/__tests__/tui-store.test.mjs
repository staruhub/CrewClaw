// Unit tests for the Ink chat store — the state machine bridging the raw runtime and the
// Ink UI. No TTY needed. A turn is an ORDERED parts list (text/tool) so tool calls stay
// interleaved in execution order, never dumped after the prose.
import assert from "node:assert/strict";
import { createChatStore } from "../tui/store.mjs";

// 1) a turn with interleaved parts: text → tool → text (the OpenCode ordering fix)
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
  assert.deepEqual(s.get().live, { parts: [] });

  s.appendDelta("我先"); s.appendDelta("搜一下");
  assert.deepEqual(s.get().live.parts, [{ type: "text", text: "我先搜一下" }]);
  assert.equal(s.get().status, "streaming");

  s.addTool({ toolName: "web_search", action: "web_search「最近发布」", status: "success" });
  s.appendDelta("找到三条……");
  // text → tool → text must stay ordered (the tool is NOT pushed after the prose)
  const parts = s.get().live.parts;
  assert.equal(parts.length, 3, "three ordered parts");
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].type, "tool");
  assert.equal(parts[2].type, "text");
  assert.equal(parts[2].text, "找到三条……");

  s.addUsage({ prompt_tokens: 1200, completion_tokens: 300 });
  assert.equal(s.get().usage.promptTok, 1200);

  s.commitTurn();
  assert.equal(s.get().messages.length, 2);
  assert.equal(s.get().messages[1].role, "assistant");
  assert.equal(s.get().messages[1].parts.length, 3, "ordered parts preserved on commit");
  assert.equal(s.get().live, null);
  assert.equal(s.get().status, "idle");
  assert.ok(snaps >= 7, "subscribers notified on every change");
  off();
}

// 2) a tool-only turn still commits (the tool part isn't lost)
{
  const s = createChatStore();
  s.beginTurn();
  s.addTool({ toolName: "bash", action: "bash「ls」", status: "success" });
  s.commitTurn();
  assert.equal(s.get().messages.length, 1);
  assert.equal(s.get().messages[0].parts.length, 1);
  assert.equal(s.get().messages[0].parts[0].type, "tool");
}

// 3) an empty turn (no parts) is dropped, not committed as a blank bubble
{
  const s = createChatStore();
  s.beginTurn();
  s.commitTurn();
  assert.equal(s.get().messages.length, 0);
  assert.equal(s.get().status, "idle");
}

// 4) an errored turn keeps the partial parts (so 继续 can resume)
{
  const s = createChatStore();
  s.beginTurn();
  s.appendDelta("答案的前半段");
  s.setError();
  assert.equal(s.get().messages.length, 1);
  assert.equal(s.get().messages[0].parts[0].text, "答案的前半段");
  assert.equal(s.get().messages[0].errored, true);
  assert.equal(s.get().live, null);
  assert.equal(s.get().status, "error");
}

console.log("tui-store tests passed");
