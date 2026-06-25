import assert from "node:assert/strict";
import http from "node:http";

let capturedBody;
let authHeader = "";

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/search") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  authHeader = req.headers.authorization || "";

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    results: [
      {
        title: "T1",
        url: "https://a.com/1",
        content: "snippet one",
        published_date: "2026-01-01",
      },
      {
        title: "T2",
        url: "https://a.com/2",
        content: "snippet two",
      },
    ],
  }));
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const actualPort = server.address().port;
  process.env.TAVILY_API_KEY = "test-key";
  process.env.TAVILY_BASE_URL = "http://127.0.0.1:" + actualPort;

  const { webSearch } = await import("../tools-web.mjs");
  const r = await webSearch("北京 活动", { recency: "week" });

  assert.equal(r.backend, "tavily");
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].title, "T1");
  assert.equal(r.results[0].url, "https://a.com/1");
  assert.equal(r.results[0].snippet, "snippet one");
  assert.equal(r.results[0].age, "2026-01-01");
  assert.match(r.text, /T1/);
  assert.match(r.text, /https:\/\/a\.com\/1/);
  assert.match(r.text, /web_fetch/);
  assert.equal(capturedBody.query, "北京 活动");
  assert.ok(capturedBody.max_results);
  assert.equal(capturedBody.days, 7);
  assert.ok(authHeader.includes("Bearer test-key") || capturedBody.api_key === "test-key");

  console.log("tools-web tavily assertions passed");
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  delete process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_BASE_URL;
}
