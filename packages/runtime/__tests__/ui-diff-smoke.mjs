import assert from "node:assert/strict";
import { computeDiff, diffCard } from "../ui-diff.mjs";

const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, "");

const pureAdd = computeDiff("", "one\ntwo");
assert.deepEqual(pureAdd, [
  { type: "add", text: "one", oldNo: null, newNo: 1 },
  { type: "add", text: "two", oldNo: null, newNo: 2 },
]);

const pureDel = computeDiff("one\ntwo", "");
assert.deepEqual(pureDel, [
  { type: "del", text: "one", oldNo: 1, newNo: null },
  { type: "del", text: "two", oldNo: 2, newNo: null },
]);

const changed = computeDiff("alpha\nbeta\ngamma", "alpha\nbravo\ngamma\ndelta");
assert.deepEqual(
  changed.map(part => part.type),
  ["ctx", "del", "add", "ctx", "add"]
);
assert.deepEqual(
  changed.map(part => [part.oldNo, part.newNo]),
  [
    [1, 1],
    [2, null],
    [null, 2],
    [3, 3],
    [null, 4],
  ]
);

const card = diffCard(
  {
    path: "src/example.txt",
    oldText: "alpha\nbeta\ngamma",
    newText: "alpha\nbravo\ngamma\ndelta",
  },
  { color: true }
);
console.log(card);
assert.match(card, /╭─/);
assert.match(card, /✎ src\/example\.txt/);
assert.match(stripAnsi(card), /  2\s+·\s+- beta/);
assert.match(stripAnsi(card), /  ·\s+2\s+\+ bravo/);
assert.match(stripAnsi(card), /╰─ \+2 -1/);
assert.match(card, /\x1b\[31m/);
assert.match(card, /\x1b\[32m/);
assert.match(card, /\x1b\[2m/);

const longOld = Array.from({ length: 24 }, (_, i) => `same ${i + 1}`);
const longNew = [...longOld];
longNew.splice(12, 0, "inserted");
const foldedCard = diffCard(
  {
    path: "long.txt",
    oldText: longOld.join("\n"),
    newText: longNew.join("\n"),
  },
  { color: false, context: 2 }
);
console.log(foldedCard);
assert.doesNotMatch(foldedCard, /\x1b\[/);
assert.match(foldedCard, /⋯ \d+ 行未变化/);
assert.match(foldedCard, /  ·\s+13\s+\+ inserted/);
assert.match(foldedCard, /╰─ \+1 -0/);

const longLine = "x".repeat(230);
const truncated = diffCard(
  { title: "custom title", oldText: "", newText: longLine },
  { color: false }
);
console.log(truncated);
assert.match(truncated, /✎ custom title/);
assert.match(truncated, /x…/);
assert.ok(truncated.length < longLine.length + 120);
