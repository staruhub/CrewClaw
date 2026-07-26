import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await pause(10);
  }
  assert.fail(message);
}

test("JSONL TUI shows plan approval, live todo progress, and ask_user PendingActions", async () => {
  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) events.push(JSON.parse(line));
      }
      callback();
    },
  });
  const root = mkdtempSync(join(tmpdir(), "crewclaw-orchestration-jsonl-"));
  const done = startJsonlBridge({
    root,
    input,
    output,
    meta: { mode: "Chat", agentId: "planner" },
    agentLoop: async options => {
      const todos = [
        { content: "收集输入", status: "pending" },
        { content: "执行处理", status: "pending" },
        { content: "验证结果", status: "pending" },
      ];
      options.onTodoUpdated({ phase: "proposed", todos });
      const approved = await options.confirm("审批三步计划", {
        tool: "todo_write",
        kind: "plan_approval",
        scope: "task_plan",
      });
      assert.equal(approved, true);
      options.onTodoUpdated({ phase: "approved", todos });
      options.onTodoUpdated({
        phase: "updated",
        todos: [
          { content: "收集输入", status: "completed" },
          { content: "执行处理", status: "in_progress" },
          { content: "验证结果", status: "pending" },
        ],
      });
      const answer = await options.askUser({
        question: "选择输出风格",
        options: ["简洁", "详细"],
      });
      options.onTodoUpdated({
        phase: "updated",
        todos: todos.map(todo => ({ ...todo, status: "completed" })),
      });
      options.onDelta(`已选择${answer}`);
      return `已选择${answer}`;
    },
  });

  try {
    input.push("请完成一个三步任务并让我选择输出风格\n");
    const approval = await waitFor(
      () => events.find(event => event.type === "approval.required"),
      "plan approval did not appear"
    );
    assert.ok(events.some(event => event.type === "plan.created"));
    input.push(
      `${JSON.stringify({
        type: "approval.resolve",
        data: { id: approval.data.id, decision: "accept" },
      })}\n`
    );

    const question = await waitFor(
      () =>
        events.find(
          event =>
            event.type === "pending.actions" &&
            event.data.question === "选择输出风格"
        ),
      "ask_user options did not appear"
    );
    assert.deepEqual(
      question.data.actions.map(action => action.label),
      ["简洁", "详细", "其他（直接输入）"]
    );
    input.push(
      `${JSON.stringify({
        type: "pending.run",
        data: { key: "2", label: "详细" },
      })}\n`
    );
    await waitFor(
      () => events.some(event => event.type === "task.completed"),
      "orchestrated task did not complete"
    );
    assert.ok(events.some(event => event.type === "plan.approved"));
    assert.ok(
      events.filter(event => event.type === "todo.updated").length >= 3
    );
    assert.ok(events.some(event => event.type === "step.started"));
    assert.ok(events.some(event => event.type === "step.completed"));
    assert.ok(
      events.some(
        event =>
          event.type === "assistant.rendered" &&
          /已选择详细/.test(event.data.text)
      )
    );
  } finally {
    input.push("/exit\n");
    await done;
    rmSync(root, { recursive: true, force: true });
  }
});

test("closing JSONL input releases a pending ask_user without hanging", async () => {
  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) events.push(JSON.parse(line));
      }
      callback();
    },
  });
  const root = mkdtempSync(join(tmpdir(), "crewclaw-question-close-"));
  const done = startJsonlBridge({
    root,
    input,
    output,
    meta: { mode: "Chat", agentId: "planner" },
    agentLoop: async options => {
      await options.askUser({
        question: "关闭前请选择",
        options: ["继续", "停止"],
      });
      return "不应在关闭后形成完成终态";
    },
  });

  try {
    input.push("开始待答任务\n");
    await waitFor(
      () =>
        events.some(
          event =>
            event.type === "pending.actions" &&
            event.data.question === "关闭前请选择"
        ),
      "ask_user did not become pending"
    );
    input.push(null);
    await Promise.race([
      done,
      pause(1500).then(() =>
        assert.fail("bridge hung on pending ask_user EOF")
      ),
    ]);
    assert.ok(events.some(event => event.type === "generation.cancelled"));
    assert.ok(
      events.some(
        event =>
          event.type === "task.blocked" &&
          event.data.status === "question_interrupted"
      )
    );
    assert.ok(
      events.some(
        event =>
          event.type === "pending.actions" &&
          Array.isArray(event.data.actions) &&
          event.data.actions.length === 0
      )
    );
    assert.equal(
      events.some(event => event.type === "task.completed"),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
