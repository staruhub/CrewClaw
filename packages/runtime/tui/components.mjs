// tui/components.mjs — the Ink view layer for `crew chat`. Message bodies are PRE-RENDERED
// ANSI strings (from the existing ui-* renderers via ui-markdown.renderMessage), one
// <Text> per physical line: Ink preserves the ANSI styling + CJK width and gives us the
// flicker-free compositor + Static scrollback + flexbox shell for free. Components take
// already-rendered `lines` (string[]) so they stay pure and testable.
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

// One compact dim tool-activity line (opencode-style). `text` is the toolLine() summary;
// `status` tints only blocked/error states.
export function ToolLine({ text, status }) {
  const color = status === "blocked" ? theme.warn : status === "error" ? theme.err : undefined;
  return html`<${Text} dimColor=${!color} color=${color} wrap="truncate">${"   " + text}</>`;
}

// The user's turn: an accent left-rail "bubble" (rail-only; clean in append-only
// scrollback). Multi-line input keeps the rail on every line.
export function UserMessage({ text }) {
  const lines = String(text).split("\n");
  return html`<${Box} flexDirection="row" marginTop=${1}>
    <${Box} flexDirection="column"><${Text} color=${theme.rail}>${lines.map(() => glyphs.userRail).join("\n")}</></>
    <${Box} flexDirection="column" marginLeft=${1}>${lines.map((l, i) => html`<${Text} key=${i}>${l || " "}</>`)}</>
  </>`;
}

// The assistant's turn: role header + rendered body (+ streaming caret when live) +
// any tool-activity lines folded under it.
export function AssistantMessage({ name, lines, tools, caret }) {
  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Text} color=${theme.assistant}>${name} ${glyphs.assistant}</>
    <${MessageBody} lines=${lines} caret=${!!caret} />
    ${tools && tools.length
      ? tools.map((t, i) => html`<${ToolLine} key=${i} text=${t.action || t.text} status=${t.status} />`)
      : null}
  </>`;
}

// Sticky BOTTOM status bar (Ink's Static reserves the bottom region): a live state dot +
// session token/ctx/cost on the right. Sits right above the input composer.
export function StatusBar({ name, status = "idle", tokens = 0, ctxPct = 0, costText = "$0.00" }) {
  const dotColor = { idle: theme.dim, thinking: theme.warn, streaming: theme.assistant, tool: theme.accent, error: theme.err }[status] || theme.dim;
  const label = { idle: "就绪", thinking: "思考中", streaming: "回答中", tool: "调用工具", error: "中断" }[status] || status;
  return html`<${Box} justifyContent="space-between" paddingX=${1}>
    <${Box}><${Text} color=${dotColor}>${"● "}</><${Text} dimColor>${name + " · " + label}</></>
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
