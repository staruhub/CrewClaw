// Browser Render Provider abstraction (Search Harness Step 3). Render is an UPGRADE
// channel — used ONLY after web_fetch reports requires_render, never as a default
// fetch (browsers are slow, costly, higher-risk). provider: none | playwright |
// firecrawl | browserbase. Read-only, isolated, no login state, no downloads, hard
// timeout. Cloud providers (firecrawl/browserbase) are stubs for later — the local
// Playwright provider proves the capability while the seam keeps it swappable.

export function pickRenderProvider(env = process.env) {
  const explicit = String(env.CREW_RENDER_PROVIDER || "").toLowerCase().trim();
  if (explicit) return explicit;
  if (env.FIRECRAWL_API_KEY) return "firecrawl";
  if (env.BROWSERBASE_API_KEY) return "browserbase";
  return "playwright"; // local default; renderPage degrades cleanly if not installed
}

// renderPage(url, opts) -> { ok, html?, status?, provider?, reason?, note?, error? }
// Never throws. ok:false carries a machine-readable `reason` so callers degrade.
export async function renderPage(url, { provider, timeoutMs = 20000 } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: "bad_url" };
  const p = provider || pickRenderProvider();
  if (p === "playwright") return renderWithPlaywright(u, { timeoutMs });
  if (p === "firecrawl" || p === "browserbase") {
    return { ok: false, reason: "not_implemented", provider: p, note: p + " 云端渲染待接（先用 playwright 或停在 requires_render）" };
  }
  return { ok: false, reason: "no_render_provider" };
}

async function renderWithPlaywright(url, { timeoutMs }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      ok: false,
      reason: "playwright_not_installed",
      note: "装一次即可：在 crewhire 下 `pnpm add playwright` 再 `npx playwright install chromium`",
    };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    // Isolated context: no persisted login/storage, downloads off (read-only reader).
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    // Hard-block dangerous schemes at the network layer (no file:// / ftp / downloads).
    await page.route("**/*", (route) => {
      if (/^(file|ftp):/i.test(route.request().url())) return route.abort();
      return route.continue();
    });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(Math.min(2500, Math.max(0, timeoutMs - 1000))); // bounded hydrate
    const html = await page.content();
    return { ok: true, html, status: resp ? resp.status() : 0, provider: "playwright" };
  } catch (e) {
    return { ok: false, reason: "render_failed", error: e?.message ?? String(e) };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
