import assert from "node:assert/strict";

import {
  REVEAL_INTERVAL_MS,
  createRevealPacer,
  visibleGraphemes,
} from "../tui/reveal-pacer.mjs";

assert.equal(REVEAL_INTERVAL_MS, 30);
assert.deepEqual(visibleGraphemes("你A🦀e\u0301"), [
  "你",
  "A",
  "🦀",
  "e\u0301",
]);

const chunks = [];
const pacer = createRevealPacer({
  emit: chunk => chunks.push(chunk),
  intervalMs: 1,
});
pacer.push("一二三四五六七八九十甲乙");
assert.equal(pacer.pendingGraphemes, 12);
await pacer.drain();
assert.deepEqual(
  chunks.map(chunk => visibleGraphemes(chunk).length),
  [2, 3, 4, 2, 1]
);
assert.equal(chunks.join(""), "一二三四五六七八九十甲乙");
assert.equal(pacer.pendingGraphemes, 0);

const cancelled = [];
const pending = createRevealPacer({
  emit: chunk => cancelled.push(chunk),
  intervalMs: 20,
});
pending.push("不会出现");
pending.cancel();
await pending.drain();
assert.deepEqual(cancelled, []);
