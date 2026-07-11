// Security contract: local Playwright rendering stays disabled until every browser socket is
// forced through an address-validating, IP-pinning egress layer. Page routing alone misses
// redirects, Service Workers, popup first requests and WebSockets.
import assert from "node:assert/strict";

import { renderPage } from "../render-provider.mjs";

const result = await renderPage("https://example.com/dynamic", {
  provider: "playwright",
  timeoutMs: 15000,
});

assert.equal(result.ok, false);
assert.equal(result.reason, "network_egress_unverified");
assert.equal(result.provider, "playwright");
console.log(
  "e2e-render-provider: unverified Playwright egress fails closed — passed"
);
