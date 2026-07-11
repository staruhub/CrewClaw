import assert from "node:assert/strict";
import { renderMessage } from "../ui-markdown.mjs";

process.stdout.columns = 44;

const input = [
  "## heading",
  "这是一个很长的中文段落用于验证渲染器在窄终端宽度下会进行换行并且不会丢失任何逻辑内容。",
  "- item1",
  "- item2",
  "```js",
  "const answer = 42;",
  "```",
  "| A | B |",
  "|---|---|",
  "| x | y |",
  "| p | q |",
].join("\n");

const rows = renderMessage(input);
const nonEmptyRows = rows.filter(row => row.trim() !== "");

assert.ok(Array.isArray(rows), "renderMessage returns an array");
assert.ok(rows.length > 0, "renderMessage returns rendered rows");
assert.ok(
  rows.some(row => row.startsWith("   ")),
  "gutter is present"
);
assert.ok(
  rows.some(row => row.includes("heading")),
  "heading text is rendered"
);
assert.ok(
  rows.some(row => / {2,}/.test(row) || row.includes("│")),
  "table-like cell separator is rendered"
);
assert.ok(
  rows.some(row => row.includes("answer")),
  "code block content is rendered"
);
assert.ok(
  nonEmptyRows.length >= 10,
  "no logical line dropped below expected rendered minimum"
);
