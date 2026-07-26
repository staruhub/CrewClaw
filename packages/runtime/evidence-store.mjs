import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

function runsDir(root) {
  return join(root, ".crewclaw", "runs");
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function evidenceFile(root, taskRunId) {
  return resolveStatePath(
    join(runsDir(root), `${sanitizeId(taskRunId)}.evidence.json`),
    root
  );
}

function normalizedOfficialDomains(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => {
      const raw = String(value || "")
        .trim()
        .toLowerCase();
      if (!raw) return "";
      try {
        return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
          .replace(/^\*\./, "")
          .replace(/^\.+|\.+$/g, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function verifySourceType(url, { officialDomains = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return "unknown";

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

  // Officiality is a task-scoped trust assertion, so an explicitly declared official host wins
  // over generic shape heuristics such as `docs.` or `/documentation`. Search result pages remain
  // search sources even if somebody mistakenly allowlists the search engine itself.
  const isDeclaredOfficial = normalizedOfficialDomains(officialDomains).some(
    domain => host === domain || host.endsWith(`.${domain}`)
  );
  if (isDeclaredOfficial) return "official";

  if (
    host.includes("docs.") ||
    /^\/docs(?:\/|$)/.test(path) ||
    /^\/documentation(?:\/|$)/.test(path)
  ) {
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

  return "unknown";
}

export function newEvidenceCard({
  field,
  value,
  sourceUrl,
  sourceRef,
  sourceType,
  officialDomains,
  confidence,
  snippet,
} = {}) {
  return {
    field,
    value,
    source_url: sourceUrl,
    source_ref: sourceRef,
    source_type:
      sourceType ||
      (sourceUrl ? verifySourceType(sourceUrl, { officialDomains }) : "file"),
    confidence: confidence ?? "medium",
    snippet: snippet ?? "",
    ts: new Date().toISOString(),
  };
}

export function addEvidence(root, taskRunId, card) {
  try {
    const f = evidenceFile(root, taskRunId);
    return withStateLock(
      `${f}.lock`,
      () => {
        const cards = existsSync(f)
          ? JSON.parse(readStateFileGuarded(f, { root }).toString("utf8"))
          : [];
        if (!Array.isArray(cards)) {
          throw new Error("evidence state must be a JSON array");
        }
        const list = cards;
        const identity = card?.source_url || card?.source_ref;
        const duplicate = list.some(item => {
          const existing = item?.source_url || item?.source_ref;
          return item?.field === card?.field && existing === identity;
        });

        if (!duplicate) list.push(card);

        writeJsonAtomic(f, list, { root });
        return { ok: true, count: list.length };
      },
      { root }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadEvidence(root, taskRunId) {
  try {
    const f = evidenceFile(root, taskRunId);
    return withStateLock(
      `${f}.lock`,
      () => {
        if (!existsSync(f)) return { ok: true, cards: [] };
        const cards = JSON.parse(
          readStateFileGuarded(f, { root }).toString("utf8")
        );
        if (!Array.isArray(cards)) {
          throw new Error("evidence state must be a JSON array");
        }
        return { ok: true, cards };
      },
      { root }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function assembleSources(cards) {
  const out = [];
  const seen = new Set();

  for (const card of cards || []) {
    const source = card?.source_url || card?.source_ref;
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }

  return out;
}
