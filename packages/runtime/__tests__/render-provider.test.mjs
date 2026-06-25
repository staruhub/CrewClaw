import assert from "node:assert/strict";
import { pickRenderProvider, renderPage } from "../render-provider.mjs";

// provider selection: explicit override wins, then cloud keys, else local default.
assert.equal(pickRenderProvider({ CREW_RENDER_PROVIDER: "playwright" }), "playwright");
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

console.log("render-provider tests passed");
