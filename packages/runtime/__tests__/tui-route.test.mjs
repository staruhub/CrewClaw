// The shared v0.6 Intent/Scope routing (used by both Ink + Ratatui renderers). Classifies a
// user message and drives the TaskRun via events. Fakes the model turn + captures events.
import assert from "node:assert/strict";
import { routeTurn } from "../tui/route.mjs";
import { EVENTS } from "../tui/protocol.mjs";

function harness(extra = {}) {
  const events = [], turns = [];
  return {
    events, turns,
    emit: (type, data) => events.push({ type, data }),
    runModelTurn: async (msg) => { turns.push(msg); },
    has: (type) => events.some((e) => e.type === type),
    ...extra,
  };
}

// 1) employee_task → upgrade to TaskRun + run the model turn
{
  const h = harness();
  const d = await routeTurn("给我一份内部知识问答 ROI 示例报告", { emit: h.emit, runModelTurn: h.runModelTurn });
  assert.equal(d.type, "employee_task");
  assert.ok(h.has(EVENTS.TASK_UPGRADED_FROM_CHAT), "formal task upgrades to a TaskRun (not a chat reply)");
  assert.equal(h.turns.length, 1, "runs the model turn");
}

// 2) quick_utility → emits quick.utility (un-scored), still runs
{
  const h = harness();
  const d = await routeTurn("杭州天气？", { emit: h.emit, runModelTurn: h.runModelTurn });
  assert.equal(d.type, "quick_utility");
  assert.ok(h.has(EVENTS.QUICK_UTILITY), "weather routes to Quick Utility (not employee professional work)");
}

// 3) memory_command → memory truth, NO model turn (memory is a tool, not a sentence)
{
  const h = harness();
  const d = await routeTurn("jizhu", { emit: h.emit, runModelTurn: h.runModelTurn, env: {} });
  assert.equal(d.type, "memory_command");
  assert.ok(h.has(EVENTS.MEMORY_STATE), "emits the real memory truth state");
  assert.equal(h.turns.length, 0, "no model turn — no false 'I can't remember'");
}

// 4) digit input matches a PendingAction FIRST (§6.4 — system-owned, not model-guessed)
{
  const h = harness();
  const d = await routeTurn("1", { emit: h.emit, runModelTurn: h.runModelTurn, pendingActions: [{ key: "1", label: "生成 ROI 示例", payload: "生成 ROI 示例报告" }] });
  assert.ok(d.matchedPendingAction, "digit matched a PendingAction");
  assert.equal(h.turns.length, 1, "runs the matched action's payload");
  assert.equal(h.turns[0], "生成 ROI 示例报告");
}

// 5) out_of_scope → decline, no model turn
{
  const h = harness();
  const d = await routeTurn("帮我写一首情诗", { emit: h.emit, runModelTurn: h.runModelTurn, role: "落地顾问" });
  assert.equal(d.type, "out_of_scope");
  assert.equal(h.turns.length, 0, "out-of-scope doesn't burn the employee on it");
  assert.ok(h.events.some((e) => e.type === EVENTS.TOKEN_DELTA && /岗位/.test(e.data.text)), "declines with a scope note");
}

console.log("tui-route tests passed");
