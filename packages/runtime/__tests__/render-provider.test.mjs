import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickRenderProvider, renderPage } from "../render-provider.mjs";

// provider selection: explicit override wins, then cloud keys, else local default.
assert.equal(
  pickRenderProvider({ CREW_RENDER_PROVIDER: "playwright" }),
  "playwright"
);
assert.equal(pickRenderProvider({ CREW_RENDER_PROVIDER: "none" }), "none");
assert.equal(pickRenderProvider({ FIRECRAWL_API_KEY: "x" }), "firecrawl");
assert.equal(pickRenderProvider({ BROWSERBASE_API_KEY: "x" }), "browserbase");
assert.equal(pickRenderProvider({}), "playwright");

// renderPage degrades cleanly without ever launching a browser for these cases.
const bad = await renderPage("not-a-url", { provider: "playwright" });
assert.equal(bad.ok, false);
assert.equal(bad.reason, "bad_url");

const none = await renderPage("https://example.com", { provider: "none" });
assert.equal(none.ok, false);
assert.equal(none.reason, "no_render_provider");

const fc = await renderPage("https://example.com", { provider: "firecrawl" });
assert.equal(fc.ok, false);
assert.equal(fc.reason, "not_implemented");

const privateTarget = await renderPage("http://127.0.0.1/admin", {
  provider: "playwright",
});
assert.equal(privateTarget.ok, false);
assert.equal(privateTarget.reason, "private_network_blocked");

const unverifiedEgress = await renderPage("https://example.com", {
  provider: "playwright",
});
assert.equal(unverifiedEgress.ok, false);
assert.equal(unverifiedEgress.reason, "network_egress_unverified");
assert.equal(unverifiedEgress.provider, "playwright");

// Redirects, Service Workers, popup first requests and WebSockets all have routing paths that
// `page.route` cannot fully police. Until a socket-level filtering proxy exists, the provider must
// remain a pure fail-closed stub and must not launch or navigate Chromium.
const source = readFileSync(
  new URL("../render-provider.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  source,
  /chromium\.launch|page\.goto|page\.route\(|routeWebSocket|import\(["']playwright["']\)/
);
assert.match(source, /network_egress_unverified/);

console.log("render-provider tests passed");
