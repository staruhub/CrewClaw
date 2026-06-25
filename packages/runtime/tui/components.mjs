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

// One compact dim tool-activity line (OpenCode-style): <glyph> <cleaned label>. The label
// is the audit summary with the present-continuous "正在" stripped (it's a finished call).
export function ToolLine({ tool }) {
  const t = tool || {};
  const glyph = glyphs.tool[t.toolName] || glyphs.tool.default;
  const label = String(t.action || t.toolName || "tool").replace(/^正在/, "");
  const color = t.status === "blocked" ? theme.warn : t.status === "error" ? theme.err : undefined;
  return html`<${Text} dimColor=${!color} color=${color} wrap="truncate">${"   " + glyph + " " + label}</>`;
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
    ${items.length
      ? items.map((p, i) =>
          p.type === "tool"
            ? html`<${ToolLine} key=${i} tool=${p.tool} />`
            : html`<${MessageBody} key=${i} lines=${renderLines(p.text)} caret=${!!caret && i === lastIdx} />`)
      : (caret ? html`<${MessageBody} lines=${[""]} caret=${true} />` : null)}
  </>`;
}

// Sticky BOTTOM status bar: a live state dot + session token/ctx/cost on the right.
export function StatusBar({ name, status = "idle", tokens = 0, ctxPct = 0, costText = "$0.00" }) {
  const dotColor = { idle: theme.dim, thinking: theme.warn, streaming: theme.assistant, tool: theme.accent, error: theme.err }[status] || theme.dim;
  const labelText = { idle: "就绪", thinking: "思考中", streaming: "回答中", tool: "调用工具", error: "中断" }[status] || status;
  return html`<${Box} justifyContent="space-between" paddingX=${1}>
    <${Box}><${Text} color=${dotColor}>${"● "}</><${Text} dimColor>${name + " · " + labelText}</></>
    <${Text} dimColor>${`${(tokens || 0).toLocaleString()} tok · ${ctxPct || 0}% · ${costText}`}</>
  </>`;
}

// Optional top header (only used if we ever switch to the alternate-screen model).
export function Header({ name, tokens = 0, ctxPct = 0, costText = "$0.00" }) {
  return html`<${Box} justifyContent="space-between" paddingX=${1}>
    <${Text} color=${theme.accent} bold>${"🐳 " + name}</>
    <${Text} dimColor>${`${(tokens || 0).toLocaleString()} tok · ${ctxPct}% · ${costText}`}</>
  </>`;
}
