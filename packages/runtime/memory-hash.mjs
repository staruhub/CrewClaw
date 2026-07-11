// crewclaw.memory-state-hash/v1 — the anchor every "did the employee actually improve" claim
// hangs on. The hash must be STABLE: independent of object key order, item order on disk, and
// volatile bookkeeping fields; sensitive ONLY to fields that change recall behavior.
//
// Canonicalization rules (versioned — changing ANY rule bumps the schema version):
//   1. Only items whose status is "active" participate (a missing status counts as active:
//      that is exactly what the legacy backfill stamps).
//   2. Per item, only the semantic fields participate, in this fixed order:
//      category, confidence, supersedes, text, valid_until.
//      Volatile fields (savedAt, read counters, source bookkeeping) are excluded.
//   3. Text normalization is fixed forever for v1: Unicode NFC → trim → collapse every
//      internal whitespace run to a single ASCII space.
//   4. Items are sorted by (category, normalized text) using plain code-unit comparison —
//      no locale-dependent collation.
//   5. The digest input is the schema id + one JSON line per canonical item.
//
// estimated_injection_tokens is a deterministic ESTIMATE (documented algorithm below), never a
// provider-billed number. Real usage always comes from the provider's usage object.
import { createHash } from "node:crypto";

export const MEMORY_STATE_HASH_SCHEMA = "crewclaw.memory-state-hash/v1";

export function normalizeMemoryText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

function isActive(item) {
  return (
    item &&
    typeof item === "object" &&
    (item.status === undefined || item.status === "active")
  );
}

function canonicalItem(item) {
  return {
    category: String(item.category ?? ""),
    confidence: item.confidence === undefined ? null : String(item.confidence),
    supersedes:
      item.supersedes === undefined || item.supersedes === null
        ? null
        : String(item.supersedes),
    text: normalizeMemoryText(item.text),
    valid_until:
      item.valid_until === undefined || item.valid_until === null
        ? null
        : String(item.valid_until),
  };
}

// Deterministic token estimate: CJK/full-width code points count as 1 token each; everything
// else counts 1 token per 4 characters (ceil per item). Fixed for v1 — do not "improve" this
// without bumping the schema version, or historical reports stop being comparable.
const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿]/u;

export function estimateInjectionTokens(text) {
  const normalized = normalizeMemoryText(text);
  let wide = 0;
  let narrow = 0;
  for (const ch of normalized) {
    if (WIDE_RE.test(ch)) wide += 1;
    else narrow += 1;
  }
  return wide + Math.ceil(narrow / 4);
}

export function computeMemoryStateHash(items) {
  const active = (Array.isArray(items) ? items : [])
    .filter(isActive)
    .map(canonicalItem);
  active.sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.text !== b.text) return a.text < b.text ? -1 : 1;
    return 0;
  });

  const hash = createHash("sha256");
  hash.update(`${MEMORY_STATE_HASH_SCHEMA}\n`);
  for (const item of active) {
    // canonicalItem builds the object with a fixed key order, so stringify is deterministic.
    hash.update(`${JSON.stringify(item)}\n`);
  }

  const estimatedTokens = active.reduce(
    (sum, item) =>
      sum +
      estimateInjectionTokens(item.text) +
      estimateInjectionTokens(item.category),
    0
  );

  return {
    memory_state_hash: `sha256:${hash.digest("hex")}`,
    memory_hash_schema: MEMORY_STATE_HASH_SCHEMA,
    active_item_count: active.length,
    estimated_injection_tokens: estimatedTokens,
  };
}
