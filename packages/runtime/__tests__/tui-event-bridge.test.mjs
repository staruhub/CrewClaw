// The event-bridge translates agentLoop's sink callbacks into TaskEvents → AppState. Proves
// a turn's callbacks fold into the right workbench state (no TTY, no model).
import assert from "node:assert/strict";
import { createTaskRun } from "../tui/event-bridge.mjs";
import { EVENTS } from "../tui/protocol.mjs";

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
assert.equal(s.generation.status, "completed");
assert.equal(s.taskStreamTerminal, true);
assert.equal(
  s.timeline.some(l => l.label.includes("完成")),
  false,
  "chat replies do not add a noisy formal-task completion line"
);
assert.ok(changes >= 6, "onChange fired per event");

// a blocked tool → ✗ with the structured code
const r2 = createTaskRun();
r2.start("x", "Chat");
r2.sink.onInvocation({
  toolName: "web_search",
  action: "已跳过",
  status: "blocked",
  code: "blocked_serp",
});
const t = r2.get().timeline.find(l => l.id === "tool1");
assert.equal(
  t.status,
  "!",
  "blocked tool → warning, distinct from execution failure"
);

// Native lifecycle events are monotonic, thinking is separate, and terminal generations reject
// every late callback. onInvocation remains only a fallback for older injected runtimes.
const r3 = createTaskRun({}, () => {});
r3.start("lifecycle", "Chat");
r3.sink.onThinking("先分析");
r3.sink.onToolEvent({
  id: "call-1",
  toolName: "web_search",
  phase: "requested",
});
r3.sink.onToolEvent({ id: "call-1", toolName: "web_search", phase: "running" });
r3.sink.onToolEvent({
  id: "call-1",
  toolName: "web_search",
  phase: "succeeded",
});
r3.sink.onToolEvent({ id: "call-1", toolName: "web_search", phase: "failed" });
r3.complete();
const closed = r3.get();
const debugBeforeLate = closed.debug.length;
r3.sink.onDelta("late");
r3.sink.onThinking("late-thinking");
r3.sink.onToolEvent({ id: "late", toolName: "bash", phase: "requested" });
assert.equal(r3.get().thinking, "先分析");
assert.equal(r3.get().tools["call-1"].status, "succeeded");
assert.equal(r3.get().answer, "");
assert.equal(r3.get().tools.late, undefined);
assert.equal(r3.get().debug.length, debugBeforeLate);

// Cancellation aborts the engine signal, denies a pending approval, closes a running tool, and
// emits generation/task terminals before any delayed callback can mutate the snapshot.
const r4 = createTaskRun();
r4.start("cancel", "Chat");
let approvalDecision = null;
const approval = r4.sink.confirm("allow?").then(value => {
  approvalDecision = value;
});
r4.sink.onToolEvent({
  id: "call-cancel",
  toolName: "test_run",
  phase: "requested",
});
r4.sink.onToolEvent({
  id: "call-cancel",
  toolName: "test_run",
  phase: "running",
});
assert.equal(r4.cancel("stop now"), true);
await approval;
assert.equal(approvalDecision, false);
assert.equal(r4.signal.aborted, true);
assert.equal(r4.get().generation.status, "cancelled");
assert.equal(r4.get().task.status, "blocked");
assert.equal(r4.get().tools["call-cancel"].status, "cancelled");
assert.equal(r4.get().approval, null);

// A produced artifact closes generation but remains reviewable; it must not be auto-completed or
// have its deliverable approval cleared by commit.
const r5 = createTaskRun();
r5.start("review", "Task");
r5.emit(EVENTS.ARTIFACT_CREATED, {
  id: "artifact-review",
  path: "/x/review.md",
});
r5.emit(EVENTS.OUTCOME_CHECKED, {
  valid: true,
  deliverable: "/x/review.md",
});
r5.settle({
  awaitingAcceptance: true,
  artifact: { artifact_id: "artifact-review" },
});
assert.equal(r5.get().generation.status, "completed");
assert.equal(r5.get().approval.kind, "deliverable_acceptance");
assert.equal(r5.get().status, "awaiting_approval");
assert.equal(r5.get().taskStreamTerminal, false);

console.log("tui-event-bridge tests passed");
