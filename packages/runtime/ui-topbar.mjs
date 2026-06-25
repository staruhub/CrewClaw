import { visibleLen } from "./ui.mjs";

const ESC = "\x1b";
const CSI = `${ESC}[`;
const RESET = `${CSI}0m`;
const BOLD_ACCENT = `${CSI}1;35m`;
const ELLIPSIS = "...";

const DEFAULT_PRICING = Object.freeze({
  inPer1M: 15,
  outPer1M: 75,
  ctx: 200000,
});

export const PRICING = Object.freeze({
  "anthropic/claude-opus-4.8": DEFAULT_PRICING,
});

export function formatTokens(n) {
  return Math.trunc(Number(n) || 0).toLocaleString("en-US");
}

export function costFor(model, promptTokens, completionTokens) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const completion = Math.max(0, Number(completionTokens) || 0);
  return (prompt / 1e6 * pricing.inPer1M) + (completion / 1e6 * pricing.outPer1M);
}

export function ctxPercent(promptTokens, model) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const percent = Math.round((prompt / pricing.ctx) * 100);
  return Math.min(100, Math.max(0, percent));
}

export function topBar(state = {}, opts = {}) {
  const width = Math.max(0, Math.trunc(Number(opts.width ?? process.stdout.columns ?? 80) || 80));
  const color = opts.color !== false;
  const title = String(state.title ?? "");
  const tokens = Number(state.tokens) || 0;
  const pct = Math.round(Number(state.ctxPct) || 0);
  const cost = Number(state.cost) || 0;
  const right = `${formatTokens(tokens)}  ${pct}% ($${cost.toFixed(2)})`;
  const rightLen = visibleLen(right);

  if (rightLen >= width) return visibleSlice(right, width).padEnd(width, " ");

  const maxLeft = width - rightLen - 1;
  const leftText = truncateVisible(title, maxLeft);
  const left = color ? `${BOLD_ACCENT}${leftText}${RESET}` : leftText;
  const pad = Math.max(1, width - visibleLen(left) - rightLen);
  return `${left}${" ".repeat(pad)}${right}`;
}

export function installTopBar(getState, opts = {}) {
  const stream = opts.stream || process.stdout;
  if (!stream.isTTY) return { redraw() {}, dispose() {} };

  let rows = stream.rows || 24;

  const redraw = () => {
    stream.write(ESC + "7");
    stream.write(CSI + "1;1H");
    stream.write(CSI + "2K");
    stream.write(topBar(getState(), { width: stream.columns || 80 }));
    stream.write(ESC + "8");
  };

  const onResize = () => {
    rows = stream.rows || 24;
    redraw();
  };

  stream.write(CSI + "2;" + rows + "r");
  stream.write(CSI + "2;1H");
  if (typeof stream.on === "function") stream.on("resize", onResize);
  redraw();

  return {
    redraw,
    dispose() {
      stream.write(CSI + "r");
      stream.write(CSI + rows + ";1H");
      if (typeof stream.off === "function") stream.off("resize", onResize);
    },
  };
}

function truncateVisible(s, maxWidth) {
  if (maxWidth <= 0) return "";
  if (visibleLen(s) <= maxWidth) return s;
  if (maxWidth <= ELLIPSIS.length) return ELLIPSIS.slice(0, maxWidth);
  return visibleSlice(s, maxWidth - ELLIPSIS.length) + ELLIPSIS;
}

function visibleSlice(s, maxWidth) {
  let width = 0;
  let out = "";
  for (const ch of String(s)) {
    const len = visibleLen(ch);
    if (width + len > maxWidth) break;
    out += ch;
    width += len;
  }
  return out;
}
