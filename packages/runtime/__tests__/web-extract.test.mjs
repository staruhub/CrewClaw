import assert from "node:assert/strict";
import { extractPrompt, hasSpaMarker, isJsShell, linkCount, routeBySize } from "../web-extract.mjs";

assert.equal(linkCount("see [a](x) and [b](y)"), 2);
assert.ok(hasSpaMarker("<html><div id=\"root\"></div><script>__NEXT_DATA__={}</script></html>"));
assert.equal(hasSpaMarker("a real article with lots of words and no markers"), false);
assert.ok(isJsShell({ markdown: "[Home](/) [Docs](/d) [Login](/l)", html: "<div id=\"app\"></div>" }));
assert.equal(isJsShell({ markdown: "X".repeat(600), html: "<div id=\"app\"></div>" }), false);
assert.equal(routeBySize(100), "full");
assert.equal(routeBySize(10000), "extract");
assert.equal(routeBySize(600000), "chunk");
assert.equal(routeBySize(3000000), "reject");
assert.ok(extractPrompt({ task: "查 Seed 2.1 价格", fields: ["价格", "上下文"] }).includes("价格"));

console.log("web-extract.test.mjs passed");
