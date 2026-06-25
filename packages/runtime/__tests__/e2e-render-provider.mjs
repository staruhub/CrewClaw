// Proof of Step 3 — Browser Render (local Playwright provider): a page whose body is
// injected by JavaScript is empty to a raw fetch (web_fetch → requires_render) but
// readable after rendering. Asserts the JS-injected text survives renderPage().
// Skips cleanly if Playwright isn't installed, so the suite stays green anywhere.
import assert from "node:assert/strict";
import http from "node:http";
import { renderPage } from "../render-provider.mjs";

let hasPlaywright = true;
try {
  await import("playwright");
} catch {
  hasPlaywright = false;
}

if (!hasPlaywright) {
  console.log("e2e-render-provider: SKIP (playwright not installed)");
  process.exit(0);
}

const HTML =
  '<!doctype html><html><head><title>火山方舟 Seed 文档</title></head><body>' +
  '<nav><a href="/">Home</a><a href="/docs">Docs</a></nav><div id="root"></div>' +
  '<script>document.getElementById("root").innerHTML =' +
  ' "<article>Doubao-Seed-2.1 Pro 上下文 256k token，价格 6/30 元。</article>";</script>' +
  "</body></html>";

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(HTML);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

try {
  const r = await renderPage(`http://127.0.0.1:${port}/docs/seed`, { provider: "playwright", timeoutMs: 15000 });
  assert.equal(r.ok, true, `render should succeed, got: ${JSON.stringify(r)}`);
  assert.match(r.html, /256k token/, "rendered HTML must contain the JS-injected text (proves JS executed)");
  // sanity: the raw bytes really were a shell (the text only appears after render)
  assert.doesNotMatch(HTML.replace(/<script[\s\S]*?<\/script>/g, ""), /256k token/);
  console.log("e2e-render-provider: Playwright renders the JS-populated DOM — passed");
} catch (error) {
  console.error(`Assertion failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(r));
}
