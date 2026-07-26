// Render a Markdown table (raw pipe lines) as an aligned, bordered ANSI table.
// CJK-aware via ui.mjs's visibleLen so Chinese columns line up.
import { visibleLen } from "./ui.mjs";
import { GUTTER, contentWidth } from "./ui-layout.mjs";

function parseCells(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

export function isTableRow(line) {
  const t = String(line).trim();
  return t.startsWith("|") && t.indexOf("|", 1) !== -1;
}

function isSeparatorCells(cells) {
  return (
    cells.length > 0 &&
    cells.every(c => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")))
  );
}

const INLINE_RESET = "\x1b[22;23;24;29;39m";

function truncToWidth(s, w) {
  if (visibleLen(s) <= w) return s;
  let out = "";
  let cur = 0;
  let index = 0;
  while (index < s.length) {
    const ansi = s.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    if (ansi) {
      out += ansi[0];
      index += ansi[0].length;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(index));
    const cw = visibleLen(ch);
    if (cur + cw > w - 1) {
      out += "…" + INLINE_RESET;
      break;
    }
    out += ch;
    cur += cw;
    index += ch.length;
  }
  return out;
}

export function renderTable(
  lines,
  { color = true, renderInline = value => value } = {}
) {
  const rowsRaw = lines.filter(isTableRow);
  if (!rowsRaw.length) return lines.join("\n");
  const cells = rowsRaw.map(parseCells);
  const sepIdx = cells.findIndex(isSeparatorCells);

  let header = null;
  let aligns = null;
  let body;
  if (sepIdx >= 0) {
    header = sepIdx > 0 ? cells[sepIdx - 1] : null;
    aligns = cells[sepIdx].map(c => {
      const s = c.replace(/\s/g, "");
      const l = s.startsWith(":");
      const r = s.endsWith(":");
      return l && r ? "center" : r ? "right" : "left";
    });
    body = cells.slice(sepIdx + 1);
  } else {
    header = cells[0];
    body = cells.slice(1);
  }

  const ncol = Math.max(
    header ? header.length : 0,
    ...body.map(r => r.length),
    1
  );
  if (!aligns) aligns = Array(ncol).fill("left");
  while (aligns.length < ncol) aligns.push("left");

  const norm = r => {
    const a = r.slice(0, ncol);
    while (a.length < ncol) a.push("");
    return a;
  };
  const h = header ? norm(header).map(renderInline) : null;
  const b = body.map(norm).map(row => row.map(renderInline));

  // n+1 bars plus two padding spaces per cell = 3n+1 columns of chrome.
  // Start natural, then shrink flexible columns; equal caps truncated CJK headers prematurely.
  const available = Math.max(ncol, contentWidth() - (3 * ncol + 1));
  const widths = [];
  const minimums = [];
  for (let i = 0; i < ncol; i++) {
    let w = h ? visibleLen(h[i]) : 0;
    for (const r of b) w = Math.max(w, visibleLen(r[i]));
    widths[i] = Math.max(1, w);
    minimums[i] = Math.max(1, h ? Math.min(w, visibleLen(h[i])) : 1);
  }
  const totalWidth = () => widths.reduce((sum, width) => sum + width, 0);
  while (totalWidth() > available) {
    let candidate = -1;
    let flexibility = 0;
    for (let i = 0; i < widths.length; i++) {
      const current = widths[i] - minimums[i];
      if (current > flexibility) {
        candidate = i;
        flexibility = current;
      }
    }
    if (candidate < 0) {
      candidate = widths.reduce(
        (best, width, index) =>
          width > 1 && (best < 0 || width > widths[best]) ? index : best,
        -1
      );
    }
    if (candidate < 0) break;
    widths[candidate]--;
  }

  // Reset intensity only. A full SGR reset (0m) also clears the terminal's
  // inherited background and can appear as dark cell-sized blocks.
  const dim = s => (color ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = s => (color ? `\x1b[1m${s}\x1b[22m` : s);
  const pad = (raw, i) => {
    const s = truncToWidth(raw, widths[i]);
    const space = Math.max(0, widths[i] - visibleLen(s));
    if (aligns[i] === "right") return " ".repeat(space) + s;
    if (aligns[i] === "center") {
      const left = Math.floor(space / 2);
      return " ".repeat(left) + s + " ".repeat(space - left);
    }
    return s + " ".repeat(space);
  };

  const bar = dim("│");
  const rowLine = (r, styler) =>
    GUTTER +
    bar +
    " " +
    r.map((c, i) => styler(pad(c, i))).join(" " + bar + " ") +
    " " +
    bar;
  const rule = (l, m, rr) =>
    GUTTER + dim(l + widths.map(w => "─".repeat(w + 2)).join(m) + rr);

  const out = [rule("┌", "┬", "┐")];
  if (h) {
    out.push(rowLine(h, bold));
    out.push(rule("├", "┼", "┤"));
  }
  for (const r of b) out.push(rowLine(r, s => s));
  out.push(rule("└", "┴", "┘"));
  return out.join("\n");
}
