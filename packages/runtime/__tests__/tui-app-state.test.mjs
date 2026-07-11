// The AppState reducer is the renderer-agnostic core: fold a TaskEvent stream into the
// workbench state. Pure, no TTY. Proves a research turn (task → plan → approval → tool →
// evidence → answer → artifact → done) reduces correctly + deterministically.
import assert from "node:assert/strict";
import { EVENTS, makeEvent } from "../tui/protocol.mjs";
import { reduceAll, SYM } from "../tui/app-state.mjs";

const evs = [
  makeEvent(EVENTS.TASK_STARTED, {
    id: "task1",
    title: "调研火山 Seed 2.1",
    mode: "Trial",
  }),
  makeEvent(EVENTS.PLAN_CREATED, {
    id: "plan1",
    steps: ["官方源优先", "抽字段", "组装报告"],
  }),
  makeEvent(EVENTS.TOOL_REQUESTED, {
    id: "tool1",
    tool: "browser.render",
    reason: "JS 空壳",
    needsApproval: true,
  }),
  makeEvent(EVENTS.APPROVAL_RESOLVED, {
    id: "tool1",
    taskRunId: "task1",
    kind: "tool_authorization",
    decision: "allow",
  }),
  makeEvent(EVENTS.TOOL_SUCCEEDED, { id: "tool1", summary: "读到正文" }),
  makeEvent(EVENTS.EVIDENCE_CREATED, {
    id: "ev1",
    fact: "Seed 2.1 上下文 256k",
    source: "official",
    confidence: 0.8,
  }),
  makeEvent(EVENTS.TOKEN_DELTA, { text: "根据官方文档，" }),
  makeEvent(EVENTS.TOKEN_DELTA, { text: "Seed 2.1 适合接入。" }),
  makeEvent(EVENTS.ARTIFACT_CREATED, {
    id: "art1",
    taskRunId: "task1",
    name: "seed-2.1-research.md",
    type: "report",
    path: "/x/seed-2.1-research.md",
    status: "draft",
    checks: ["≥2 来源"],
  }),
  makeEvent(EVENTS.OUTCOME_CHECKED, {
    taskRunId: "task1",
    valid: true,
    deliverable: "/x/seed-2.1-research.md",
  }),
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
const renderLine = s.timeline.find(l => l.label.includes("browser.render"));
assert.ok(
  renderLine && renderLine.status === SYM.ok,
  "approved+succeeded tool shows ✓ in timeline"
);
assert.ok(
  s.timeline.some(l => l.status === SYM.ok && l.label.includes("完成")),
  "completion in timeline"
);

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
const sl = f.timeline.find(l => l.id === "srch");
assert.ok(
  sl && sl.status === SYM.fail && sl.detail === "missing_key",
  "failed tool shows ✗ + code"
);

// v0.6 events: chat upgrade · pending actions · memory truth · artifact path
{
  const s2 = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "t", title: "ROI 示例" }),
    makeEvent(EVENTS.TASK_UPGRADED_FROM_CHAT, {
      taskRunId: "t",
      reason: "需生成报告",
    }),
    makeEvent(EVENTS.PENDING_ACTIONS, {
      actions: [
        { key: "1", label: "看示例" },
        { key: "2", label: "改假设" },
      ],
    }),
    makeEvent(EVENTS.MEMORY_STATE, { memory: { persistent: "disabled" } }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "a",
      taskRunId: "t",
      name: "roi_report.md",
      kind: "report",
      path: "/x/.crewclaw/artifacts/t/roi_report.md",
    }),
  ]);
  assert.equal(s2.mode, "chat-upgraded", "chat→TaskRun upgrade");
  assert.equal(
    s2.pendingActions.length,
    2,
    "pending actions captured (digit input matches here first)"
  );
  assert.equal(s2.memory.persistent, "disabled", "memory truth merged");
  assert.equal(s2.memory.session, "available", "memory truth keeps defaults");
  assert.equal(
    s2.artifacts[0].path,
    "/x/.crewclaw/artifacts/t/roi_report.md",
    "artifact carries a real path"
  );
  assert.equal(s2.artifacts[0].kind, "report");
  assert.ok(
    s2.timeline.some(l => l.label.includes("升级")),
    "upgrade shows in timeline"
  );
}

// completion verdict (§5.8 No-Chat-only-Done): outcome.checked → proof + a 验收 timeline line
{
  const ok = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "ok", mode: "Task" }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "ok-a",
      taskRunId: "ok",
      path: "/x/roi.md",
    }),
    makeEvent(EVENTS.OUTCOME_CHECKED, {
      taskRunId: "ok",
      valid: true,
      deliverable: "/x/roi.md",
    }),
  ]);
  assert.equal(ok.proof.valid, true, "passing verdict recorded");
  assert.equal(ok.proof.status, "valid");
  assert.ok(
    ok.timeline.some(l => l.status === SYM.ok && l.label.includes("验收")),
    "passing verdict shows ✓ 验收 in timeline"
  );
  const bad = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "bad", mode: "Task" }),
    makeEvent(EVENTS.OUTCOME_CHECKED, {
      taskRunId: "bad",
      valid: false,
      gaps: ["no_artifact"],
      reason: "无可交付文件",
    }),
  ]);
  assert.equal(bad.proof.valid, false, "failing verdict recorded");
  assert.equal(bad.proof.status, "invalid");
  assert.deepEqual(bad.proof.gaps, ["no_artifact"]);
  assert.ok(
    bad.timeline.some(l => l.status === SYM.warn && l.label.includes("验收")),
    "failing verdict shows ! 验收 in timeline"
  );
  const unknown = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "unknown", mode: "Task" }),
    makeEvent(EVENTS.OUTCOME_CHECKED, {
      taskRunId: "unknown",
      passed: true,
      deliverable: "/x/legacy.md",
    }),
  ]);
  assert.equal(
    unknown.proof.valid,
    null,
    "missing valid is unknown, never implicit success"
  );
  assert.equal(unknown.proof.status, "unknown");
  assert.ok(
    unknown.timeline.some(
      l => l.status === SYM.warn && l.label.includes("结果未知")
    )
  );
}

// Deleted/pathless artifacts and explicit failed verdicts never satisfy completion.
{
  const deleted = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "t",
      title: "删除后的任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "a",
      taskRunId: "t",
      name: "report.md",
      path: "/x/report.md",
    }),
    makeEvent(EVENTS.ARTIFACT_DELETED, {
      artifact_id: "a",
      taskRunId: "t",
      ok: true,
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "t" }),
  ]);
  assert.equal(deleted.status, "needs_artifact");

  const pathless = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "t",
      title: "无路径任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "a",
      taskRunId: "t",
      name: "report.md",
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "t" }),
  ]);
  assert.equal(pathless.status, "needs_artifact");

  const invalid = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "t",
      title: "未通过任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "a",
      taskRunId: "t",
      name: "report.md",
      path: "/x/report.md",
    }),
    makeEvent(EVENTS.OUTCOME_CHECKED, {
      taskRunId: "t",
      valid: false,
      reason: "缺来源",
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "t" }),
  ]);
  assert.equal(invalid.status, "needs_revision");
  assert.notEqual(invalid.task.status, "done");
}

// Formal task completion is scoped to artifacts created after the current task
// started.  A previous task's artifact cannot make a new task Done.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "old",
      title: "上一轮",
      mode: "Task",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "old-art",
      taskRunId: "old",
      name: "old.md",
      path: "/x/old.md",
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "old" }),
    makeEvent(EVENTS.TASK_STARTED, {
      id: "new",
      title: "新任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "new" }),
  ]);
  assert.equal(state.task.id, "new");
  assert.equal(state.task.status, "needs_artifact");
  assert.equal(state.status, "needs_artifact");
  assert.equal(state.artifacts[0].taskId, "old");
  assert.equal(
    state.timeline.filter(l => l.label.includes("缺少交付物")).length,
    1
  );

  const stale = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "old",
      title: "上一轮",
      mode: "Task",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "old-art",
      taskRunId: "old",
      name: "old.md",
      path: "/x/old.md",
    }),
    makeEvent(EVENTS.TASK_STARTED, {
      id: "new",
      title: "新任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "old" }),
  ]);
  assert.equal(stale.task.id, "new");
  assert.equal(stale.status, "running");
}

// Chat turns remain artifact-free and settle to idle instead of formal Done.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "chat-1",
      title: "你好",
      mode: "Chat",
    }),
    makeEvent(EVENTS.TOKEN_DELTA, { text: "你好呀" }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "chat-1" }),
  ]);
  assert.equal(state.task.status, "done");
  assert.equal(state.status, "idle");
  assert.equal(
    state.timeline.some(l => l.label.includes("缺少交付物")),
    false,
    "chat completion bypasses the artifact gate"
  );
  assert.equal(
    state.timeline.some(l => l.label === "完成"),
    false,
    "chat completion matches Ratatui and adds no formal completion row"
  );
}

// Formal task correlation is fail-closed: missing/stale IDs cannot mutate task, outcome,
// artifact, or terminal state.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "current",
      title: "正式任务",
      mode: "Task",
    }),
    makeEvent(EVENTS.TASK_MODE_CHANGED, {
      taskRunId: "old",
      mode: "Chat",
    }),
    makeEvent(EVENTS.TASK_UPGRADED_FROM_CHAT, { reason: "missing id" }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "missing-correlation",
      path: "/x/no.md",
    }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "stale",
      taskRunId: "old",
      path: "/x/old.md",
    }),
    makeEvent(EVENTS.OUTCOME_CHECKED, { valid: true, deliverable: "/x/no.md" }),
    makeEvent(EVENTS.TASK_COMPLETED, {}),
    makeEvent(EVENTS.TASK_FAILED, {
      id: "current",
      taskRunId: "old",
      reason: "contradictory correlation",
    }),
    makeEvent(EVENTS.TASK_BLOCKED, { id: "old", reason: "stale" }),
  ]);
  assert.equal(state.task.id, "current");
  assert.equal(state.task.status, "running");
  assert.equal(state.mode, "Task");
  assert.equal(state.artifacts.length, 0);
  assert.equal(state.proof, null);
  assert.ok(
    state.debug.length >= 8,
    "every rejected critical event remains inspectable"
  );
  assert.ok(
    state.debug.some(line => line.includes("conflicting id current")),
    "taskRunId is canonical when legacy id contradicts it"
  );
}

// Explicit terminal events are monotonic and idempotent. A duplicate is a no-op; a conflicting
// terminal cannot overwrite the first terminal.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "terminal",
      title: "终态",
      mode: "Task",
    }),
    makeEvent(EVENTS.TASK_BLOCKED, { id: "terminal", reason: "缺权限" }),
    makeEvent(EVENTS.TASK_BLOCKED, { id: "terminal", reason: "重复" }),
    makeEvent(EVENTS.TASK_FAILED, { id: "terminal", reason: "冲突失败" }),
    makeEvent(EVENTS.TASK_COMPLETED, { id: "terminal" }),
  ]);
  assert.equal(state.task.status, "blocked");
  assert.equal(state.task.terminalType, EVENTS.TASK_BLOCKED);
  assert.equal(
    state.timeline.filter(line => line.label === "任务阻塞").length,
    1
  );
  assert.equal(
    state.timeline.some(line => line.label === "任务失败"),
    false
  );
  assert.ok(state.debug.some(line => line.includes("conflicting task.failed")));
}

// Once a task is terminal, a delayed acceptance cannot revive the task or increment KPI.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, {
      id: "terminal-approval",
      mode: "Task",
    }),
    makeEvent(EVENTS.APPROVAL_REQUESTED, {
      id: "late-approval",
      taskRunId: "terminal-approval",
      kind: "deliverable_acceptance",
    }),
    makeEvent(EVENTS.TASK_FAILED, {
      id: "terminal-approval",
      taskRunId: "terminal-approval",
      reason: "runtime crashed",
    }),
    makeEvent(EVENTS.APPROVAL_ACCEPTED, {
      id: "late-approval",
      taskRunId: "terminal-approval",
      kind: "deliverable_acceptance",
    }),
  ]);
  assert.equal(state.task.status, "failed");
  assert.equal(state.status, "failed");
  assert.equal(state.approval, null);
  assert.equal(state.acceptedCount, 0);
  assert.ok(
    state.debug.some(line => line.includes("approval.accepted after terminal"))
  );
}

// task.failed and task.revision_needed remain distinct product states.
{
  const failed = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "failed", mode: "Task" }),
    makeEvent(EVENTS.TASK_FAILED, {
      taskRunId: "failed",
      reason: "runtime crashed",
    }),
  ]);
  assert.equal(failed.status, "failed");
  assert.equal(failed.task.terminalType, EVENTS.TASK_FAILED);

  const revision = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "revision", mode: "Task" }),
    makeEvent(EVENTS.TASK_REVISION_NEEDED, {
      id: "revision",
      reason: "补充来源",
    }),
  ]);
  assert.equal(revision.status, "needs_revision");
  assert.equal(revision.task.terminalType, EVENTS.TASK_REVISION_NEEDED);
}

// Approval settlement requires the same id/kind/task and increments acceptance KPI once.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "approval-task", mode: "Task" }),
    makeEvent(EVENTS.APPROVAL_REQUESTED, {
      id: "ap-1",
      taskRunId: "approval-task",
      kind: "deliverable_acceptance",
      artifacts: [],
    }),
    makeEvent(EVENTS.APPROVAL_ACCEPTED, {
      id: "wrong",
      taskRunId: "approval-task",
      kind: "deliverable_acceptance",
    }),
    makeEvent(EVENTS.APPROVAL_ACCEPTED, {
      id: "ap-1",
      taskRunId: "approval-task",
      kind: "deliverable_acceptance",
    }),
    makeEvent(EVENTS.APPROVAL_ACCEPTED, {
      id: "ap-1",
      taskRunId: "approval-task",
      kind: "deliverable_acceptance",
    }),
  ]);
  assert.equal(state.approval, null);
  assert.equal(state.acceptedCount, 1);
  assert.equal(
    state.timeline.filter(line => line.label === "交付已验收").length,
    1
  );
  assert.ok(state.debug.some(line => line.includes("wrong")));
}

// Artifact export records an export destination without replacing the source path. Stale
// mutations cannot change an artifact belonging to the current task.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "artifact-task", mode: "Task" }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "artifact-1",
      taskRunId: "artifact-task",
      path: "/workspace/source.md",
    }),
    makeEvent(EVENTS.ARTIFACT_EXPORTED, {
      artifact_id: "artifact-1",
      taskRunId: "old-task",
      path: "/exports/stale.md",
      ok: true,
    }),
    makeEvent(EVENTS.ARTIFACT_EXPORTED, {
      artifact_id: "artifact-1",
      taskRunId: "artifact-task",
      path: "/exports/source.md",
      ok: true,
    }),
  ]);
  assert.equal(state.artifacts[0].path, "/workspace/source.md");
  assert.equal(state.artifacts[0].exportPath, "/exports/source.md");
  assert.equal(state.artifacts[0].taskId, "artifact-task");
}

// Failed artifact actions are visible but never claim the filesystem mutation succeeded.
{
  const state = reduceAll([
    makeEvent(EVENTS.TASK_STARTED, { id: "artifact-failure", mode: "Task" }),
    makeEvent(EVENTS.ARTIFACT_CREATED, {
      id: "artifact-1",
      taskRunId: "artifact-failure",
      path: "/workspace/source.md",
    }),
    makeEvent(EVENTS.ARTIFACT_DELETED, {
      artifact_id: "artifact-1",
      taskRunId: "artifact-failure",
      ok: false,
      code: "delete_failed",
    }),
    makeEvent(EVENTS.ARTIFACT_EXPORTED, {
      artifact_id: "artifact-1",
      taskRunId: "artifact-failure",
      ok: false,
      code: "export_failed",
    }),
  ]);
  assert.equal(state.artifacts[0].status, "draft");
  assert.equal(state.artifacts[0].exportPath, undefined);
  assert.ok(state.timeline.some(line => line.label === "删除产物失败"));
  assert.ok(state.timeline.some(line => line.label === "导出产物失败"));
}

// Every previously dropped protocol event now has observable semantics in the Node mirror.
{
  const state = reduceAll([
    makeEvent(EVENTS.SESSION_READY, {
      employee: { name: "鲸", mode: "Chat" },
      caps: { commands: [{ name: "/model", desc: "show model" }] },
    }),
    makeEvent(EVENTS.TASK_STARTED, { id: "mirror", mode: "Chat" }),
    makeEvent(EVENTS.TASK_MODE_CHANGED, {
      taskRunId: "mirror",
      mode: "Chat",
    }),
    makeEvent(EVENTS.TOOL_CALLED, { id: "called", tool: "web_fetch" }),
    makeEvent(EVENTS.TOOL_BLOCKED, { id: "called", code: "policy" }),
    makeEvent(EVENTS.ASSISTANT_MESSAGE, { text: "answer" }),
    makeEvent(EVENTS.ASSISTANT_RENDERED, {
      turn_id: "turn",
      ansi_lines: ["answer"],
    }),
    makeEvent(EVENTS.THINKING_DELTA, { text: "reason" }),
    makeEvent(EVENTS.BUDGET_WARNING, { level: "warn", spent: 8, cap: 10 }),
    makeEvent(EVENTS.COMMAND_OUTPUT, {
      command: "/model",
      text: "model-x",
      ansi_lines: ["model-x"],
    }),
    makeEvent(EVENTS.WORKSPACE_REVEALED, {
      path: "/x",
      ok: false,
      available: false,
    }),
    makeEvent(EVENTS.DEBUG_LINE, { line: "debug-visible" }),
  ]);
  assert.equal(state.employee.name, "鲸");
  assert.equal(state.commands[0].name, "/model");
  assert.equal(state.tools.called.status, "blocked");
  assert.equal(state.answer, "answer");
  assert.deepEqual(state.renderedAnswer.ansiLines, ["answer"]);
  assert.equal(state.thinking, "reason");
  assert.equal(state.budgetWarning.spent, 8);
  assert.equal(state.commandOutput.text, "model-x");
  assert.ok(state.timeline.some(line => line.label.includes("无法打开")));
  assert.ok(state.debug.includes("debug-visible"));
}

console.log("tui-app-state tests passed");
