import { isPublicHttpUrl } from "./tool-gateway.mjs";

// Browser Render Provider abstraction (Search Harness Step 3). Render is an UPGRADE
// channel — used ONLY after web_fetch reports requires_render, never as a default
// fetch (browsers are slow, costly, higher-risk). provider: none | playwright |
// firecrawl | browserbase. Read-only, isolated, no login state, no downloads, hard
// timeout. Cloud providers (firecrawl/browserbase) are stubs for later — the local
// Playwright provider proves the capability while the seam keeps it swappable.

export function pickRenderProvider(env = process.env) {
  const explicit = String(env.CREW_RENDER_PROVIDER || "")
    .toLowerCase()
    .trim();
  if (explicit) return explicit;
  if (env.FIRECRAWL_API_KEY) return "firecrawl";
  if (env.BROWSERBASE_API_KEY) return "browserbase";
  return "playwright"; // local default; renderPage degrades cleanly if not installed
}

// One preflight truth for every surface. The current local renderer deliberately refuses to
// launch until socket-level IP pinning/egress filtering exists; cloud providers are still stubs.
// Keeping this next to renderPage prevents a registered schema or installed npm package from
// being mistaken for an executable browser capability.
export function renderProviderHealth(env = process.env) {
  const provider = pickRenderProvider(env);
  if (provider === "playwright") {
    return {
      ready: false,
      provider,
      code: "network_egress_unverified",
      reason: "Playwright 出站连接尚未经过可绑定真实 IP 的安全过滤",
    };
  }
  if (provider === "firecrawl" || provider === "browserbase") {
    return {
      ready: false,
      provider,
      code: "provider_not_implemented",
      reason: `${provider} render provider 尚未实现`,
    };
  }
  return {
    ready: false,
    provider: provider || "none",
    code: "provider_unavailable",
    reason: "未配置可执行的 render provider",
  };
}

// renderPage(url, opts) -> { ok, html?, status?, provider?, reason?, note?, error? }
// Never throws. ok:false carries a machine-readable `reason` so callers degrade.
export async function renderPage(url, { provider, timeoutMs = 20000 } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: "bad_url" };
  const p = provider || pickRenderProvider();
  if (p === "playwright") return renderWithPlaywright(u, { timeoutMs });
  if (p === "firecrawl" || p === "browserbase") {
    return {
      ok: false,
      reason: "not_implemented",
      provider: p,
      note: p + " 云端渲染待接（先用 playwright 或停在 requires_render）",
    };
  }
  return { ok: false, reason: "no_render_provider" };
}

async function renderWithPlaywright(url, { timeoutMs }) {
  void timeoutMs;
  if (!isPublicHttpUrl(url))
    return {
      ok: false,
      reason: "private_network_blocked",
      provider: "playwright",
    };

  // Playwright request routing is not an egress security boundary: redirects only invoke a page
  // route for the first URL, Service Worker traffic bypasses page.route, popup first requests are
  // not covered, and WebSockets use a separate routing API. Until the renderer is connected through
  // an IP-pinning/filtering proxy that validates the address used by every socket, fail closed and
  // do not launch Chromium at all.
  return {
    ok: false,
    reason: "network_egress_unverified",
    provider: "playwright",
    note: "Playwright 网络渲染已安全禁用：尚未配置可绑定真实连接 IP 的出站过滤器。",
  };
}
