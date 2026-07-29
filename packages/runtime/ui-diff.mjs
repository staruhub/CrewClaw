const RESET = "\x1b[0m";
const ANSI = {
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

function paint(enabled, code, text) {
  return enabled ? `${code}${text}${RESET}` : text;
}

function asString(value) {
  return value == null ? "" : String(value);
}

function toLines(text) {
  const value = asString(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function truncateLine(line, max = 200) {
  const chars = Array.from(asString(line));
  return chars.length > max
    ? chars.slice(0, max - 1).join("") + "…"
    : chars.join("");
}

function lineNo(value, width) {
  return value == null
    ? "·".padStart(width, " ")
    : String(value).padStart(width, " ");
}

function titleLine(path, title, color) {
  const label = `✎ ${asString(title || path || "diff")}`;
  return `╭─ ${paint(color, ANSI.cyan, label)} ${"─".repeat(28)}`;
}

function summarize(diff) {
  let adds = 0;
  let dels = 0;
  for (const part of diff) {
    if (part.type === "add") adds++;
    else if (part.type === "del") dels++;
  }
  return { adds, dels };
}

function foldContext(diff, context) {
  const keep = Math.max(0, Math.floor(Number(context) || 0));
  const folded = [];
  for (let i = 0; i < diff.length;) {
    if (diff[i].type !== "ctx") {
      folded.push(diff[i++]);
      continue;
    }

    const start = i;
    while (i < diff.length && diff[i].type === "ctx") i++;
    const run = diff.slice(start, i);
    if (run.length > keep * 2) {
      folded.push(...run.slice(0, keep));
      folded.push({ type: "fold", count: run.length - keep * 2 });
      folded.push(...run.slice(run.length - keep));
    } else {
      folded.push(...run);
    }
  }
  return folded;
}

function renderDiffLine(part, width, color) {
  const oldNo = lineNo(part.oldNo, width);
  const newNo = lineNo(part.newNo, width);
  const prefix = part.type === "add" ? "+ " : part.type === "del" ? "- " : "  ";
  const raw = `${oldNo} ${newNo}  ${prefix}${truncateLine(part.text)}`;
  const code =
    part.type === "add"
      ? ANSI.green
      : part.type === "del"
        ? ANSI.red
        : ANSI.dim;
  return `│ ${paint(color, code, raw)}`;
}

export function computeDiff(oldText, newText) {
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const lcs = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] === newLines[j]
    ) {
      diff.push({ type: "ctx", text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (
      j >= newLines.length ||
      (i < oldLines.length && lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      diff.push({ type: "del", text: oldLines[i], oldNo: i + 1, newNo: null });
      i++;
    } else {
      diff.push({ type: "add", text: newLines[j], oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  return diff;
}

export function diffCard(
  { path, oldText, newText, title } = {},
  { color = true, context = 3 } = {}
) {
  const diff = computeDiff(oldText, newText);
  const visible = foldContext(diff, context);
  const maxNo = Math.max(
    1,
    ...diff.flatMap(part => [part.oldNo || 0, part.newNo || 0])
  );
  const width = Math.max(3, String(maxNo).length);
  const { adds, dels } = summarize(diff);
  const lines = [titleLine(path, title, color)];

  for (const part of visible) {
    if (part.type === "fold") {
      lines.push(`│  ${paint(color, ANSI.dim, `⋯ ${part.count} 行未变化`)}`);
    } else {
      lines.push(renderDiffLine(part, width, color));
    }
  }

  const summary = `${paint(color, ANSI.green, `+${adds}`)} ${paint(color, ANSI.red, `-${dels}`)}`;
  lines.push(`╰─ ${summary}`);
  return lines.join("\n");
}
