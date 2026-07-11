import { wrapText, gutterBlock, contentWidth, indent } from "./ui-layout.mjs";
import { renderTable, isTableRow } from "./ui-table.mjs";
import { highlightCode } from "./ui-highlight.mjs";
import { visibleLen } from "./ui.mjs";

const GUTTER = gutterBlock("")[0];

function prefixLines(lines, prefix, hangPrefix = prefix) {
  return indent(lines, prefix, hangPrefix).split("\n");
}

function renderInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\x00${codes.length - 1}\x00`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[22m"); // bold
  s = s.replace(/__([^_]+)__/g, "\x1b[1m$1\x1b[22m");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1\x1b[3m$2\x1b[23m"); // italic
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1\x1b[3m$2\x1b[23m");
  s = s.replace(/~~([^~]+)~~/g, "\x1b[9m$1\x1b[29m"); // strikethrough
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    "\x1b[4;36m$1\x1b[24;39m\x1b[2m($2)\x1b[22m"
  ); // link
  s = s.replace(
    /\x00(\d+)\x00/g,
    (_, i) => `\x1b[36m${codes[Number(i)]}\x1b[39m`
  ); // inline code
  return s;
}

// Render one logical markdown line -> array of physical lines, each already
// gutter-aligned and styled (opencode-style content column). Wrap is computed on
// PLAIN text against contentWidth() minus the line's rail/marker, then inline
// styling is applied per wrapped line (keeps wrapping ANSI-safe).
export function renderMdLine(line, state) {
  const cw = contentWidth();
  const fence = line.match(/^\s*```(.*)$/);
  if (fence) {
    if (state.inFence) {
      state.inFence = false;
      state.fenceLang = "";
      return [GUTTER + "\x1b[2m└──────\x1b[0m"];
    }
    state.inFence = true;
    state.fenceLang = (fence[1] || "").trim();
    return [GUTTER + "\x1b[2m┌─ " + (state.fenceLang || "code") + "\x1b[0m"];
  }
  // code body: gutter + syntax highlight, never wrapped (wrapping corrupts code)
  if (state.inFence)
    return [
      GUTTER + highlightCode(line, state.fenceLang || "", { color: true }),
    ];
  if (/^\s*([-*_])\1{2,}\s*$/.test(line))
    return [GUTTER + "\x1b[2m" + "─".repeat(cw) + "\x1b[0m"];
  if (line.trim() === "") return [""];
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    const open = h[1].length <= 2 ? "\x1b[1;38;5;75m" : "\x1b[1m";
    return prefixLines(
      wrapText(h[2], cw).map(t => open + renderInline(t) + "\x1b[0m"),
      GUTTER
    );
  }
  const bq = line.match(/^\s*>\s?(.*)$/);
  if (bq)
    return wrapText(bq[1], cw - 2).map(
      t => GUTTER + "\x1b[2m│ " + renderInline(t) + "\x1b[0m"
    );
  const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (ul) {
    const lead = ul[1];
    const markerW = lead.length + 2; // lead spaces + "• "
    const first = GUTTER + lead + "\x1b[36m•\x1b[39m ";
    const hang = GUTTER + " ".repeat(markerW);
    return wrapText(ul[2], cw - markerW)
      .map(renderInline)
      .map((t, i) => (i === 0 ? first : hang) + t);
  }
  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ol) {
    const lead = ol[1];
    const markerW = lead.length + ol[2].length + 2; // lead + "N. "
    const first = GUTTER + lead + "\x1b[36m" + ol[2] + ".\x1b[39m ";
    const hang = GUTTER + " ".repeat(markerW);
    return wrapText(ol[3], cw - markerW)
      .map(renderInline)
      .map((t, i) => (i === 0 ? first : hang) + t);
  }
  return prefixLines(wrapText(line, cw).map(renderInline), GUTTER);
}

export function renderMessage(text, opts = {}) {
  void visibleLen;
  if (!text) return [];

  const state = { inFence: false, fenceLang: "", table: [] };
  const out = [];
  const flushTable = () => {
    if (state.table.length > 0) {
      out.push(
        ...renderTable(state.table, { color: opts.color ?? true }).split("\n")
      );
      state.table = [];
    }
  };

  for (const line of String(text).split("\n")) {
    if (!state.inFence && isTableRow(line)) {
      state.table.push(line);
      continue;
    }
    flushTable();
    out.push(...renderMdLine(line, state));
  }
  flushTable();
  return out;
}
