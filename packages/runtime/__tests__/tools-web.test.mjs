import assert from "node:assert/strict";
import {
  clean,
  dedupe,
  formatResults,
  pickBackend,
  cleanHtml,
} from "../tools-web.mjs";

// clean: strip tags, decode entities, collapse whitespace
assert.equal(clean("<b>Hi</b>  &amp; <i>there</i>"), "Hi & there");
assert.equal(clean("a&#39;b &quot;c&quot;"), 'a\'b "c"');

// dedupe: same host+path collapses (query/trailing slash ignored)
const deduped = dedupe([
  { title: "A", url: "https://x.com/page?a=1" },
  { title: "A2", url: "https://x.com/page/" },
  { title: "B", url: "https://y.com/other" },
  { title: "bad", url: "" },
]);
assert.equal(deduped.length, 2);
assert.deepEqual(
  deduped.map(r => r.title),
  ["A", "B"]
);

// backend selection by env (provider-agnostic)
assert.equal(pickBackend({ SERPER_API_KEY: "k" }).name, "serper");
assert.equal(pickBackend({ BRAVE_API_KEY: "k" }).name, "brave");
assert.equal(
  pickBackend({ SERPER_API_KEY: "k", BRAVE_API_KEY: "k" }).name,
  "serper"
);
assert.equal(pickBackend({ TAVILY_API_KEY: "k" }).name, "tavily");
assert.equal(
  pickBackend({ TAVILY_API_KEY: "k", SERPER_API_KEY: "k" }).name,
  "tavily"
); // tavily wins
assert.equal(pickBackend({}).name, "ddg");

// formatResults: numbered list with urls + a follow-up-with-fetch hint
const text = formatResults(
  "北京天气",
  [
    {
      title: "Weather",
      url: "https://wttr.in/beijing",
      snippet: "Sunny 21C",
      age: "1h",
    },
    { title: "More", url: "https://example.com/bj", snippet: "" },
  ],
  "brave"
);
assert.match(text, /1\. Weather/);
assert.match(text, /https:\/\/wttr\.in\/beijing/);
assert.match(text, /web_fetch/); // tells the agent to read further
assert.match(text, /2\. More/);

// empty results degrade honestly; ddg backend suggests setting a key
const empty = formatResults("q", [], "ddg");
assert.match(empty, /无搜索结果/);
assert.match(empty, /BRAVE_API_KEY|SERPER_API_KEY/);

const md = await cleanHtml(
  "<html><body><article><h1>Title Here</h1><p>Hello <b>world</b>, this is a paragraph of readable body text for the extractor.</p></article></body></html>",
  "https://example.com"
);
assert.ok(
  md && /Title Here/.test(md) && /Hello/.test(md),
  `cleanHtml should yield markdown text, got: ${md}`
);

console.log("tools-web assertions passed");
