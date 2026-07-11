import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { requestPublicText } from "../safe-http.mjs";

const server = http.createServer((req, res) => {
  if (req.url === "/redirect") {
    res.writeHead(302, {
      location: `http://private.test:${server.address().port}/secret`,
    });
    res.end();
    return;
  }
  if (req.url === "/secret") {
    server.secretHits += 1;
    res.end("secret");
    return;
  }
  if (req.url === "/large") {
    res.end("x".repeat(256));
    return;
  }
  res.end("public body");
});
server.secretHits = 0;
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;

const resolver = async url => {
  const parsed = new URL(url);
  if (parsed.hostname === "private.test")
    return { ok: false, reason: "private_network_blocked" };
  return {
    ok: true,
    url: parsed.href,
    hostname: parsed.hostname,
    address: "127.0.0.1",
    family: 4,
    addresses: ["127.0.0.1"],
  };
};

try {
  // `public.test` intentionally has no DNS record. Success proves the connection used the exact
  // address returned by validation instead of performing a second, rebindable DNS lookup.
  const ok = await requestPublicText(`http://public.test:${port}/`, {
    resolveTarget: resolver,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.body, "public body");

  const redirected = await requestPublicText(
    `http://public.test:${port}/redirect`,
    { resolveTarget: resolver }
  );
  assert.equal(redirected.ok, false);
  assert.equal(redirected.code, "private_network_blocked");
  assert.equal(
    server.secretHits,
    0,
    "a redirect target rejected by policy must never receive a socket"
  );

  const large = await requestPublicText(`http://public.test:${port}/large`, {
    resolveTarget: resolver,
    maxBytes: 32,
  });
  assert.equal(large.ok, false);
  assert.equal(large.code, "response_too_large");
} finally {
  server.close();
  await once(server, "close");
}

console.log("safe-http.test.mjs passed");
