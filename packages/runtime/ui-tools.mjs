const RESET = "\x1b[0m";
const ANSI = {
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function paint(enabled, code, text) {
  return enabled ? `${code}${text}${RESET}` : text;
}

function asString(value) {
  return value == null ? "" : String(value);
}

function truncateLine(line, max = 200) {
  const chars = Array.from(asString(line));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

function formatElapsed(elapsedMs) {
  const ms = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusText({ ok = true, confirmed }) {
  if (confirmed === false) return "已跳过";
  return ok ? "ok" : "failed";
}

function colorStatus(status, color) {
  if (status === "ok") return paint(color, ANSI.green, status);
  if (status === "failed") return paint(color, ANSI.red, status);
  return paint(color, ANSI.yellow, status);
}

function searchSummary(args = {}) {
  const query = asString(args.query);
  const path = asString(args.path || ".");
  return `"${query}" in ${path}`;
}

function invocationSummary({ name, command, args }) {
  if (name === "bash") return `$ ${asString(command ?? args?.command)}`.trimEnd();
  if (name === "search") return searchSummary(args);
  if (command) return asString(command);
  if (args && Object.keys(args).length) return JSON.stringify(args);
  return "";
}

function titleLine(name, color) {
  const title = `🔧 ${asString(name)}`;
  return `╭─ ${paint(color, ANSI.cyan, title)} ${"─".repeat(28)}`;
}

function outputLines(output, color) {
  const lines = asString(output).split(/\r?\n/);
  if (lines.length === 1 && lines[0] === "") return [];
  const visible = lines.slice(0, 8);
  const rendered = visible.map((line) => `│ ${paint(color, ANSI.dim, truncateLine(line))}`);
  if (lines.length > visible.length) {
    rendered.push(`│ ${paint(color, ANSI.dim, `… (+${lines.length - visible.length} 行)`)}`);
  }
  return rendered;
}

export function toolCard(
  { name, command, args, output, elapsedMs, ok = true, confirmed } = {},
  { color = true } = {},
) {
  const summary = invocationSummary({ name, command, args });
  const status = statusText({ ok, confirmed });
  const lines = [titleLine(name, color)];

  if (summary) lines.push(`│ ${summary}`);
  lines.push(...outputLines(output, color));
  lines.push(`╰─ ${formatElapsed(elapsedMs)} · ${colorStatus(status, color)}`);

  return lines.join("\n");
}

export function toolCallHeader({ name, command, args } = {}, { color = true } = {}) {
  const summary = invocationSummary({ name, command, args });
  const title = paint(color, ANSI.cyan, `🔧 ${asString(name)}`);
  return `╭─ ${title}${summary ? ` ${paint(color, ANSI.dim, summary)}` : ""}`;
}

// --- Compact one-line tool activity (opencode-style: dim, output folded) ---

const TOOL_GLYPH = {
  bash: "$",
  search: "⌕",
  read_file: "→",
  edit_file: "±",
  write_file: "✚",
  web_fetch: "🌐",
  web_search: "🔎",
};

function lineSummary({ name, command, args }) {
  if (name === "bash") return truncateLine(asString(command ?? args?.command), 72);
  if (name === "search") {
    const q = asString(args?.query);
    const p = args?.path ? ` in ${asString(args.path)}` : "";
    return `"${q}"${p}`;
  }
  if (name === "web_fetch") return asString(args?.url);
  if (name === "web_search") return `"${asString(args?.query)}"`;
  if (name === "read_file" || name === "edit_file" || name === "write_file") return asString(args?.path);
  if (command) return truncateLine(asString(command), 72);
  if (args && Object.keys(args).length) return truncateLine(JSON.stringify(args), 72);
  return "";
}

function resultSummary({ name, output, confirmed }) {
  if (confirmed === false) return "已跳过";
  const out = asString(output);
  const isErr = /^（/.test(out);
  if (name === "edit_file" || name === "write_file") {
    if (out.startsWith("✓")) return name === "edit_file" ? "已编辑" : "已写入";
    return "未写入";
  }
  if (isErr && /(失败|无法执行|超时|拒绝|取消)/.test(out)) return "失败";
  if (name === "web_fetch") return out ? `${out.length} 字` : "空";
  if (name === "web_search") {
    if (/无搜索结果/.test(out)) return "无结果";
    const mm = out.match(/（(\d+) 条/);
    return mm ? `${mm[1]} 条` : "已搜";
  }
  if (name === "search") {
    const lines = out.split(/\r?\n/).filter((l) => l.trim());
    const n = lines.filter((l) => /:\d+:/.test(l)).length || lines.length;
    return n ? `${n} 处匹配` : "无匹配";
  }
  if (name === "read_file") return isErr ? "失败" : `${out ? out.split(/\r?\n/).length : 0} 行`;
  if (name === "bash") {
    if (!out || out === "（无输出）") return "无输出";
    return `${out.split(/\r?\n/).length} 行`;
  }
  return "";
}

// One dim line per tool call: "<glyph> <summary> (<result>)". Output stays folded
// (the model still receives full output); only a compact summary is shown.
export function toolLine({ name, command, args, output, confirmed } = {}, { color = true } = {}) {
  const glyph = TOOL_GLYPH[name] || "•";
  const summary = lineSummary({ name, command, args });
  const head = paint(color, ANSI.dim, `${glyph} ${summary}`.trimEnd());
  const result = resultSummary({ name, output, confirmed });
  if (!result) return head;
  const tagCode = /失败/.test(result)
    ? ANSI.red
    : /已跳过|未写入|无匹配|无输出/.test(result)
      ? ANSI.yellow
      : ANSI.dim;
  return `${head} ${paint(color, ANSI.dim, "(")}${paint(color, tagCode, result)}${paint(color, ANSI.dim, ")")}`;
}
