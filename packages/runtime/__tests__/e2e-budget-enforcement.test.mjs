// e2e-budget-enforcement.test.mjs — v0.18 C3: the SETTINGS monthly budget is enforced end to end.
// Unit-tests spend.mjs math, then drives the real jsonl-bridge to prove the ≥100% task refusal.
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import {
  recordSpend,
  readSpend,
  isOverBudget,
  capForBudgetIndex,
  monthKey,
  SPEND_STATE_INVALID,
} from "../spend.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (predicate, label, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  assert.fail(label);
};

const collapsePacedDeltas = lifecycle =>
  lifecycle.filter(
    (type, index) =>
      type !== "token.delta" || lifecycle[index - 1] !== "token.delta"
  );

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
  assert.equal(
    r.crossedWarn,
    true,
    "crossing 80% fires the warning exactly once"
  );
  r = recordSpend(root, 0, 1); // total 18, already warned
  assert.equal(
    r.crossedWarn,
    false,
    "warning is one-shot (warned_80 latched), not per-task"
  );
  assert.equal(isOverBudget(root, 0), false, "18 < 20 → not over budget yet");
  recordSpend(root, 0, 5); // total 23 ≥ 20
  assert.equal(isOverBudget(root, 0), true, "≥ cap → over budget");
  recordSpend(root, 0, 3, monthKey(), { settlementId: "task-once" });
  recordSpend(root, 0, 3, monthKey(), { settlementId: "task-once" });
  assert.equal(
    readSpend(root).total,
    26,
    "crash-retried settlement id is charged exactly once"
  );
  assert.equal(capForBudgetIndex(0), 20);
  assert.equal(capForBudgetIndex(3), 200);
  assert.equal(
    capForBudgetIndex(99),
    20,
    "out-of-range index falls back to the first cap"
  );
  console.log(
    "  ✓ spend math: cumulative total, one-shot 80% warning, over-budget at cap"
  );
}

function invalidLedgerFailsClosed() {
  for (const fixture of ["corrupt", "hardlink", "oversized"]) {
    const root = tmpRoot();
    const dir = path.join(root, ".crewclaw", "spend");
    const file = path.join(dir, `${monthKey()}.json`);
    fs.mkdirSync(dir, { recursive: true });
    if (fixture === "hardlink") {
      const outside = path.join(root, "outside-spend.json");
      fs.writeFileSync(outside, JSON.stringify({ total: 25, warned_80: true }));
      fs.linkSync(outside, file);
    } else if (fixture === "oversized") {
      fs.writeFileSync(file, Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    } else {
      fs.writeFileSync(file, "{corrupt");
    }

    assert.equal(readSpend(root).state, SPEND_STATE_INVALID, fixture);
    assert.equal(
      isOverBudget(root, 0),
      true,
      `${fixture} budget state must fail closed`
    );
    assert.equal(
      recordSpend(root, 0, 1).persisted,
      false,
      `${fixture} budget state must not be overwritten`
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("  ✓ corrupt, hardlinked and oversized ledgers fail closed");
}

async function bridgeRefusesNewTaskOverBudget() {
  const root = tmpRoot();
  // Seed prefs (budget $20) + a spend ledger already at the cap.
  fs.mkdirSync(path.join(root, ".crewclaw", "spend"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".crewclaw", "prefs.json"),
    JSON.stringify({ budget: 0 })
  );
  fs.writeFileSync(
    path.join(root, ".crewclaw", "spend", `${monthKey()}.json`),
    JSON.stringify({ total: 25, warned_80: true })
  );

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
  await waitFor(
    () => events.some(event => event.type === "task.blocked"),
    "paced budget refusal did not reach task.blocked"
  );
  const types = events.map(e => e.type);

  const lifecycle = types.filter(type =>
    [
      "task.started",
      "generation.started",
      "token.delta",
      "assistant.rendered",
      "generation.completed",
      "task.blocked",
    ].includes(type)
  );
  assert.deepEqual(
    collapsePacedDeltas(lifecycle),
    [
      "task.started",
      "generation.started",
      "token.delta",
      "assistant.rendered",
      "generation.completed",
      "task.blocked",
    ],
    "budget refusal is a complete correlated turn and cannot leave the UI working"
  );
  const warn = events.find(e => e.type === "budget.warning");
  assert.ok(warn, "a budget.warning is emitted on refusal");
  assert.equal(warn.data.level, "block", "the refusal warning is level:block");
  assert.equal(warn.data.cap, 20);
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log(
    "  ✓ jsonl-bridge refuses a new task at ≥100% budget (emits budget.warning level:block)"
  );
}

async function bridgeRefusesNewTaskWhenLedgerIsInvalid() {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".crewclaw", "spend"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".crewclaw", "prefs.json"),
    JSON.stringify({ budget: 0 })
  );
  fs.writeFileSync(
    path.join(root, ".crewclaw", "spend", `${monthKey()}.json`),
    "{corrupt"
  );

  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) events.push(JSON.parse(line));
      }
      cb();
    },
  });
  const done = startJsonlBridge({
    agentLoop: async () => "must not run",
    meta: { mode: "Chat", agentId: "budget-agent" },
    input,
    output,
    root,
  });
  await sleep(20);
  input.push("开始新任务\n");
  await waitFor(
    () => events.some(event => event.type === "task.blocked"),
    "paced invalid-ledger refusal did not reach task.blocked"
  );

  assert.deepEqual(
    collapsePacedDeltas(
      events
        .map(event => event.type)
        .filter(type =>
          [
            "task.started",
            "generation.started",
            "token.delta",
            "assistant.rendered",
            "generation.completed",
            "task.blocked",
          ].includes(type)
        )
    ),
    [
      "task.started",
      "generation.started",
      "token.delta",
      "assistant.rendered",
      "generation.completed",
      "task.blocked",
    ]
  );
  const warning = events.find(event => event.type === "budget.warning");
  assert.equal(warning?.data?.reason_code, "budget_state_unavailable");
  assert.ok(
    events
      .filter(event => event.type === "token.delta")
      .map(event => event.data?.text || "")
      .join("")
      .includes("预算账本无法安全验证")
  );
  input.push("/exit\n");
  await sleep(20);
  await done;
  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    "  ✓ invalid budget ledger blocks a new task with a generic reason"
  );
}

async function main() {
  console.log("e2e-budget-enforcement: monthly budget is tracked and enforced");
  spendMathAndOneShotWarning();
  invalidLedgerFailsClosed();
  await bridgeRefusesNewTaskOverBudget();
  await bridgeRefusesNewTaskWhenLedgerIsInvalid();
  console.log("e2e-budget-enforcement tests passed");
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  }
);
