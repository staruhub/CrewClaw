import assert from "node:assert/strict";
import { createMdPrinter } from "../ui-stream.mjs";
import { visibleLen } from "../ui.mjs";
import { GUTTER, contentWidth, wrapText, prefixLines } from "../ui-layout.mjs";
import { highlightCode } from "../ui-highlight.mjs";
import { renderTable, isTableRow } from "../ui-table.mjs";
import { VTerm } from "./vterm.mjs";

function renderInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return ` ${codes.length - 1} `;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[22m");
  s = s.replace(/__([^_]+)__/, "\x1b[1m$1\x1b[22m");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1\x1b[3m$2\x1b[23m");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1\x1b[3m$2\x1b[23m");
  s = s.replace(/~~([^~]+)~~/g, "\x1b[9m$1\x1b[29m");
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    "\x1b[4;36m$1\x1b[24;39m\x1b[2m($2)\x1b[22m"
  );
  s = s.replace(/ (\d+) /g, (_, i) => `\x1b[36m${codes[Number(i)]}\x1b[39m`);
  return s;
}

function renderMdLine(line, state) {
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
    const markerW = lead.length + 2;
    const first = GUTTER + lead + "\x1b[36m•\x1b[39m ";
    const hang = GUTTER + " ".repeat(markerW);
    return wrapText(ul[2], cw - markerW)
      .map(renderInline)
      .map((t, i) => (i === 0 ? first : hang) + t);
  }
  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ol) {
    const lead = ol[1];
    const markerW = lead.length + ol[2].length + 2;
    const first = GUTTER + lead + "\x1b[36m" + ol[2] + ".\x1b[39m ";
    const hang = GUTTER + " ".repeat(markerW);
    return wrapText(ol[3], cw - markerW)
      .map(renderInline)
      .map((t, i) => (i === 0 ? first : hang) + t);
  }
  return prefixLines(wrapText(line, cw).map(renderInline), GUTTER);
}

function chunkString(s, sizes = [1, 2, 4, 3, 5]) {
  const chars = Array.from(s);
  const out = [];
  for (let i = 0, n = 0; i < chars.length; n++) {
    const take = sizes[n % sizes.length];
    out.push(chars.slice(i, i + take).join(""));
    i += take;
  }
  return out;
}

function blankReappearFrames(history) {
  const findings = [];
  const rowState = new Map();

  for (const frame of history) {
    frame.snapshot.forEach((line, row) => {
      const text = line.trim();
      const prev = rowState.get(row) || {
        phase: "start",
        before: null,
        blank: null,
      };

      if (text) {
        if (prev.phase === "blanked") {
          findings.push({
            row,
            before: prev.before,
            blank: prev.blank,
            after: frame,
            beforeText: prev.before.snapshot[row],
            afterText: line,
          });
        }
        rowState.set(row, { phase: "visible", before: frame, blank: null });
      } else if (prev.phase === "visible" && prev.before.snapshot[row].trim()) {
        rowState.set(row, {
          phase: "blanked",
          before: prev.before,
          blank: frame,
        });
      }
    });
  }

  return findings;
}

const script = [
  "这是一个很长的 CJK+ASCII paragraph for CrewClaw streaming diagnostics，",
  "它需要在八十列终端中换成三行以上，同时保留 mixed English words and 中文片段，",
  "继续追加内容直到真实 renderMdLine 产生多个 physical rows，避免 stub 单行测试漏掉问题。\n",
  "短行完成。\n",
  "| 名称 | 角色 | 状态 |\n",
  "| --- | --- | --- |\n",
  "| CrewClaw | Node runtime | streaming |\n",
  "\n",
  "```js\n",
  "const msg = 'streaming table should not blank';\n",
  "console.log(msg);\n",
  "```\n",
  "- 第一条列表包含一些中文和 ASCII words to wrap cleanly in the live renderer\n",
  "- 第二条列表保持较短\n",
].join("");

const term = new VTerm({ rows: 60, cols: 80 });
let current = { deltaIndex: -1, delta: "" };
const out = {
  isTTY: true,
  columns: 80,
  write(s) {
    return term.write(s, current);
  },
};
const md = createMdPrinter(true, {
  out,
  isTTY: true,
  renderMdLine,
  renderTable,
  isTableRow,
  visibleLen,
  GUTTER,
});
const deltas = chunkString(script);
for (let i = 0; i < deltas.length; i++) {
  current = { deltaIndex: i, delta: deltas[i] };
  md.push(deltas[i]);
}
current = { deltaIndex: deltas.length, delta: "<end>" };
md.end();

const disappear = blankReappearFrames(term.history);
if (disappear.length) {
  const first = disappear[0];
  const detail = [
    `disappear frame: before=${first.before.index}, blank=${first.blank.index}, after=${first.after.index}, row=${first.row}`,
    `blank trigger delta[${first.blank.deltaIndex}]=${JSON.stringify(first.blank.delta)}`,
    `before line=${JSON.stringify(first.beforeText)}`,
    `after line=${JSON.stringify(first.afterText)}`,
  ].join("\n");
  assert.fail(detail);
}

console.log(
  `e2e-vterm-stream passed: ${term.history.length} frames, zero disappear frames`
);
