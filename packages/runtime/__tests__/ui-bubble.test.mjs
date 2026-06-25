import assert from "node:assert/strict";

import { userBubble, userRailPrompt, visibleLen } from "../ui.mjs";
import { contentWidth } from "../ui-layout.mjs";

assert.equal(userBubble("hello", { color: false }), "▎ hello");

const longBubble = userBubble("word ".repeat(contentWidth()), { color: false });
const longLines = longBubble.split("\n");
assert.ok(longLines.length > 1, "long user bubble should wrap into multiple lines");
for (const line of longLines) {
  assert.ok(line.startsWith("▎ "), `line should start with rail prompt: ${line}`);
  assert.ok(
    visibleLen(line) <= contentWidth() + 2,
    `line exceeds content width: ${visibleLen(line)} > ${contentWidth() + 2}`,
  );
}

assert.equal(userBubble("x", { color: false }).includes("\x1b"), false);
assert.equal(userBubble("x", { color: true }).includes("\x1b"), true);
assert.equal(userRailPrompt({ color: false }), "▎ ");
