import assert from "node:assert/strict";
import {
  cleanHtml,
  dedupe,
  formatResults,
  pickBackend,
} from "../tools-web.mjs";

async function group(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function assertStringOrNull(value) {
  assert.ok(
    typeof value === "string" || value === null,
    `expected string or null, got ${typeof value}`
  );
}

await group("cleanHtml", async () => {
  const html = `
    <html>
      <head>
        <style>.secret { color: red; } STYLE_ONLY_TEXT</style>
        <script>const hidden = "SCRIPT_ONLY_TEXT";</script>
      </head>
      <body>
        <main>
          <article>
            <h1>Visible title</h1>
            <section><p>Visible <strong>nested</strong> text.</p></section>
          </article>
        </main>
      </body>
    </html>
  `;
  const cleaned = await cleanHtml(html, "https://example.com/article");
  assert.equal(typeof cleaned, "string");
  assert.doesNotMatch(cleaned, /SCRIPT_ONLY_TEXT/);
  assert.doesNotMatch(cleaned, /STYLE_ONLY_TEXT/);
  assert.match(cleaned, /Visible/);
  assert.match(cleaned, /nested/);

  assertStringOrNull(await cleanHtml("", "https://example.com/empty"));
  assertStringOrNull(
    await cleanHtml("just plain text", "https://example.com/plain")
  );
});

await group("dedupe", () => {
  assert.deepEqual(
    dedupe([
      { title: "upper", url: "https://Example.com/page" },
      { title: "lower", url: "https://example.com/page" },
    ]).map(result => result.title),
    ["upper"]
  );

  assert.deepEqual(
    dedupe([
      { title: "slash", url: "https://example.com/a/path/" },
      { title: "no slash", url: "https://example.com/a/path" },
    ]).map(result => result.title),
    ["slash"]
  );

  assert.deepEqual(
    dedupe([
      { title: "first query", url: "https://example.com/search?q=one" },
      { title: "second query", url: "https://example.com/search?q=two" },
    ]).map(result => result.title),
    ["first query"]
  );

  assert.deepEqual(
    dedupe([
      { title: "empty", url: "" },
      { title: "missing" },
      { title: "kept", url: "https://example.com/kept" },
    ]).map(result => result.title),
    ["kept"]
  );
});

await group("formatResults", () => {
  const formatted = formatResults(
    "query",
    [
      {
        title: "Alpha",
        url: "https://example.com/alpha",
        snippet: "Alpha summary",
      },
      {
        title: "Beta",
        url: "https://example.com/beta",
        snippet: "Beta summary",
      },
    ],
    "brave"
  );
  assert.match(formatted, /1\. Alpha/);
  assert.match(formatted, /https:\/\/example\.com\/alpha/);
  assert.match(formatted, /2\. Beta/);
  assert.match(formatted, /https:\/\/example\.com\/beta/);
  assert.match(formatted, /web_fetch/);

  assert.match(formatResults("empty", [], "brave"), /无搜索结果/);
  assert.match(formatResults("empty", [], "ddg"), /TAVILY_API_KEY/);
});

await group("pickBackend", () => {
  assert.equal(pickBackend({ TAVILY_API_KEY: "k" }).name, "tavily");
  assert.equal(pickBackend({ SERPER_API_KEY: "k" }).name, "serper");
  assert.equal(pickBackend({ BRAVE_API_KEY: "k" }).name, "brave");
  assert.equal(pickBackend({}).name, "ddg");
  assert.equal(
    pickBackend({ TAVILY_API_KEY: "k", SERPER_API_KEY: "k" }).name,
    "tavily"
  );
});
