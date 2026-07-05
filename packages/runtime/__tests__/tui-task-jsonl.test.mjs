import test from "node:test";
import assert from "node:assert/strict";
import {
  createTaskJsonlEmitter,
  createTaskModeSink,
  parseUserActionLine,
  applyUserAction,
} from "../tui/task-jsonl.mjs";

test("emits clean TaskEvent JSONL for formal task runs", () => {
    const lines = [];
    const output = { write: (line) => lines.push(line) };
    const emit = createTaskJsonlEmitter({ output, now: () => 42 });
    const sink = createTaskModeSink({ emit });

    sink.sessionReady({ name: "AI 落地鲸", role: "顾问", mode: "Task", model: "demo" });
    sink.taskStarted({ id: "roi-demo", title: "ROI 示例" });
    sink.planCreated({ id: "plan1", steps: ["检查工具", "生成报告"] });
    sink.toolPreflightChecked({ id: "search", tool: "web_search", status: "blocked", reason: "missing key" });
    sink.onDelta("报告草稿");
    sink.onInvocation({ toolName: "artifact.write", action: "写入报告", status: "success" });
    sink.artifactCreated({ id: "art1", name: "roi_report.md", path: ".crewclaw/artifacts/roi_report.md", status: "ready" });
    sink.outcomeChecked({ passed: true, artifactId: "art1" });
    sink.taskCompleted({ id: "roi-demo" });

    const events = lines.map((line) => JSON.parse(line));

    assert.equal(lines.every((line) => line.endsWith("\n")), true);
    assert.equal(lines.join("").includes("\u001b["), false);
    assert.deepEqual(events.map((event) => event.type), [
      "session.ready",
      "task.started",
      "plan.created",
      "tool.preflight_checked",
      "token.delta",
      "tool.requested",
      "tool.succeeded",
      "artifact.created",
      "outcome.checked",
      "task.completed",
    ]);
    assert.equal(events[0].ts, 42);
    assert.deepEqual(events[0].data.employee, {
      name: "AI 落地鲸",
      role: "顾问",
      mode: "Task",
      model: "demo",
    });
    assert.equal(events[6].data.id, "tool1");
    assert.equal(events[6].data.summary, "写入报告");
    assert.equal(events[7].data.id, "art1");
    assert.equal(events[7].data.name, "roi_report.md");
    assert.equal(events[7].data.status, "ready");
  });

test("parses structured UserAction lines and preserves plain text fallback", () => {
    assert.deepEqual(parseUserActionLine("hello task"), {
      type: "user.message",
      data: { text: "hello task", refs: [] },
    });
    assert.deepEqual(parseUserActionLine('{"type":"pending.run","data":{"key":"1","command":"run_roi_demo"}}'), {
      type: "pending.run",
      data: { key: "1", command: "run_roi_demo" },
    });
    assert.throws(() => parseUserActionLine('{"type":"artifact.delete"}'), /data/);
  });

test("applies artifact UserAction commands as TaskEvents", () => {
    const lines = [];
    const output = { write: (line) => lines.push(line) };
    const emit = createTaskJsonlEmitter({ output, now: () => 42 });

    applyUserAction(
      parseUserActionLine('{"type":"artifact.delete","data":{"artifact_id":"art1"}}'),
      { emit },
    );
    applyUserAction(
      parseUserActionLine('{"type":"artifact.reveal","data":{"artifact_id":"art1"}}'),
      { emit },
    );
    applyUserAction(
      parseUserActionLine('{"type":"approval.resolve","data":{"id":"ap1","decision":"accept"}}'),
      { emit },
    );

    assert.deepEqual(lines.map((line) => JSON.parse(line)), [
      { type: "artifact.deleted", ts: 42, data: { artifact_id: "art1" } },
      { type: "artifact.revealed", ts: 42, data: { artifact_id: "art1", ok: true } },
      { type: "approval.accepted", ts: 42, data: { id: "ap1", decision: "accept" } },
    ]);
  });
