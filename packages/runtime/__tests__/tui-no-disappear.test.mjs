// The no-disappear property in the TaskRun model: state.answer is a pure APPEND in the
// reducer, so it only ever grows as tokens stream — no renderer can blank it mid-stream.
// Assert monotonic growth across the token stream (the structural guarantee Ink then draws).
import assert from "node:assert/strict";
import { createTaskRun } from "../tui/event-bridge.mjs";

const answers = [];
const run = createTaskRun({}, (s) => answers.push(s.answer));
run.start("写一段长的");
for (const tok of ["这", "是", "一", "段", "会", "逐", "字", "流", "出", "的", "中", "文", "回", "答"]) run.sink.onDelta(tok);

// every snapshot's answer must extend (or equal) the previous — never shrink or blank
for (let i = 1; i < answers.length; i++) {
  assert.ok(answers[i].startsWith(answers[i - 1]), `answer must grow monotonically, never blank: "${answers[i - 1]}" → "${answers[i]}"`);
}
assert.equal(answers[answers.length - 1], "这是一段会逐字流出的中文回答", "the full streamed text is preserved");

console.log("tui-no-disappear tests passed");
