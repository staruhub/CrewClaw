// A good agentic search tool, provider-agnostic.
//
// Philosophy: search FINDS sources (title/url/snippet); web_fetch READS one for
// depth; the agent synthesizes and cites URLs. The backend is pluggable and
// chosen from whatever credentials exist in the environment, with a best-effort
// no-key fallback. Results are normalized, deduped, cleaned, and formatted for
// a model to read — never fabricated; on failure we say so and suggest a key.

import { requestPublicText } from "./safe-http.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Strip tags + collapse whitespace + decode entities → clean inline text.
export function clean(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s, n) {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function httpRequest(
  url,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 12000,
    maxBytes,
    resolveTarget,
    signal,
  } = {}
) {
  const controller = new AbortController();
  const cancelFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancelFromCaller();
  else signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await requestPublicText(url, {
      method,
      headers: { "User-Agent": UA, ...headers },
      body,
      signal: controller.signal,
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(resolveTarget === undefined ? {} : { resolveTarget }),
    });
    return {
      ok: res.ok === true && res.status >= 200 && res.status < 300,
      status: res.status || 0,
      text: res.body || "",
      code: res.code,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelFromCaller);
  }
}

// --- backends: each returns Promise<[{title,url,snippet,age?}]>, never throws fatally ---

function braveFreshness(recency) {
  return { day: "pd", week: "pw", month: "pm", year: "py" }[recency] || "";
}

async function braveSearch(q, opts = {}) {
  const key = process.env.BRAVE_API_KEY;
  const params = new URLSearchParams({ q, count: String(opts.count || 5) });
  const fresh = braveFreshness(opts.recency);
  if (fresh) params.set("freshness", fresh);
  const { ok, text } = await httpRequest(
    "https://api.search.brave.com/res/v1/web/search?" + params,
    {
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      resolveTarget: opts.resolveTarget,
      maxBytes: opts.maxBytes,
      signal: opts.signal,
    }
  );
  if (!ok) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return (data?.web?.results || []).map(r => ({
    title: clean(r.title),
    url: r.url,
    snippet: clean(r.description || ""),
    age: r.age || r.page_age || "",
  }));
}

async function serperSearch(q, opts = {}) {
  const key = process.env.SERPER_API_KEY;
  const { ok, text } = await httpRequest("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: opts.count || 5 }),
    resolveTarget: opts.resolveTarget,
    maxBytes: opts.maxBytes,
    signal: opts.signal,
  });
  if (!ok) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return (data?.organic || []).map(r => ({
    title: clean(r.title),
    url: r.link,
    snippet: clean(r.snippet || ""),
    age: r.date || "",
  }));
}

function ddgRealUrl(href) {
  const m = String(href).match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* ignore */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

// No-key best-effort (DuckDuckGo lite). Unreliable (rate-limited) — returns []
// when blocked so the caller degrades gracefully rather than fabricating.
async function ddgSearch(q, opts = {}) {
  const { ok, text } = await httpRequest(
    "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q),
    {
      headers: { Accept: "text/html" },
      resolveTarget: opts.resolveTarget,
      maxBytes: opts.maxBytes,
      signal: opts.signal,
    }
  );
  if (!ok) return [];
  const out = [];
  const linkRe =
    /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = linkRe.exec(text)) && out.length < (opts.count || 5)) {
    out.push({
      title: clean(m[2]),
      url: ddgRealUrl(m[1]),
      snippet: "",
      age: "",
    });
  }
  const snips = [
    ...text.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g),
  ].map(x => clean(x[1]));
  out.forEach((r, i) => {
    if (snips[i]) r.snippet = snips[i];
  });
  return out;
}

// Tavily — LLM-native, official free tier (1k/mo, no card), one call returns
// ranked results (+ optional answer/content). The recommended primary backend.
async function tavilySearch(q, opts = {}) {
  const body = {
    api_key: process.env.TAVILY_API_KEY,
    query: q,
    max_results: opts.count || 5,
    search_depth: "basic",
  };
  const days = { day: 1, week: 7, month: 30, year: 365 }[opts.recency];
  if (days) body.days = days;
  const base = (
    process.env.TAVILY_BASE_URL || "https://api.tavily.com"
  ).replace(/\/+$/, "");
  const { ok, text } = await httpRequest(`${base}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, // newer API; api_key in body covers older
    },
    body: JSON.stringify(body),
    resolveTarget: opts.resolveTarget,
    maxBytes: opts.maxBytes,
    signal: opts.signal,
  });
  if (!ok) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return (data?.results || []).map(r => ({
    title: clean(r.title),
    url: r.url,
    snippet: clean(r.content || ""),
    age: r.published_date || "",
  }));
}

// Pick the most reliable backend available from the environment. Tavily first
// (LLM-native, real free tier), then Serper/Brave, DuckDuckGo as keyless last resort.
export function pickBackend(env = process.env) {
  if (env.TAVILY_API_KEY) return { name: "tavily", fn: tavilySearch };
  if (env.SERPER_API_KEY) return { name: "serper", fn: serperSearch };
  if (env.BRAVE_API_KEY) return { name: "brave", fn: braveSearch };
  return { name: "ddg", fn: ddgSearch };
}

export function searchProviderHealth(env = process.env) {
  const backend = pickBackend(env);
  if (backend.name === "ddg") {
    return {
      ready: false,
      provider: backend.name,
      code: "missing_key",
      reason: "仅有 DDG keyless fallback，不能作为可验证的正式 Search Provider",
    };
  }
  return {
    ready: true,
    provider: backend.name,
    code: "ready",
    reason: `${backend.name} Search Provider 已配置`,
  };
}

// Dedupe by normalized host+path so the same page from different query params
// or trailing slashes collapses to one result.
export function dedupe(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (!r?.url) continue;
    let keyUrl = r.url;
    try {
      const u = new URL(r.url);
      keyUrl = (u.host + u.pathname).replace(/\/+$/, "").toLowerCase();
    } catch {
      /* keep raw url as key */
    }
    if (seen.has(keyUrl)) continue;
    seen.add(keyUrl);
    out.push(r);
  }
  return out;
}

// Model-facing format: a clean numbered list of sources to read further with web_fetch.
export function formatResults(query, results, backendName) {
  if (!results.length) {
    const hint =
      backendName === "ddg"
        ? "（没搜到结果或被限流。设置 TAVILY_API_KEY（免费 1000/月、免信用卡）即可稳定返回，亦支持 SERPER_API_KEY/BRAVE_API_KEY；或用 web_fetch 直连已知 URL。）"
        : "（没搜到结果。）";
    return `「${query}」无搜索结果。${hint}`;
  }
  const lines = results.map((r, i) => {
    const head = `${i + 1}. ${r.title || r.url}`;
    const snip = r.snippet ? `\n   ${truncate(r.snippet, 180)}` : "";
    const age = r.age ? `  ·  ${r.age}` : "";
    return `${head}${snip}\n   ${r.url}${age}`;
  });
  return (
    `「${query}」的搜索结果（${results.length} 条，可用 web_fetch 进一步读取某条 URL 取详情）：\n` +
    lines.join("\n")
  );
}

// The tool entry point. Returns { results, text, backend }.
export async function webSearch(query, opts = {}) {
  const q = String(query ?? "").trim();
  if (!q)
    return { results: [], text: "（web_search 缺少 query）", backend: "" };
  const backend = pickBackend();
  let results = [];
  try {
    results = await backend.fn(q, opts);
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    results = [];
  }
  results = dedupe(results).slice(0, opts.count || 5);
  return {
    results,
    text: formatResults(q, results, backend.name),
    backend: backend.name,
  };
}

// Convert a fetched HTML page to clean markdown: isolate the main article with
// Mozilla Readability, then Turndown → markdown. Falls back to whole-page
// turndown, then null (caller does a crude strip). Heavy libs are lazy-imported.
export async function cleanHtml(html, url) {
  try {
    const { parseHTML } = await import("linkedom");
    const { Readability } = await import("@mozilla/readability");
    const Turndown = (await import("turndown")).default;
    const { document } = parseHTML(html);
    let contentHtml = html;
    try {
      const article = new Readability(document).parse();
      if (article?.content) contentHtml = article.content;
    } catch {
      /* readability failed → turndown the whole doc */
    }
    const td = new Turndown({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    td.remove(["script", "style", "noscript"]);
    const md = td
      .turndown(contentHtml)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return md || null;
  } catch {
    return null;
  }
}
