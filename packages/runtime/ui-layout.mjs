// Layout / word-wrap engine for the streaming chat renderer.
//
// opencode-style "complete alignment": every emitted physical line sits in one
// content column (left GUTTER) and is word-wrapped to one content width derived
// from the terminal size. CJK-aware (wide chars = 2 cols) and ANSI-safe by
// construction — callers wrap PLAIN text here, then apply inline styling per
// returned line, so the wrapper never sees an escape sequence.
import { visibleLen } from "./ui.mjs";

export const GUTTER = "   "; // 3 spaces — the shared content gutter
export const CONTENT_MAX = 100; // readability cap
export const CONTENT_MIN = 40; // never wrap narrower than this
export const RIGHT_MARGIN = 1; // trailing breathing room

// Width available for content to the RIGHT of the gutter, clamped for sanity.
export function contentWidth() {
  const cols = process.stdout.columns || 80;
  const w = cols - visibleLen(GUTTER) - RIGHT_MARGIN;
  return Math.max(CONTENT_MIN, Math.min(CONTENT_MAX, w));
}

// Slice one whitespace-free token by display width (long URL, or a CJK run with
// no spaces). Iterates code points (keeps surrogate pairs / emoji intact).
function hardBreak(word, width) {
  const pieces = [];
  let cur = "";
  let curW = 0;
  for (const ch of word) {
    const cw = visibleLen(ch);
    if (curW > 0 && curW + cw > width) {
      pieces.push(cur);
      cur = ch;
      curW = cw;
    } else {
      cur += ch;
      curW += cw;
    }
  }
  if (cur.length > 0) pieces.push(cur);
  return pieces.length ? pieces : [""];
}

// Word-wrap PLAIN text to a display width. Returns string[] (>=1 line).
export function wrapText(text, width) {
  const w = Math.max(1, Math.floor(width) || 1);
  const words = String(text).split(/\s+/).filter((x) => x.length > 0);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  let lineW = 0;
  for (const word of words) {
    const wordW = visibleLen(word);
    if (wordW > w) {
      // token itself overflows: flush current line, hard-break by display width
      if (lineW > 0) {
        lines.push(line);
        line = "";
        lineW = 0;
      }
      const pieces = hardBreak(word, w);
      for (let i = 0; i < pieces.length - 1; i++) lines.push(pieces[i]);
      line = pieces[pieces.length - 1];
      lineW = visibleLen(line);
      continue;
    }
    if (lineW === 0) {
      line = word;
      lineW = wordW;
    } else if (lineW + 1 + wordW <= w) {
      line += " " + word;
      lineW += 1 + wordW;
    } else {
      lines.push(line);
      line = word;
      lineW = wordW;
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
}

// Prefix a block of lines: first line gets `prefix`, continuations get
// `hangPrefix` (defaults to `prefix`). Returns string[].
export function prefixLines(lines, prefix, hangPrefix = prefix) {
  return lines.map((l, i) => (i === 0 ? prefix : hangPrefix) + l);
}

// Same as prefixLines but joined into one \n-delimited string (hang-indent).
export function indent(lines, prefix, hangPrefix = prefix) {
  return prefixLines(lines, prefix, hangPrefix).join("\n");
}

// Common paragraph path: wrap to content width, prefix every line with GUTTER.
export function gutterBlock(text) {
  return prefixLines(wrapText(text, contentWidth()), GUTTER);
}

// Re-indent an already-rendered multi-line block (e.g. a tool/diff card whose
// frame starts at column 0) so it lines up with the content gutter.
export function reindent(block, prefix = GUTTER) {
  return String(block)
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}
