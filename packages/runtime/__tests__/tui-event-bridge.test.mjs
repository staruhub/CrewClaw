// The event-bridge translates agentLoop's sink callbacks into TaskEvents → AppState. Proves
// a turn's callbacks fold into the right workbench state (no TTY, no model).
import assert from "node:assert/strict";
import { createTaskRun } from "../tui/event-bridge.mjs";

let changes = 0;
const run = createTaskRun(
  { employee: { name: "鲸" }, mode: "Chat" },
  () => changes++
);

run.start("查杭州天气", "Chat");
run.sink.onDelta("计划：");
run.sink.onDelta("查数据源。");
run.sink.onInvocation({
  toolName: "web_fetch",
  action: "读取 wttr.in",
  line: "🌐 wttr.in (412 字)",
  status: "success",
});
run.sink.onUsage({ prompt_tokens: 800, completion_tokens: 120 });
run.complete();

const s = run.get();
assert.equal(s.task.title, "查杭州天气");
assert.equal(s.task.status, "done");
assert.equal(s.answer, "计划：查数据源。");
assert.equal(s.usage.promptTok, 800);
const toolLine = s.timeline.find(l => l.label.includes("wttr.in"));
assert.ok(
  toolLine && toolLine.status === "✓",
  "tool invocation became a ✓ timeline line carrying the result summary"
);
assert.equal(s.status, "idle", "chat completion settles to idle");
assert.equal(
  s.timeline.some(l => l.label.includes("完成")),
  false,
  "chat replies do not add a noisy formal-task completion line"
);
assert.ok(changes >= 6, "onChange fired per event");

// a blocked tool → ✗ with the structured code
const r2 = createTaskRun();
r2.start("x");
r2.sink.onInvocation({
  toolName: "web_search",
  action: "已跳过",
  status: "blocked",
  code: "blocked_serp",
});
const t = r2.get().timeline.find(l => l.id === "tool1");
assert.equal(t.status, "✗", "blocked tool → ✗");

console.log("tui-event-bridge tests passed");
