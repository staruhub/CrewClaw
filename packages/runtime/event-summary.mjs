export const TOOL_DETAIL_LIMIT = 4096;

export function truncateToolDetail(value, limit = TOOL_DETAIL_LIMIT) {
  let text;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value ?? "");
    }
  }

  const max = Math.max(0, Math.trunc(Number(limit) || 0));
  if (text.length <= max) {
    return { detail: text, truncated: false, originalChars: text.length };
  }

  const marker = `\n…（工具详情已截断；原始 ${text.length} 字符）`;
  const head = text.slice(0, Math.max(0, max - marker.length));
  return {
    detail: `${head}${marker}`.slice(0, max),
    truncated: true,
    originalChars: text.length,
  };
}

// Tool semantics live in ui-tools.mjs. Keep these exports so older consumers retain the same
// import path while every renderer and TaskEvent source shares one canonical presenter.
export { hostOf, summarizeAction, summarizeEvents } from "./ui-tools.mjs";
