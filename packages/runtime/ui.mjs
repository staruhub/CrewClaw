import { contentWidth, wrapText } from "./ui-layout.mjs";

export const theme = {
  reset: "\x1b[0m",
  accent: "\x1b[35m",
  info: "\x1b[36m",
  dim: "\x1b[2m",
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  err: "\x1b[31m",
};

const paint = (code, s, color = true) =>
  color ? `${code}${s}${theme.reset}` : String(s);

export const c = {
  accent: (s, color = true) => paint(theme.accent, s, color),
  info: (s, color = true) => paint(theme.info, s, color),
  dim: (s, color = true) => paint(theme.dim, s, color),
  ok: (s, color = true) => paint(theme.ok, s, color),
  warn: (s, color = true) => paint(theme.warn, s, color),
  err: (s, color = true) => paint(theme.err, s, color),
  muted: (s, color = true) => paint(theme.dim, s, color),
};

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export function visibleLen(s) {
  let width = 0;
  for (const ch of String(s).replace(ANSI_RE, "")) {
    const cp = ch.codePointAt(0);
    if (cp === 0) continue;
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

function isWide(cp) {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f000 && cp <= 0x1faff))
  );
}

export function agentBadge(
  { name, title, model, skillCount },
  { color = true } = {}
) {
  const displayName = name || "CrewClaw";
  const displayTitle = title || "Hermes Expert";
  const displayModel = model || "unknown-model";
  const skills = Number.isFinite(Number(skillCount)) ? Number(skillCount) : 0;
  return [
    `   ┌─ ${c.accent(displayName, color)}`,
    `   │  ${displayTitle}`,
    `   │  ${c.dim(`model ${displayModel} · ${skills} skills`, color)}`,
    `   └─ ${c.dim("Enter 发送 · /exit 退出 · /reset 清空", color)}`,
  ].join("\n");
}

export function statusBar({ model, step } = {}, { color = true } = {}) {
  const pieces = [
    `model ${model || "unknown-model"}`,
    `step ${step ?? 0}`,
    "🔧 bash/search 就绪",
    "/exit",
  ];
  return c.dim(pieces.join(" · "), color);
}

export function turnSeparator({ color = true } = {}) {
  return c.dim("  " + "─".repeat(48), color);
}

export function userLabel({ color = true } = {}) {
  return c.info("you › ", color);
}

export function userBubble(text, { color = true } = {}) {
  const rail = color ? c.accent("▎") : "▎";
  return wrapText(text, contentWidth())
    .map(line => `${rail} ${line}`)
    .join("\n");
}

export function userRailPrompt({ color = true } = {}) {
  return color ? c.accent("▎ ") : "▎ ";
}

export function agentLabel(name, { color = true } = {}) {
  return c.accent(`${name || "agent"} › `, color);
}
