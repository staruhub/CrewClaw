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
  return chars.length > max
    ? chars.slice(0, max - 1).join("") + "…"
    : chars.join("");
}

function parseOutputObject(output) {
  if (output && typeof output === "object") return output;
  const text = asString(output).trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function nonEmptyLineCount(output) {
  return asString(output)
    .split(/\r?\n/)
    .filter(line => line.trim()).length;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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

function invocationSummary({ name, command, args }) {
  const summary = toolArgsSummary({ name, command, args });
  return name === "bash" && summary ? `$ ${summary}` : summary;
}

function titleLine(name, color) {
  const title = `🔧 ${asString(name)}`;
  return `╭─ ${paint(color, ANSI.cyan, title)} ${"─".repeat(28)}`;
}

function outputLines(output, color) {
  const lines = asString(output).split(/\r?\n/);
  if (lines.length === 1 && lines[0] === "") return [];
  const visible = lines.slice(0, 8);
  const rendered = visible.map(
    line => `│ ${paint(color, ANSI.dim, truncateLine(line))}`
  );
  if (lines.length > visible.length) {
    rendered.push(
      `│ ${paint(color, ANSI.dim, `… (+${lines.length - visible.length} 行)`)}`
    );
  }
  return rendered;
}

export function toolCard(
  { name, command, args, output, elapsedMs, ok = true, confirmed } = {},
  { color = true } = {}
) {
  const summary = invocationSummary({ name, command, args });
  const status = statusText({ ok, confirmed });
  const lines = [titleLine(name, color)];

  if (summary) lines.push(`│ ${summary}`);
  lines.push(...outputLines(output, color));
  lines.push(`╰─ ${formatElapsed(elapsedMs)} · ${colorStatus(status, color)}`);

  return lines.join("\n");
}

export function toolCallHeader(
  { name, command, args } = {},
  { color = true } = {}
) {
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

export function hostOf(url) {
  if (typeof url !== "string") return asString(url);
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function toolArgsSummary({ name, tool, command, args = {} } = {}) {
  const toolName = asString(name || tool || "unknown") || "unknown";
  if (toolName === "bash")
    return truncateLine(asString(command ?? args?.command), 72);
  if (toolName === "search") {
    const q = asString(args?.query);
    const p = args?.path ? ` in ${asString(args.path)}` : "";
    return `"${q}"${p}`;
  }
  if (toolName === "web_fetch" || toolName === "browser_render")
    return truncateLine(asString(args?.url), 72);
  if (toolName === "web_search") return `"${asString(args?.query)}"`;
  if (
    toolName === "read_file" ||
    toolName === "edit_file" ||
    toolName === "write_file"
  )
    return asString(args?.path);
  if (toolName === "list_files") {
    const path = asString(args?.path || ".");
    return args?.pattern && args.pattern !== "*"
      ? `${path} · ${asString(args.pattern)}`
      : path;
  }
  if (toolName === "todo_write")
    return `${Array.isArray(args?.todos) ? args.todos.length : 0} 项`;
  if (toolName === "ask_user")
    return truncateLine(asString(args?.question || "需要用户选择"), 72);
  if (toolName === "use_skill") return asString(args?.id || "未知技能");
  if (toolName === "recall_memory")
    return truncateLine(asString(args?.id || args?.query || "员工记忆"), 72);
  if (toolName === "note_memory") return asString(args?.category || "未分类");
  if (toolName === "docx_write" || toolName === "artifact_write")
    return asString(args?.name || "未命名");
  if (toolName === "mcp_call")
    return [args?.server, args?.tool].filter(Boolean).join(".");
  if (command) return truncateLine(asString(command), 72);
  if (args && Object.keys(args).length)
    return truncateLine(JSON.stringify(args), 72);
  return "";
}

export function summarizeAction({
  name,
  tool,
  args = {},
  status,
  phase,
  decision,
} = {}) {
  const toolName = asString(name || tool || "未知工具") || "未知工具";
  if (decision === "deny") return `已拦截越权操作：${toolName}`;

  let line;
  if (toolName === "web_search") {
    line = `正在搜索来源：${asString(args.query)}`;
  } else if (toolName === "web_fetch") {
    line = `正在阅读 ${hostOf(args.url)}`;
  } else if (toolName === "use_skill") {
    line = `正在加载技能：${asString(args.id || "未知技能")}`;
  } else if (toolName === "recall_memory") {
    line = `正在回忆：${asString(args.id || args.query || "员工记忆")}`;
  } else if (toolName === "todo_write") {
    line = `正在更新任务清单（${Array.isArray(args.todos) ? args.todos.length : 0} 项）`;
  } else if (toolName === "ask_user") {
    line = `正在询问：${asString(args.question || "需要用户选择")}`;
  } else if (toolName === "note_memory") {
    line = `正在记录记忆候选：${asString(args.category || "未分类")}`;
  } else if (toolName === "docx_write") {
    line = `正在生成 Word 文档 ${asString(args.name || "未命名.docx")}`;
  } else if (toolName === "mcp_call") {
    line = `正在调用 MCP ${[args.server, args.tool].filter(Boolean).join(".")}`;
  } else if (toolName === "read_file") {
    line = `正在读取 ${asString(args.path || "文件")}`;
  } else if (toolName === "list_files") {
    line = `正在列出 ${asString(args.path || ".")}${
      args.pattern ? `（${asString(args.pattern)}）` : ""
    }`;
  } else if (toolName === "search") {
    line = `正在检索本地：${asString(args.query)}`;
  } else if (toolName === "bash") {
    line = "正在执行命令";
  } else if (toolName === "edit_file" || toolName === "write_file") {
    line = `正在写入 ${asString(args.path || "文件")}`;
  } else {
    line = `正在调用 ${toolName}`;
  }

  if ((phase || status) === "blocked") line += "（已跳过）";
  return line;
}

export function summarizeEvents(events = []) {
  return events.map(summarizeAction);
}

export function toolResultSummary({
  name,
  tool,
  args = {},
  output,
  confirmed,
  phase,
  decision,
} = {}) {
  const toolName = asString(name || tool || "unknown") || "unknown";
  if (phase === "cancelled") return "已取消";
  if (phase === "failed") return "失败";
  if (phase === "blocked") return decision === "deny" ? "已拦截" : "已跳过";
  if (phase && phase !== "succeeded") return "";
  if (confirmed === false) return "已跳过";
  const out = asString(output);
  const isErr = /^（/.test(out);
  if (isErr && /(失败|无法执行|超时|拒绝|取消|未授权|已阻止)/.test(out))
    return "失败";
  if (toolName === "edit_file" || toolName === "write_file") {
    if (out.startsWith("✓"))
      return toolName === "edit_file" ? "已编辑" : "已写入";
    return "未写入";
  }
  if (toolName === "web_fetch" || toolName === "browser_render")
    return out ? `${out.length} 字` : "空";
  if (toolName === "web_search") {
    if (/无搜索结果/.test(out)) return "无结果";
    const mm = out.match(/（(\d+) 条/);
    return mm ? `${mm[1]} 条` : "已搜";
  }
  if (toolName === "search") {
    const lines = out.split(/\r?\n/).filter(l => l.trim());
    const n = lines.filter(l => /:\d+:/.test(l)).length || lines.length;
    return n ? `${n} 处匹配` : "无匹配";
  }
  if (toolName === "read_file")
    return isErr ? "失败" : `${out ? out.split(/\r?\n/).length : 0} 行`;
  if (toolName === "list_files") {
    if (!out || /没有匹配的文件/.test(out)) return "0 项";
    const count = nonEmptyLineCount(out) - (/结果已截断/.test(out) ? 1 : 0);
    return `${Math.max(0, count)} 项${/结果已截断/.test(out) ? " · 已截断" : ""}`;
  }
  if (toolName === "bash") {
    if (!out || out === "（无输出）") return "无输出";
    return `${out.split(/\r?\n/).length} 行`;
  }
  if (toolName === "todo_write") {
    const parsed = parseOutputObject(output);
    const todos = Array.isArray(parsed?.todos) ? parsed.todos : args?.todos;
    const total = Array.isArray(todos) ? todos.length : 0;
    const done = Array.isArray(todos)
      ? todos.filter(todo => todo?.status === "completed").length
      : 0;
    return `${total} 项 · ${done}/${total} 完成`;
  }
  if (toolName === "ask_user") return "已回答";
  if (toolName === "use_skill") return "已加载";
  if (toolName === "recall_memory") return "已召回";
  if (toolName === "note_memory") return "候选已记录";
  if (toolName === "docx_write" || toolName === "artifact_write") {
    const parsed = parseOutputObject(output);
    const bytes = formatBytes(parsed?.bytes);
    return bytes ? `已生成 · ${bytes}` : "已生成";
  }
  if (toolName === "mcp_call") return "已完成";
  return phase === "succeeded" ? "已完成" : "";
}

export function toolEventPresentation({
  name,
  tool,
  command,
  args = {},
  output,
  confirmed,
  phase,
  decision,
} = {}) {
  const normalizedName = asString(name || tool || "unknown") || "unknown";
  const argsSummary = toolArgsSummary({
    name: normalizedName,
    command,
    args,
  });
  const resultSummary = toolResultSummary({
    name: normalizedName,
    args,
    output,
    confirmed,
    phase,
    decision,
  });
  return {
    name: normalizedName,
    args_summary: argsSummary,
    label: `${normalizedName}${argsSummary ? ` · ${argsSummary}` : ""}`,
    action: summarizeAction({
      tool: normalizedName,
      args,
      phase,
      decision,
    }),
    ...(resultSummary
      ? { result_summary: resultSummary, summary: resultSummary }
      : {}),
  };
}

// One dim line per tool call: "<glyph> <summary> (<result>)". Output stays folded
// (the model still receives full output); only a compact summary is shown.
export function toolLine(
  { name, command, args, output, confirmed, phase, decision } = {},
  { color = true } = {}
) {
  const glyph = TOOL_GLYPH[name] || "•";
  const summary = toolArgsSummary({ name, command, args });
  const head = paint(color, ANSI.dim, `${glyph} ${summary}`.trimEnd());
  const result = toolResultSummary({
    name,
    args,
    output,
    confirmed,
    phase,
    decision,
  });
  if (!result) return head;
  const tagCode = /失败/.test(result)
    ? ANSI.red
    : /已跳过|未写入|无匹配|无输出/.test(result)
      ? ANSI.yellow
      : ANSI.dim;
  return `${head} ${paint(color, ANSI.dim, "(")}${paint(color, tagCode, result)}${paint(color, ANSI.dim, ")")}`;
}
