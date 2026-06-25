// Probe: does Ink preserve PRE-RENDERED ANSI (from our ui-* renderers) inside <Text>,
// or does it strip/mangle it? Decides the whole markdown strategy:
//   passthrough OK  → reuse every ui-* renderer, Ink is just the flicker-free shell
//   passthrough bad → map markdown AST → Ink components (bigger rewrite)
// Run with FORCE_COLOR=1 so colors survive even though this isn't a TTY.
import React from "react";
import { render, Box, Text } from "ink";
import htm from "htm";

const html = htm.bind(React.createElement);
const ansi = "\x1b[1;31m重要\x1b[0m 普通 \x1b[36mcyan蓝\x1b[0m 尾";       // bold-red + cyan + CJK
const gutter = "\x1b[2m   ─────────\x1b[0m";                              // dim HR-ish line

function Probe() {
  return html`
    <${Box} flexDirection="column">
      <${Text} wrap="truncate">${ansi}</>
      <${Text} wrap="truncate">${gutter}</>
    </>
  `;
}
const app = render(html`<${Probe} />`);
setTimeout(() => app.unmount(), 120);
await app.waitUntilExit();
