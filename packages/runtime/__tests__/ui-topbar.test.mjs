import assert from "node:assert/strict";
import {
  formatTokens,
  costFor,
  contextTokensForModel,
  ctxPercent,
  topBar,
  installTopBar,
} from "../ui-topbar.mjs";
import { visibleLen } from "../ui.mjs";

const ESC = "\x1b";

{
  const bar = topBar(
    { title: "Hi", tokens: 39413, ctxPct: 20, cost: 0.29 },
    { color: false, width: 40 }
  );
  assert.ok(bar.endsWith("39,413  20% ($0.29)"));
  assert.equal(visibleLen(bar), 40);
}

assert.equal(formatTokens(39413), "39,413");
assert.equal(contextTokensForModel("x-ai/grok-4.5"), 500_000);
assert.equal(contextTokensForModel("grok-4.5-latest"), 500_000);
assert.equal(contextTokensForModel("unknown/model"), 200_000);
assert.equal(ctxPercent(50_000, "x-ai/grok-4.5"), 10);

{
  const cost = costFor("anthropic/claude-opus-4.8", 1000, 1000);
  assert.ok(cost > 0);
  assert.equal(cost, (1000 / 1e6) * 15 + (1000 / 1e6) * 75);
}

{
  const bar = topBar(
    { title: "Hi", tokens: 39413, ctxPct: 20, cost: 0.29 },
    { color: false, width: 40 }
  );
  assert.equal(bar.includes(ESC), false);
}

{
  const cap = [];
  const state = { title: "Hi", tokens: 39413, ctxPct: 20, cost: 0.29 };
  const fake = { isTTY: false, write: s => cap.push(s), on() {}, off() {} };
  const installed = installTopBar(() => state, { stream: fake });
  assert.deepEqual(cap, []);
  assert.equal(typeof installed.redraw, "function");
  assert.equal(typeof installed.dispose, "function");
}

{
  const cap = [];
  const fake = {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: s => cap.push(s),
    on() {},
    off() {},
  };
  const installed = installTopBar(
    () => ({ title: "Hi", tokens: 39413, ctxPct: 20, cost: 0.29 }),
    { stream: fake }
  );
  assert.ok(cap.join("").includes(ESC + "[2;24r"));
  assert.ok(cap.join("").includes(ESC + "[2;1H"));
  installed.dispose();
  assert.ok(cap.join("").includes(ESC + "[r"));
}
