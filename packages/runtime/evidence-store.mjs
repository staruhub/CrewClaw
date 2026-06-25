import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function runsDir(root) {
  return join(root, ".crewclaw", "runs");
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function evidenceFile(root, taskRunId) {
  return join(runsDir(root), `${sanitizeId(taskRunId)}.evidence.json`);
}

export function verifySourceType(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unknown";

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (
    /(^|\.)duckduckgo\.com$/.test(host) ||
    /(^|\.)bing\.com$/.test(host) ||
    /(^|\.)google\./.test(host) ||
    /(^|\.)baidu\.com$/.test(host) ||
    /(^|\.)sogou\.com$/.test(host)
  ) {
    return "search";
  }

  if (host.includes("docs.") || /^\/docs(?:\/|$)/.test(path) || /^\/documentation(?:\/|$)/.test(path)) {
    return "docs";
  }

  if (
    /(^|\.)github\.com$/.test(host) ||
    /(^|\.)zhihu\.com$/.test(host) ||
    /(^|\.)reddit\.com$/.test(host) ||
    /(^|\.)stackoverflow\.com$/.test(host) ||
    host.includes("juejin") ||
    host.includes("csdn")
  ) {
    return "community";
  }

  if (
    /^news\./.test(host) ||
    host.includes("36kr") ||
    host.includes("sohu") ||
    host.includes("sina") ||
    (/(^|\.)qq\.com$/.test(host) && /^\/news(?:\/|$)/.test(path)) ||
    /(^|\.)techcrunch\.com$/.test(host) ||
    /(^|\.)theverge\.com$/.test(host)
  ) {
    return "news";
  }

  return "official";
}

export function newEvidenceCard({ field, value, sourceUrl, confidence, snippet } = {}) {
  return {
    field,
    value,
    source_url: sourceUrl,
    source_type: verifySourceType(sourceUrl),
    confidence: confidence ?? "medium",
    snippet: snippet ?? "",
    ts: new Date().toISOString(),
  };
}

export function addEvidence(root, taskRunId, card) {
  try {
    mkdirSync(runsDir(root), { recursive: true });
    const f = evidenceFile(root, taskRunId);
    const cards = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
    const list = Array.isArray(cards) ? cards : [];
    const duplicate = list.some((item) => item?.field === card?.field && item?.source_url === card?.source_url);

    if (!duplicate) list.push(card);

    writeFileSync(f, JSON.stringify(list, null, 2), "utf8");
    return { ok: true, count: list.length };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadEvidence(root, taskRunId) {
  try {
    const f = evidenceFile(root, taskRunId);
    if (!existsSync(f)) return { ok: true, cards: [] };
    const cards = JSON.parse(readFileSync(f, "utf8"));
    return { ok: true, cards: Array.isArray(cards) ? cards : [] };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function assembleSources(cards) {
  const out = [];
  const seen = new Set();

  for (const card of cards || []) {
    const sourceUrl = card?.source_url;
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    out.push(sourceUrl);
  }

  return out;
}
