// tui/theme.mjs — single source for the palette + glyphs, so every component reads as
// one coherent themed interface (the thing that makes opencode/Crush feel elegant).
// Retheme the whole UI by editing here.
export const theme = {
  user: "magenta",
  assistant: "cyan",
  accent: "magenta",
  rail: "magenta",   // the user-bubble left rail ▎
  dim: "gray",
  ok: "green",
  warn: "yellow",
  err: "red",
};

export const glyphs = {
  userRail: "▎",
  assistant: "›",
  caret: "●",
  // compact tool glyphs (opencode-style single-line activity)
  tool: {
    bash: "$",
    web_search: "⌕",
    read_file: "→",
    edit_file: "±",
    write_file: "✚",
    browser_render: "◍",
    web_fetch: "↡",
    default: "•",
  },
};
