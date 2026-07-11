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

function truncToWidth(s, w) {
  if (visibleLen(s) <= w) return s;
  let out = "";
  let cur = 0;
  for (const ch of s) {
    const cw = visibleLen(ch);
    if (cur + cw > w - 1) {
      out += "…";
      break;
    }
    out += ch;
    cur += cw;
  }
  return out;
}

export function renderTable(lines, { color = true } = {}) {
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
  const h = header ? norm(header) : null;
  const b = body.map(norm);

  // distribute the content column across columns (│-chrome is 3 cols per boundary)
  const budget = contentWidth() - 2;
  const MAXW = Math.max(8, Math.floor((budget - (ncol + 1) * 3) / ncol));
  const widths = [];
  for (let i = 0; i < ncol; i++) {
    let w = h ? visibleLen(h[i]) : 0;
    for (const r of b) w = Math.max(w, visibleLen(r[i]));
    widths[i] = Math.max(1, Math.min(w, MAXW));
  }

  const dim = s => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = s => (color ? `\x1b[1m${s}\x1b[0m` : s);
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
