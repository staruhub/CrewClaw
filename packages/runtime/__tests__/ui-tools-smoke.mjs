import assert from "node:assert/strict";
import { toolCallHeader, toolCard } from "../ui-tools.mjs";

const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const longOutput = Array.from({ length: 14 }, (_, i) => `line ${i + 1} ${"x".repeat(230)}`).join("\n");

const bashCard = toolCard(
  { name: "bash", command: "ls -la", output: longOutput, elapsedMs: 340, ok: true },
  { color: true },
);
console.log(bashCard);
assert.match(bashCard, /╭─/);
assert.match(bashCard, /🔧 bash/);
assert.match(bashCard, /\$ ls -la/);
assert.match(bashCard, /… \(\+\d+ 行\)/);
assert.match(stripAnsi(bashCard), /0\.3s · ok/);
assert.match(bashCard, /\x1b\[2m/);

const searchCard = toolCard(
  {
    name: "search",
    args: { query: "agentLoop", path: "packages/runtime" },
    output: "packages/runtime/run.mjs:1:agentLoop",
    elapsedMs: 1210,
    ok: true,
  },
  { color: false },
);
console.log(searchCard);
assert.match(searchCard, /"agentLoop" in packages\/runtime/);
assert.match(searchCard, /1\.2s · ok/);
assert.doesNotMatch(searchCard, /\x1b\[/);

const failedCard = toolCard(
  { name: "bash", command: "false", output: "boom", elapsedMs: 18, ok: false },
  { color: true },
);
console.log(failedCard);
assert.match(stripAnsi(failedCard), /0\.0s · failed/);
assert.match(failedCard, /\x1b\[31mfailed/);

const skippedCard = toolCard(
  { name: "bash", command: "rm -rf tmp", output: "", elapsedMs: 0, confirmed: false },
  { color: false },
);
console.log(skippedCard);
assert.match(skippedCard, /已跳过/);

const header = toolCallHeader({ name: "bash", command: "pnpm test" }, { color: false });
console.log(header);
assert.match(header, /^╭─ 🔧 bash/);
assert.match(header, /\$ pnpm test/);
