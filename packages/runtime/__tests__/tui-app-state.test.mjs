// The AppState reducer is the renderer-agnostic core: fold a TaskEvent stream into the
// workbench state. Pure, no TTY. Proves a research turn (task → plan → approval → tool →
// evidence → answer → artifact → done) reduces correctly + deterministically.
import assert from "node:assert/strict";
import { EVENTS, makeEvent } from "../tui/protocol.mjs";
import { reduceAll, SYM } from "../tui/app-state.mjs";

const evs = [
  makeEvent(EVENTS.TASK_STARTED, { id: "task1", title: "调研火山 Seed 2.1", mode: "Trial" }),
  makeEvent(EVENTS.PLAN_CREATED, { id: "plan1", steps: ["官方源优先", "抽字段", "组装报告"] }),
  makeEvent(EVENTS.TOOL_REQUESTED, { id: "tool1", tool: "browser.render", reason: "JS 空壳", needsApproval: true }),
  makeEvent(EVENTS.APPROVAL_RESOLVED, { id: "tool1", decision: "approve" }),
  makeEvent(EVENTS.TOOL_SUCCEEDED, { id: "tool1", summary: "读到正文" }),
  makeEvent(EVENTS.EVIDENCE_CREATED, { id: "ev1", fact: "Seed 2.1 上下文 256k", source: "official", confidence: 0.8 }),
  makeEvent(EVENTS.TOKEN_DELTA, { text: "根据官方文档，" }),
  makeEvent(EVENTS.TOKEN_DELTA, { text: "Seed 2.1 适合接入。" }),
  makeEvent(EVENTS.ARTIFACT_CREATED, { id: "art1", name: "seed-2.1-research.md", type: "report", status: "draft", checks: ["≥2 来源"] }),
  makeEvent(EVENTS.TOKEN_USAGE, { prompt: 1000, completion: 200 }),
  makeEvent(EVENTS.TASK_COMPLETED, { id: "task1" }),
];

const s = reduceAll(evs, { employee: { name: "鲸" }, mode: "Chat" });

assert.equal(s.task.title, "调研火山 Seed 2.1");
assert.equal(s.task.status, "done");
assert.equal(s.mode, "Trial");
assert.equal(s.plan.steps.length, 3);
assert.equal(s.tools.tool1.status, "ok");
assert.equal(s.evidence[0].source, "official");
assert.equal(s.artifacts[0].name, "seed-2.1-research.md");
assert.equal(s.answer, "根据官方文档，Seed 2.1 适合接入。");
assert.equal(s.usage.promptTok, 1000);
assert.equal(s.status, "done");
assert.equal(s.approval, null, "approval raised then cleared");

// the browser.render line went ? (awaiting) → ✓ (after success)
const renderLine = s.timeline.find((l) => l.label.includes("browser.render"));
assert.ok(renderLine && renderLine.status === SYM.ok, "approved+succeeded tool shows ✓ in timeline");
assert.ok(s.timeline.some((l) => l.status === SYM.ok && l.label.includes("完成")), "completion in timeline");

// purity: same events from a fresh state → identical timeline
const s2 = reduceAll(evs, { employee: { name: "鲸" }, mode: "Chat" });
assert.deepEqual(s2.timeline, s.timeline, "reducer is pure/deterministic");

// a failed tool marks ✗ with the structured error code (vision §8)
const f = reduceAll([
  makeEvent(EVENTS.TASK_STARTED, { id: "t", title: "x" }),
  makeEvent(EVENTS.TOOL_REQUESTED, { id: "srch", tool: "web.search" }),
  makeEvent(EVENTS.TOOL_FAILED, { id: "srch", code: "missing_key" }),
]);
assert.equal(f.tools.srch.status, "failed");
const sl = f.timeline.find((l) => l.id === "srch");
assert.ok(sl && sl.status === SYM.fail && sl.detail === "missing_key", "failed tool shows ✗ + code");

// v0.6 events: chat upgrade · pending actions · memory truth · artifact path
{
  const s2 = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "t", title: "ROI 示例" }),
    makeEvent(EVENTS.TASK_UPGRADED_FROM_CHAT, { reason: "需生成报告" }),
    makeEvent(EVENTS.PENDING_ACTIONS, { actions: [{ key: "1", label: "看示例" }, { key: "2", label: "改假设" }] }),
    makeEvent(EVENTS.MEMORY_STATE, { memory: { persistent: "disabled" } }),
    makeEvent(EVENTS.ARTIFACT_CREATED, { id: "a", name: "roi_report.md", kind: "report", path: "/x/.crewclaw/artifacts/t/roi_report.md" }),
  ]);
  assert.equal(s2.mode, "chat-upgraded", "chat→TaskRun upgrade");
  assert.equal(s2.pendingActions.length, 2, "pending actions captured (digit input matches here first)");
  assert.equal(s2.memory.persistent, "disabled", "memory truth merged");
  assert.equal(s2.memory.session, "available", "memory truth keeps defaults");
  assert.equal(s2.artifacts[0].path, "/x/.crewclaw/artifacts/t/roi_report.md", "artifact carries a real path");
  assert.equal(s2.artifacts[0].kind, "report");
  assert.ok(s2.timeline.some((l) => l.label.includes("升级")), "upgrade shows in timeline");
}

// completion verdict (§5.8 No-Chat-only-Done): outcome.checked → proof + a 验收 timeline line
{
  const ok = reduceAll([makeEvent(EVENTS.OUTCOME_CHECKED, { valid: true, deliverable: "/x/roi.md" })]);
  assert.equal(ok.proof.valid, true, "passing verdict recorded");
  assert.ok(ok.timeline.some((l) => l.status === SYM.ok && l.label.includes("验收")), "passing verdict shows ✓ 验收 in timeline");
  const bad = reduceAll([makeEvent(EVENTS.OUTCOME_CHECKED, { valid: false, gaps: ["no_artifact"], reason: "无可交付文件" })]);
  assert.equal(bad.proof.valid, false, "failing verdict recorded");
  assert.deepEqual(bad.proof.gaps, ["no_artifact"]);
  assert.ok(bad.timeline.some((l) => l.status === SYM.warn && l.label.includes("验收")), "failing verdict shows ! 验收 in timeline");
}

console.log("tui-app-state tests passed");
