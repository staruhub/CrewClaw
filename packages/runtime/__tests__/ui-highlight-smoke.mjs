import assert from "node:assert/strict";
import { highlightCode } from "../ui-highlight.mjs";

const ESC = "\x1b[";
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

const samples = [
  ["js", "const s = \"return false\";\n// comment\nif (s) return 42;"],
  ["json", "{\n  \"enabled\": true,\n  \"count\": 3\n}"],
  ["bash", "if [ \"$ok\" = true ]; then\n  echo \"return false\"\nfi # done"],
  ["rust", "fn main() {\n  let value = 7;\n  // comment\n}"],
  ["python", "def run():\n    text = \"return False\"\n    # comment\n    return 5"],
];

function lineCount(s) {
  return s.split("\n").length;
}

function assertTokenized(lang, code) {
  const highlighted = highlightCode(code, lang);
  console.log(`\n--- ${lang} ---\n${highlighted}`);
  assert.match(highlighted, /\x1b\[/, `${lang} should include ANSI`);
  assert.equal(lineCount(highlighted), lineCount(code), `${lang} should preserve line count`);
  return highlighted;
}

for (const [lang, code] of samples) assertTokenized(lang, code);

const js = highlightCode(samples[0][1], "node");
assert.match(js, /\x1b\[35mconst\x1b\[0m/, "js keyword should be magenta");
assert.match(js, /\x1b\[32m"return false"\x1b\[0m/, "js string should be green");
assert.match(js, /\x1b\[2m\/\/ comment\x1b\[0m/, "js comment should be dim");
assert.doesNotMatch(js, /\x1b\[35mreturn\x1b\[0m false"\x1b\[0m/, "keyword inside string should not be recolored");
assert.match(js, /\x1b\[36m42\x1b\[0m/, "number should be cyan");

const json = highlightCode(samples[1][1], "json");
assert.match(json, /\x1b\[33mtrue\x1b\[0m/, "json boolean should be yellow");

const plain = highlightCode(samples[0][1], "js", { color: false });
assert.equal(plain, samples[0][1], "color=false should return original text");
assert.doesNotMatch(plain, ANSI_RE, "color=false should not include ANSI");
assert.ok(ESC, "escape marker exists for visual smoke output");

console.log("\nui-highlight smoke ok");
