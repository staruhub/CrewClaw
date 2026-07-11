// tui/tool-status.mjs — REAL, honest tool health for the status header + onboarding.
// "状态不能撒谎": a tool is only ✓ if it can actually do real work right now. Search is
// ✗ when only the DDG scrape fallback is available (no real provider key); render is ✓
// only when its provider is actually installed/reachable.
import { createRequire } from "node:module";
import { pickBackend } from "../tools-web.mjs";
import { pickRenderProvider } from "../render-provider.mjs";

const require = createRequire(import.meta.url);
function moduleInstalled(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

// Returns [{ tool, ok, label, reason, code }]. `code` is a structured error code (vision
// §8) when not ok, so the UI can offer a concrete next step.
export function getToolStatus(env = process.env) {
  const backend = pickBackend(env);
  const searchOk = backend.name !== "ddg"; // ddg = unreliable scrape fallback, not real search
  const provider = pickRenderProvider(env);
  const renderOk = provider === "playwright" && moduleInstalled("playwright");

  return [
    {
      tool: "web.search",
      ok: searchOk,
      label: searchOk ? backend.name : "missing key",
      reason: searchOk ? "" : "未配 search provider(只能降级 DDG 抓取,不可靠)",
      code: searchOk ? "" : "missing_key",
    },
    { tool: "web.fetch", ok: true, label: "ok", reason: "", code: "" },
    {
      tool: "browser.render",
      ok: renderOk,
      label: renderOk ? "playwright" : provider,
      reason: renderOk
        ? ""
        : provider === "playwright"
          ? "playwright 未安装"
          : provider + " 云端渲染未接",
      code: renderOk ? "" : "no_render_provider",
    },
    { tool: "evidence", ok: true, label: "ok", reason: "", code: "" },
  ];
}

// Compact one-line form for the status bar: "search ✗ · fetch ✓ · render ✓ · evidence ✓".
// Symbols + (implicitly) color so it doesn't rely on color alone (vision UI standard).
export function toolStatusLine(status = getToolStatus()) {
  const short = {
    "web.search": "search",
    "web.fetch": "fetch",
    "browser.render": "render",
    evidence: "evidence",
  };
  return status
    .map(s => `${short[s.tool] || s.tool} ${s.ok ? "✓" : "✗"}`)
    .join(" · ");
}
