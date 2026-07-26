// tui/components.mjs — the Ink view layer for `crew chat`. Message bodies are PRE-RENDERED
// ANSI strings (from the ui-* renderers via ui-markdown.renderMessage), one <Text> per
// physical line: Ink preserves the ANSI styling + CJK width and gives us the flicker-free
// compositor + Static scrollback + flexbox shell for free.
//
// An assistant turn is an ORDERED parts list (text/tool), rendered in sequence so tool
// calls appear exactly where they happened (OpenCode-style), never dumped after the prose.
import React from "react";
import { Box, Text } from "ink";
import htm from "htm";
import { theme, glyphs } from "./theme.mjs";
import { toolLine } from "../ui-tools.mjs";

const html = htm.bind(React.createElement);

// A block of pre-rendered ANSI lines, stacked. wrap="truncate" because our renderer
// already wrapped + gutter'd each line — Ink must NOT re-wrap (that would double-wrap).
export function MessageBody({ lines, caret }) {
  const body = lines && lines.length ? lines : [""];
  return html`<${Box} flexDirection="column">
    ${body.map((ln, i) => {
      const last = i === body.length - 1;
      return html`<${Text} key=${i} wrap="truncate">${ln || " "}${last && caret ? html`<${Text} dimColor>${" " + glyphs.caret}</>` : ""}</>`;
    })}
  </>`;
}

// One compact dim tool-activity line (OpenCode-style), reusing the raw renderer's toolLine
// so the summary + RESULT hint match exactly: "🌐 wttr.in (420 字)", "🔎 \"query\" (3 条)",
// "→ path (42 行)". The invocation carries toolName/args/output/status from the audit record.
export function ToolLine({ tool }) {
  const t = tool || {};
  const line = toolLine(
    {
      name: t.toolName,
      command: t.args?.command,
      args: t.args,
      output: t.output,
      confirmed: t.status === "blocked" ? false : undefined,
    },
    { color: true }
  );
  const rawOutput =
    typeof t.output === "string"
      ? t.output
      : t.output == null
        ? ""
        : JSON.stringify(t.output, null, 2);
  const outputRows = rawOutput
    .split(/\r?\n/)
    .map(row => row.trimEnd())
    .filter(Boolean);
  const body = outputRows.slice(0, 5);
  if (outputRows.length > body.length) {
    body.push(`… +${outputRows.length - body.length} lines`);
  }
  if (!body.length) {
    body.push(
      t.status === "running"
        ? "执行中"
        : t.status === "blocked"
          ? "等待确认"
          : "完成"
    );
  }
  const rail = [
    `   ● ${line}`,
    ...body.map(
      (row, index) => `   ${index === body.length - 1 ? "└" : "│"}  ${row}`
    ),
  ];
  return html`<${Text} wrap="truncate">${rail.join("\n")}</>`;
}

// The user's turn: an accent left-rail "bubble" (rail-only). Multi-line keeps the rail.
export function UserMessage({ text }) {
  const lines = String(text).split("\n");
  return html`<${Box} flexDirection="row" marginTop=${1}>
    <${Box} flexDirection="column"><${Text} color=${theme.rail}>${lines.map(() => glyphs.userRail).join("\n")}</></>
    <${Box} flexDirection="column" marginLeft=${1}>${lines.map((l, i) => html`<${Text} key=${i}>${l || " "}</>`)}</>
  </>`;
}

// The assistant's turn: role header + ordered parts (text bodies + interleaved tool lines).
// `renderLines(text) -> string[]` is injected (ui-markdown.renderMessage). The streaming
// caret rides the LAST text part.
export function AssistantMessage({ name, parts, renderLines, caret }) {
  const items = parts || [];
  const lastIdx = items.length - 1;
  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Text} color=${theme.assistant}>${name} ${glyphs.assistant}</>
    ${
      items.length
        ? items.map((p, i) =>
            p.type === "tool"
              ? html`<${ToolLine} key=${i} tool=${p.tool} />`
              : html`<${MessageBody}
                  key=${i}
                  lines=${renderLines(p.text)}
                  caret=${!!caret && i === lastIdx}
                />`
          )
        : caret
          ? html`<${MessageBody} lines=${[""]} caret=${true} />`
          : null
    }
  </>`;
}

// Sticky BOTTOM status bar: a live state dot + session token/ctx/cost on the right.
export function StatusBar({
  name,
  status = "idle",
  tokens = 0,
  ctxPct = 0,
  costText = "$0.00",
}) {
  const dotColor =
    {
      idle: theme.dim,
      thinking: theme.warn,
      streaming: theme.assistant,
      tool: theme.accent,
      error: theme.err,
    }[status] || theme.dim;
  const labelText =
    {
      idle: "就绪",
      thinking: "思考中",
      streaming: "回答中",
      tool: "调用工具",
      error: "中断",
    }[status] || status;
  return html`<${Box} justifyContent="space-between" paddingX=${1}>
    <${Box}><${Text} color=${dotColor}>${"● "}</><${Text} dimColor>${name + " · " + labelText}</></>
    <${Text} dimColor>${`${(tokens || 0).toLocaleString()} tok · ${ctxPct || 0}% · ${costText}`}</>
  </>`;
}

// Sticky status block (2 lines): identity · mode · state + cost on top, REAL tool health
// below. This is the "状态一眼看懂、不撒谎" line — search ✗ means the employee literally
// can't do real research right now. Symbols (✓/✗) back up color (don't rely on color alone).
// fine-grained Tool Truth (§9): per-capability status, weather INDEPENDENT of search (Case B)
const CAP_SHORT = {
  "utility.weather": "weather",
  "web.search": "search",
  "web.extract": "fetch",
  "browser.render": "render",
  "artifact.write": "artifact",
  "artifact.reveal": "reveal",
};
const CAP_SYM = {
  available: "✓",
  missing_key: "✗",
  unavailable: "✗",
  degraded: "!",
  rate_limited: "!",
  permission_required: "!",
  configured_unverified: "?",
  disabled: "–",
};
const HEADER_CAPS = [
  "web.search",
  "utility.weather",
  "web.extract",
  "browser.render",
  "artifact.write",
  "artifact.reveal",
];
const MEM_SYM = { available: "✓", unavailable: "✗", disabled: "–" };
const capColor = s =>
  s === "available"
    ? theme.ok
    : s === "missing_key" || s === "unavailable"
      ? theme.err
      : s === "disabled"
        ? theme.dim
        : theme.warn;

const fmtK = n => {
  const v = Number(n) || 0;
  return v >= 1000 ? Math.round(v / 100) / 10 + "k" : String(v);
};

export function StatusHeader({
  name,
  role,
  mode = "Chat",
  status = "idle",
  tokens = 0,
  costText = "$0.00",
  toolTruth = [],
  memory = null,
  budget = null,
}) {
  const dotColor =
    {
      idle: theme.dim,
      thinking: theme.warn,
      streaming: theme.assistant,
      tool: theme.accent,
      error: theme.err,
    }[status] || theme.dim;
  const stateLabel =
    {
      idle: "就绪",
      thinking: "思考中",
      streaming: "回答中",
      tool: "调用工具",
      error: "中断",
    }[status] || status;
  const ident = [name, role, `${mode} · ${stateLabel}`]
    .filter(Boolean)
    .join(" · ");
  const caps = HEADER_CAPS.map(c =>
    toolTruth.find(s => s.capability === c)
  ).filter(Boolean);
  // Context Budget (§10): show used/hard tokens, warn color at soft (50k), err at hard (90k).
  const budgetColor = !budget
    ? null
    : budget.status === "hard_exceeded"
      ? theme.err
      : budget.status === "soft_exceeded"
        ? theme.warn
        : null;
  const usageText = budget
    ? `${fmtK(budget.used)}/${fmtK(budget.hard)} tok · ${costText}`
    : `${(tokens || 0).toLocaleString()} tok · ${costText}`;
  return html`<${Box} flexDirection="column">
    <${Box} justifyContent="space-between" paddingX=${1}>
      <${Box}><${Text} color=${dotColor}>${"● "}</><${Text} dimColor>${ident}</></>
      ${budgetColor ? html`<${Text} color=${budgetColor}>${usageText}</>` : html`<${Text} dimColor>${usageText}</>`}
    </>
    <${Box} paddingX=${1}>
      <${Text} dimColor>${"工具 "}</>
      ${caps.map((s, i) => html`<${Text} key=${i} color=${capColor(s.status)}>${(i ? " · " : "") + (CAP_SHORT[s.capability] || s.capability) + " " + (CAP_SYM[s.status] || "!")}</>`)}
    </>
    ${
      memory
        ? html`<${Box} paddingX=${1}>
      <${Text} dimColor>${"记忆 "}</>
      <${Text} color=${capColor(memory.session)}>${"session " + (MEM_SYM[memory.session] || "?")}</>
      <${Text} dimColor>${" · "}</>
      <${Text} color=${capColor(memory.persistent)}>${"persistent " + (MEM_SYM[memory.persistent] || "?")}</>
    </>`
        : null
    }
  </>`;
}

// Optional top header (only used if we ever switch to the alternate-screen model).
export function Header({ name, tokens = 0, ctxPct = 0, costText = "$0.00" }) {
  return html`<${Box} justifyContent="space-between" paddingX=${1}>
    <${Text} color=${theme.accent} bold>${"🐳 " + name}</>
    <${Text} dimColor>${`${(tokens || 0).toLocaleString()} tok · ${ctxPct}% · ${costText}`}</>
  </>`;
}

// One work-timeline line: status symbol (✓/✗/→/!/?) + label + dim detail. The symbol backs
// up the color (don't rely on color alone). Renders AppState.timeline — high-level WORK
// events, not the raw model stream.
const LINE_COLOR = {
  "✓": theme.ok,
  "✗": theme.err,
  "→": theme.assistant,
  "!": theme.warn,
  "?": theme.accent,
};
export function TimelineLine({ line }) {
  const color = LINE_COLOR[line.status] || theme.dim;
  return html`<${Text} wrap="truncate"><${Text} color=${color}>${"   " + line.status + " "}</><${Text} dimColor>${line.label}${line.detail ? "  " + line.detail : ""}</></>`;
}

// TurnView renders ONE TaskRun's workbench view from AppState — the iron law on screen:
// role header + work timeline + the deliverable answer + evidence/artifact tallies. The
// renderer reads AppState slices; the only model text it sees is state.answer.
export function TurnView({ state, name, renderLines, caret }) {
  const lines = state.answer ? renderLines(state.answer) : [];
  const tally = [];
  if (state.evidence.length) tally.push(`🔖 ${state.evidence.length} 证据`);
  if (state.artifacts.length) tally.push(`📦 ${state.artifacts.length} 交付物`);
  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Text} color=${theme.assistant}>${name} ${glyphs.assistant}</>
    ${state.quickUtility ? html`<${Text} color=${theme.accent}>${"   ⚡ 快捷工具 · 不计入员工绩效" + (state.quickUtility.intent ? "：" + state.quickUtility.intent : "")}</>` : null}
    ${state.quickUtility && state.quickUtility.result ? html`<${Text} color=${theme.accent}>${`   🌤 ${state.quickUtility.result.city || ""}  ${state.quickUtility.result.condition || ""}  ${state.quickUtility.result.temp_c}°C（体感 ${state.quickUtility.result.feels_c}°C · 湿度 ${state.quickUtility.result.humidity}%）`}</>` : null}
    ${state.timeline.map((l, i) => html`<${TimelineLine} key=${i} line=${l} />`)}
    ${
      lines.length
        ? html`<${MessageBody} lines=${lines} caret=${!!caret} />`
        : caret && !state.timeline.length
          ? html`<${MessageBody} lines=${[""]} caret=${true} />`
          : null
    }
    ${tally.length ? html`<${Text} dimColor>${"   " + tally.join("   ")}</>` : null}
    ${
      state.pendingActions && state.pendingActions.length
        ? html`<${Text} color=${theme.accent}>${"   " + state.pendingActions.map(a => `[${a.key}] ${a.label}`).join("  ")}</>`
        : null
    }
  </>`;
}
