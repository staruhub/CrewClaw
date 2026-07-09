// e2e-budget-enforcement.test.mjs — v0.18 C3: the SETTINGS monthly budget is enforced end to end.
// Unit-tests spend.mjs math, then drives the real jsonl-bridge to prove the ≥100% task refusal.
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { recordSpend, readSpend, isOverBudget, capForBudgetIndex, monthKey } from "../spend.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crew-budget-"));
}

function spendMathAndOneShotWarning() {
  const root = tmpRoot();
  // budget index 0 = $20 cap. Warn at 80% ($16).
  let r = recordSpend(root, 0, 10);
  assert.equal(r.total, 10);
  assert.equal(r.crossedWarn, false, "under 80% → no warning");
  r = recordSpend(root, 0, 7); // total 17 ≥ 16 (80%)
  assert.equal(r.crossedWarn, true, "crossing 80% fires the warning exactly once");
  r = recordSpend(root, 0, 1); // total 18, already warned
  assert.equal(r.crossedWarn, false, "warning is one-shot (warned_80 latched), not per-task");
  assert.equal(isOverBudget(root, 0), false, "18 < 20 → not over budget yet");
  recordSpend(root, 0, 5); // total 23 ≥ 20
  assert.equal(isOverBudget(root, 0), true, "≥ cap → over budget");
  assert.equal(capForBudgetIndex(0), 20);
  assert.equal(capForBudgetIndex(3), 200);
  assert.equal(capForBudgetIndex(99), 20, "out-of-range index falls back to the first cap");
  console.log("  ✓ spend math: cumulative total, one-shot 80% warning, over-budget at cap");
}

async function bridgeRefusesNewTaskOverBudget() {
  const root = tmpRoot();
  // Seed prefs (budget $20) + a spend ledger already at the cap.
  fs.mkdirSync(path.join(root, ".crewclaw", "spend"), { recursive: true });
  fs.writeFileSync(path.join(root, ".crewclaw", "prefs.json"), JSON.stringify({ budget: 0 }));
  fs.writeFileSync(path.join(root, ".crewclaw", "spend", `${monthKey()}.json`), JSON.stringify({ total: 25, warned_80: true }));

  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split("\n")) {
        const t = l.trim();
        if (t) events.push(JSON.parse(t));
      }
      cb();
    },
  });
  const done = startJsonlBridge({
    agentLoop: async () => "# 报告\n\n" + "内容。\n".repeat(20),
    meta: { mode: "Chat", agentId: "budget-agent" },
    input,
    output,
    root,
  });
  await sleep(20);
  input.push("给我一份内部知识问答ROI示例\n");
  await sleep(150);
  const types = events.map((e) => e.type);

  assert.ok(!types.includes("task.started"), "an over-budget new task must NOT start");
  const warn = events.find((e) => e.type === "budget.warning");
  assert.ok(warn, "a budget.warning is emitted on refusal");
  assert.equal(warn.data.level, "block", "the refusal warning is level:block");
  assert.equal(warn.data.cap, 20);
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log("  ✓ jsonl-bridge refuses a new task at ≥100% budget (emits budget.warning level:block)");
}

async function main() {
  console.log("e2e-budget-enforcement: monthly budget is tracked and enforced");
  spendMathAndOneShotWarning();
  await bridgeRefusesNewTaskOverBudget();
  console.log("e2e-budget-enforcement tests passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
