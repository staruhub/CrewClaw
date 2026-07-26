// e2e-tui-flow.test.mjs — end-to-end regression at the JSONL-bridge layer (the TUI's engine).
//
// The Rust/Ratatui front-end can't be Playwright-driven, so the real TUI end-to-end is exercised
// here: spawn the engine (startJsonlBridge) with injected input/output streams, feed user lines,
// and assert the emitted TaskEvent JSONL — exactly the wire the front-end reduces into AppState.
//
// These cases lock in the confirmed-bug regressions recently fixed in jsonl-bridge.mjs / route.mjs
// (see e2e/E2E-CASES-v09.md — ids E2E-01, E2E-02, E2E-03). Each was a real "green but wrong" bug:
//   • attachment-only message was silently dropped (empty text + image part → nothing ran)
//   • a preflight-blocked task still emitted task.completed (blocked overwritten to done)
//   • a plain chat turn emitted "缺少交付物"/needs_artifact (No-Artifact-No-Done applied to chat)
//
// Plain-script harness (import 'node:assert/strict', assert + throw, print "…passed") so the
// run-all.mjs *.test.mjs runner picks it up. CREW_MOCK=1 keeps the model turn key-free.

import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { readKpi } from "../kpi.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build a fresh, isolated bridge with captured output. `reply` is what the model turn returns
// (buildRunTurn calls agentLoop); short reply = plain chat, long/structured = a deliverable.
function makeBridge({ reply = "好的,我在。", mode = "Chat" } = {}) {
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
  const agentLoop = async () => reply;
  const done = startJsonlBridge({
    agentLoop,
    meta: { mode },
    input,
    output,
    root: os.tmpdir(),
  });
  return {
    input,
    events,
    done,
    types: () => events.map(e => e.type),
    send: obj =>
      input.push((typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n"),
    exit: async () => {
      input.push("/exit\n");
      await sleep(20);
      await done;
    },
  };
}

// index of the first event of `type` at or after position `from`; -1 if none.
const idxOf = (events, type, from = 0) => {
  for (let i = from; i < events.length; i++)
    if (events[i].type === type) return i;
  return -1;
};

// ── E2E-01: attachment-only message is NOT silently dropped ─────────────────────────────────
// Empty text + an image part is a legit look-at-the-image turn. The bug: `if (!text) return`
// dropped it before task.started, so nothing ran. Fix: only drop when BOTH text and parts empty.
async function attachmentOnlyRuns() {
  const b = makeBridge({ reply: "这张图里是一只鲸鱼。" });
  await sleep(20);
  // structured user.message with an image part and NO text — as the front-end sends an attachment.
  b.send({
    type: "user.message",
    data: {
      text: "",
      refs: [],
      parts: [{ type: "image", mime: "image/png", data: "iVBORw0KGgo=" }],
    },
  });
  await sleep(120);

  const t = b.types();
  assert.ok(
    t.includes("task.started"),
    `attachment-only turn must run (task.started); got ${t.join(",")}`
  );
  // it actually reached the model and completed — the turn was not a no-op.
  assert.ok(
    t.includes("task.completed"),
    "attachment-only turn settles to task.completed"
  );
  const started = b.events.find(e => e.type === "task.started");
  assert.equal(
    started.data.title,
    "（附件消息）",
    "empty-text turn gets the attachment placeholder title"
  );
  await b.exit();
  console.log("  ✓ E2E-01 attachment-only message runs (not dropped)");
}

// ── E2E-02: preflight-blocked task emits task.blocked and NO task.completed follows ─────────
// A research task needing the live web with only the ddg scrape backend must block honestly.
// The bug: bridge emitted task.completed after the block, so the reducer overwrote blocked→done.
async function blockedNoCompleted() {
  const b = makeBridge({ reply: "（不该跑到这里）" });
  await sleep(20);
  b.send("给我一份最新大模型发布的研究报告"); // employee_task + needsSearch, backend=ddg ⇒ block
  await sleep(120);

  const t = b.types();
  const blockedIdx = idxOf(b.events, "task.blocked");
  assert.ok(
    blockedIdx >= 0,
    `preflight-blocked task must emit task.blocked; got ${t.join(",")}`
  );
  // the terminal state is blocked — no task.completed anywhere in this turn.
  assert.equal(
    idxOf(b.events, "task.completed"),
    -1,
    "blocked task must NOT emit task.completed"
  );
  // and it surfaced the missing provider as tool truth, not a hallucinated answer.
  assert.ok(
    t.includes("tool.preflight_checked"),
    "block is backed by a preflight tool-truth event"
  );
  assert.equal(
    b.events[blockedIdx].data.est_cost,
    0,
    "a pre-model search block carries exact zero-cost evidence"
  );
  await b.exit();
  console.log("  ✓ E2E-02 preflight-blocked: task.blocked, no task.completed");
}

// ── E2E-03: plain chat turn settles to idle with NO 缺少交付物 / needs_artifact ──────────────
// No-Artifact-No-Done is a TASK rule; a chat turn owes no file. The bug: persistDeliverable ran
// on chat and emitted outcome.checked{valid:false, gaps:[no_artifact]} + the 缺少交付物 warning.
async function chatNoNeedsArtifact() {
  const b = makeBridge({ reply: "你好!今天状态不错,随时可以派活。" });
  await sleep(20);
  b.send("你好"); // employee_chat (light social greeting) — plain chat, not a task
  await sleep(120);

  const t = b.types();
  assert.ok(
    t.includes("task.completed"),
    `chat turn settles to task.completed; got ${t.join(",")}`
  );
  // NO needs-artifact signal of any shape:
  assert.equal(idxOf(b.events, "task.blocked"), -1, "chat turn is not blocked");
  const outcomes = b.events.filter(e => e.type === "outcome.checked");
  assert.ok(
    !outcomes.some(e => e.data && e.data.valid === false),
    "chat turn must NOT emit outcome.checked{valid:false}"
  );
  const anyNeedsArtifact = b.events.some(
    e =>
      JSON.stringify(e.data || {}).includes("no_artifact") ||
      JSON.stringify(e.data || {}).includes("缺少交付物")
  );
  assert.equal(
    anyNeedsArtifact,
    false,
    "chat turn must NOT surface 缺少交付物 / no_artifact"
  );
  await b.exit();
  console.log("  ✓ E2E-03 plain chat: idle, no needs_artifact");
}

// ── E2E-04 (bonus): deliverable-with-attachment still upgrades to a TaskRun ─────────────────
// A deliverable request that also carries an image must keep its employee_task class (upgrade +
// persist), NOT be downgraded to chat by the attachment path. Only ambiguous/out_of_scope
// attachment turns get forced to chat.
async function deliverableWithAttachmentUpgrades() {
  const longReport =
    "# 图像分析报告\n\n## 结论\n" +
    "该图显示服务器负载偏高,建议扩容。\n".repeat(12);
  const b = makeBridge({ reply: longReport });
  await sleep(20);
  b.send({
    type: "user.message",
    data: {
      text: "帮我把这张图整理成一份分析报告",
      refs: [],
      parts: [{ type: "image", mime: "image/png", data: "iVBORw0KGgo=" }],
    },
  });
  await sleep(150);

  const t = b.types();
  assert.ok(
    t.includes("task.upgraded_from_chat"),
    `deliverable+attachment must upgrade to TaskRun; got ${t.join(",")}`
  );
  assert.ok(
    t.includes("artifact.created"),
    "the upgraded task persists a real deliverable"
  );
  // it entered Approval (deliverable held for accept), so no premature task.completed.
  assert.ok(
    t.includes("approval.requested"),
    "deliverable enters approval-before-done"
  );
  assert.equal(
    idxOf(b.events, "task.completed"),
    -1,
    "held deliverable does not auto-complete"
  );
  await b.exit();
  console.log("  ✓ E2E-04 deliverable+attachment upgrades to a TaskRun");
}

// ── E2E-05 (bonus): a multi-line paste arrives as ONE message, not N lines ──────────────────
// The front-end folds a paste into a single user.message whose text carries embedded newlines
// (JSON-encoded). The engine must treat it as ONE turn — exactly one task.started — not one per
// physical line. We send it as a single JSONL line with \n inside the JSON string.
async function multilinePasteIsOneMessage() {
  const b = makeBridge({ reply: "收到,这段多行内容我看完了。" });
  await sleep(20);
  // three logical lines, ONE JSONL frame (the newlines live INSIDE the JSON "text" string).
  b.send({
    type: "user.message",
    data: { text: "第一行\n第二行\n第三行", refs: [] },
  });
  await sleep(120);

  const startedCount = b.events.filter(e => e.type === "task.started").length;
  assert.equal(
    startedCount,
    1,
    `multi-line paste must be ONE turn; saw ${startedCount} task.started`
  );
  await b.exit();
  console.log("  ✓ E2E-05 multi-line paste is one message");
}

// ── E2E-06 (v0.11 M4): real model reasoning surfaces as thinking.delta ───────────────────────
// callModel parses delta.reasoning_content → onThinking → agentLoop(quiet) → sink.onThinking →
// the bridge emits thinking.delta. A stubbed agentLoop drives sink.onThinking directly to lock in
// the bridge wiring (the real callModel reasoning-parse is exercised under CREW_MOCK).
async function thinkingSurfacesAsDelta() {
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
  const agentLoop = async ({ onThinking, onDelta }) => {
    onThinking?.("先拆解需求，");
    onThinking?.("再决定检索与产出格式。");
    onDelta?.("这是回答。");
    return "这是回答。";
  };
  const done = startJsonlBridge({
    agentLoop,
    meta: { mode: "Chat" },
    input,
    output,
    root: os.tmpdir(),
  });
  await sleep(20);
  input.push("你好\n"); // employee_chat → runModelTurn → agentLoop (stub drives onThinking)
  await sleep(120);

  const think = events.filter(e => e.type === "thinking.delta");
  assert.ok(
    think.length >= 1,
    "thinking.delta must be emitted when the model reasons"
  );
  const joined = think.map(e => e.data.text).join("");
  assert.ok(
    joined.includes("先拆解需求"),
    `thinking text carried through; got ${joined}`
  );
  assert.ok(
    events.some(e => e.type === "token.delta" && e.data.text.includes("回答")),
    "answer still streams via token.delta (thinking is separate from deliverable prose)"
  );
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log("  ✓ E2E-06 model reasoning surfaces as thinking.delta");
}

// ── E2E-07 (v0.11): quick-utility turns are recorded into history — follow-ups anchor ────────
// The weather-card / light path answers WITHOUT runModelTurn; route.mjs must recordExchange the
// Q&A into shared history so the NEXT model turn sees it ("帮我看看中山的天气" → "那明天呢"
// used to reach the model with empty history — the real user-reported memory hole).
async function quickUtilityRecordsHistory() {
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
  const calls = [];
  // stub agentLoop records the messages array it receives per call.
  const agentLoop = async ({ messages }) => {
    calls.push(
      messages.map(
        m =>
          `${m.role}:${typeof m.content === "string" ? m.content : "[blocks]"}`
      )
    );
    return "接得上：明天带伞。";
  };
  const done = startJsonlBridge({
    agentLoop,
    meta: { mode: "Chat" },
    input,
    output,
    root: os.tmpdir(),
  });
  await sleep(20);
  input.push("几点了\n"); // quick_utility (时间) → light path (no weather card, offline)
  await sleep(150);
  input.push("那明天呢\n"); // follow-up → employee_chat model turn with shared history
  await sleep(150);

  assert.ok(
    calls.length >= 2,
    `two model calls expected (light + follow-up); got ${calls.length}`
  );
  const followUp = calls[calls.length - 1].join(" | ");
  assert.ok(
    followUp.includes("几点了"),
    `follow-up turn must see the quick-utility question; got: ${followUp}`
  );
  assert.ok(
    followUp.includes("那明天呢"),
    "follow-up turn includes the new user message"
  );
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log(
    "  ✓ E2E-07 quick-utility exchange lands in history (follow-ups anchor)"
  );
}

// ── E2E-08 (v0.13 M2): session.ready carries the real skills list + task.completed usage/cost ─
async function sessionReadySkillsAndCompletedUsage() {
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
  const agentLoop = async ({ onUsage, onDelta }) => {
    onUsage?.({ prompt_tokens: 100, completion_tokens: 50 });
    onDelta?.("好的。");
    return "好的。";
  };
  const done = startJsonlBridge({
    agentLoop,
    meta: {
      mode: "Chat",
      skills: ["模型选型", "ROI 评估"],
      agentId: "e2e-skills",
      avatar: ["  o  ", "~^~^~"],
    },
    input,
    output,
    root: os.tmpdir(),
  });
  await sleep(20);

  const ready = events.find(e => e.type === "session.ready");
  assert.ok(ready, "session.ready emitted");
  assert.deepEqual(
    ready.data.employee.skills,
    ["模型选型", "ROI 评估"],
    "employee.skills carried"
  );
  assert.deepEqual(
    ready.data.employee.avatar,
    ["  o  ", "~^~^~"],
    "employee.avatar carried (v0.14 N2)"
  );

  input.push("你好\n");
  await sleep(120);
  const completed = events.find(e => e.type === "task.completed");
  assert.ok(completed, "task.completed emitted");
  assert.equal(completed.data.usage.prompt, 100, "usage.prompt from onUsage");
  assert.equal(
    completed.data.usage.completion,
    50,
    "usage.completion from onUsage"
  );
  assert.ok(
    typeof completed.data.est_cost === "number" && completed.data.est_cost > 0,
    "est_cost is a real number"
  );
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log(
    "  ✓ E2E-08 session.ready skills + task.completed usage/est_cost"
  );
}

// ── E2E-09 (v0.13 M2): a deliverable turn citing URLs emits real evidence.created ────────────
async function deliverableEmitsEvidence() {
  const report =
    "# 模型选型报告\n\n数据来源见 https://volcengine.com/pricing 与 https://openrouter.ai/models 。\n" +
    "## 结论\n".padEnd(30, "…") +
    "国产模型建议首选性价比档位。\n".repeat(10);
  const b = makeBridge({ reply: report });
  await sleep(20);
  b.send("写一份国产模型选型分析报告"); // employee_task deliverable (no needsSearch keyword)
  await sleep(200);

  const ev = b.events.filter(e => e.type === "evidence.created");
  assert.ok(ev.length >= 2, `evidence.created per cited URL; got ${ev.length}`);
  assert.ok(
    ev.some(e => e.data.source === "https://volcengine.com/pricing"),
    "evidence carries the cited source URL"
  );
  assert.ok(
    ev.every(
      e =>
        typeof e.data.source_type === "string" && e.data.source_type.length > 0
    ),
    "evidence carries source_type (categorical truth — no fabricated numeric confidence)"
  );
  assert.ok(
    ev.every(e => e.data.confidence === undefined),
    "no numeric confidence fabricated"
  );
  await b.exit();
  console.log(
    "  ✓ E2E-09 deliverable turn emits real evidence.created (source_type, no fake confidence)"
  );
}

// ── E2E-10 (v0.13 M2): memory.state carries the real item count when a store exists ──────────
async function memoryStateCarriesCount() {
  const { addMemory } = await import("../memory-store.mjs");
  const agentId = `e2e-mem-${process.pid}`;
  const seeded = addMemory(os.tmpdir(), agentId, {
    category: "user_prefs",
    text: "喜欢 md 交付",
  });
  assert.ok(seeded.ok, "seed memory item");

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
    agentLoop: async () => "好",
    meta: { mode: "Chat", agentId },
    input,
    output,
    root: os.tmpdir(),
  });
  await sleep(20);
  input.push("记住 客户偏好 md 交付\n"); // memory_command
  await sleep(120);

  const mem = b_find(events, "memory.state");
  assert.ok(mem, "memory.state emitted");
  assert.ok(
    typeof mem.data.memory.count === "number" && mem.data.memory.count >= 1,
    `memory.state carries real item count; got ${JSON.stringify(mem.data.memory)}`
  );
  input.push("/exit\n");
  await sleep(20);
  await done;
  console.log("  ✓ E2E-10 memory.state carries real store count");
}
const b_find = (events, type) => events.find(e => e.type === type);

// ── E2E-11: QuickUtilityRun is explicitly un-scored and cannot inflate employee task KPI ─────
async function quickUtilityDoesNotInflateKpi() {
  const root = mkdtempSync(join(os.tmpdir(), "crewclaw-quick-kpi-"));
  const agentId = "e2e-quick-kpi";
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
    agentLoop: async ({ onUsage }) => {
      onUsage?.({ prompt_tokens: 5, completion_tokens: 2 });
      return "现在是测试时间。";
    },
    meta: { mode: "Chat", agentId },
    input,
    output,
    root,
  });
  input.push("几点了\n");
  await sleep(150);
  const completed = events.find(event => event.type === "task.completed");
  assert.ok(
    completed?.data?.id && completed.data.id === completed.data.taskRunId,
    "utility terminal remains correlated"
  );
  assert.equal(
    readKpi(root, agentId).tasks,
    0,
    "un-scored quick utility must not increment employee KPI tasks"
  );
  input.push("/exit\n");
  await done;
  rmSync(root, { recursive: true, force: true });
  console.log("  ✓ E2E-11 quick utility remains un-scored in employee KPI");
}

async function main() {
  console.log("e2e-tui-flow: bridge-level end-to-end regressions");
  await attachmentOnlyRuns();
  await blockedNoCompleted();
  await chatNoNeedsArtifact();
  await deliverableWithAttachmentUpgrades();
  await multilinePasteIsOneMessage();
  await thinkingSurfacesAsDelta();
  await quickUtilityRecordsHistory();
  await sessionReadySkillsAndCompletedUsage();
  await deliverableEmitsEvidence();
  await memoryStateCarriesCount();
  await quickUtilityDoesNotInflateKpi();
  console.log("e2e-tui-flow tests passed");
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  }
);
