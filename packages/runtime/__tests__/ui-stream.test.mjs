// Unit tests for the streaming printer — especially the bug where a long line
// vanished mid-stream (showPartial cleared it once it would wrap, leaving it blank
// until the \n). A dependency-injected `out` lets us capture every byte written.
import assert from "node:assert/strict";
import { createMdPrinter } from "../ui-stream.mjs";
import { visibleLen } from "../ui.mjs";
import { isTableRow as realIsTableRow } from "../ui-table.mjs";

function mockOut() {
  return {
    writes: [],
    columns: 80,
    isTTY: true,
    write(s) {
      this.writes.push(String(s));
      return true;
    },
    all() {
      return this.writes.join("");
    },
  };
}
const renderMdLine = line => ["   " + line]; // stub: gutter + line, one physical row
const deps = out => ({
  out,
  isTTY: true,
  renderMdLine,
  renderTable: rows => rows.join(" | "),
  isTableRow: () => false,
  visibleLen,
  GUTTER: "   ",
});

// 1) THE BUG: a long line that would wrap must show a truncated preview (head + …),
//    NOT vanish. Before the fix it was cleared and left blank until the \n arrived.
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  md.push("X".repeat(120)); // 120 cols on an 80-col terminal → would wrap
  const raw = out.all();
  assert.match(
    raw,
    /…/,
    "a long partial must show a truncated preview, not be blanked"
  );
  assert.match(raw, /●/, "the streaming caret should be drawn");
  assert.ok(
    raw.includes("X".repeat(40)),
    "the head of the long line must stay visible mid-stream"
  );
}

// 2) a short partial shows the full text + caret, no ellipsis
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  md.push("hello world");
  const raw = out.all();
  assert.ok(raw.includes("hello world"), "short partial shows full text");
  assert.doesNotMatch(raw, /…/, "a short line is not truncated");
}

// 3) a completed line is rendered + emitted with a newline; the partial cleared first
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  md.push("first line\nsecond");
  const raw = out.all();
  assert.ok(
    raw.includes("   first line\n"),
    "completed line emitted (rendered) with newline"
  );
  assert.ok(raw.includes("second"), "the trailing partial is shown");
}

// 4) end() flushes a final buffered line that had no trailing newline
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  md.push("no newline here");
  md.end();
  assert.ok(
    out.all().includes("   no newline here"),
    "end() emits the buffered final line"
  );
}

// 6) a completed line OVERWRITES the caret row in place — it is NOT blanked (\x1b[K)
//    right before the rendered line. That blank was the "disappears then reappears".
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  md.push("hel"); // draws the caret
  md.push("lo\n"); // completes the line
  const raw = out.all();
  assert.ok(raw.includes("hello"), "the completed line is rendered");
  assert.ok(
    raw.includes("\r   hello"),
    "the rendered line overwrites the caret row (starts with \\r)"
  );
  assert.ok(
    !raw.includes("\x1b[K   hello"),
    "the row is NOT cleared to blank right before the rendered line"
  );
}

// 5) non-render mode (piped) passes through raw bytes, no caret escapes
{
  const out = mockOut();
  const md = createMdPrinter(false, deps(out));
  md.push("raw text");
  assert.equal(out.all(), "raw text");
}

// 7) realistic multi-paragraph stream (short line + long line + final partial) fed in
//    small chunks like a real model. The disappear signature is clearPartial's exact
//    output "\r\x1b[K" (blank the row) — with the fix it is NEVER emitted during a
//    normal stream, because completed lines overwrite in place instead.
{
  const out = mockOut();
  const md = createMdPrinter(true, deps(out));
  for (const c of [
    "计",
    "划\n查最近的大模型",
    "发布动态，然后给你一个结构化的列表。",
    "\n先搜一下。",
  ])
    md.push(c);
  md.end();
  const raw = out.all();
  assert.ok(raw.includes("计划"), "the short line is rendered");
  assert.ok(raw.includes("先搜一下"), "the final line is rendered");
  assert.ok(
    !raw.includes("\r\x1b[K"),
    "no row is ever blanked mid-stream (the 不见→又出现 is gone)"
  );
}

// 8) a markdown table row that completes right after a caret was drawn (the partial
//    "| a" had a single pipe, so it wasn't yet a table row) must not strand that caret —
//    the aligned table would otherwise flush INTO the stale caret row (garbled output).
//    With the fix, the caret is cleared (\r\x1b[K) and the table renders on a clean row.
{
  const out = mockOut();
  const tdeps = {
    out,
    isTTY: true,
    renderMdLine,
    renderTable: rows => "TBL[" + rows.join(";") + "]",
    isTableRow: realIsTableRow,
    visibleLen,
    GUTTER: "   ",
  };
  const md = createMdPrinter(true, tdeps);
  md.push("| a"); // one pipe → not a table row yet → a caret is drawn
  md.push(" |\nnext\n"); // becomes a table row AND completes in one delta, then a normal line
  const raw = out.all();
  assert.ok(raw.includes("TBL[| a |]"), "the table is rendered");
  assert.ok(
    raw.includes("\r\x1b[KTBL["),
    "the stale caret is cleared before the table flushes (no garble)"
  );
  assert.ok(raw.includes("next"), "the line after the table is rendered");
}

console.log("ui-stream tests passed");
