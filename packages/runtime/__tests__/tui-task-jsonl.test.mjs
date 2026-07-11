import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskJsonlEmitter,
  createTaskModeSink,
  parseUserActionLine,
  applyUserAction,
} from "../tui/task-jsonl.mjs";

test("emits clean TaskEvent JSONL for formal task runs", () => {
  const lines = [];
  const output = { write: line => lines.push(line) };
  const emit = createTaskJsonlEmitter({ output, now: () => 42 });
  const sink = createTaskModeSink({ emit });

  sink.sessionReady({
    name: "AI 落地鲸",
    role: "顾问",
    mode: "Task",
    model: "demo",
  });
  sink.taskStarted({ id: "roi-demo", title: "ROI 示例" });
  sink.planCreated({ id: "plan1", steps: ["检查工具", "生成报告"] });
  sink.toolPreflightChecked({
    id: "search",
    tool: "web_search",
    status: "blocked",
    reason: "missing key",
  });
  sink.onDelta("报告草稿");
  sink.onInvocation({
    toolName: "artifact.write",
    action: "写入报告",
    status: "success",
  });
  sink.artifactCreated({
    id: "art1",
    name: "roi_report.md",
    path: ".crewclaw/artifacts/roi_report.md",
    status: "ready",
  });
  sink.outcomeChecked({ passed: true, artifactId: "art1" });
  sink.taskCompleted({ id: "roi-demo" });

  const events = lines.map(line => JSON.parse(line));

  assert.equal(
    lines.every(line => line.endsWith("\n")),
    true
  );
  assert.equal(lines.join("").includes("\u001b["), false);
  assert.equal(
    events.every(event => event.protocol_version === 1),
    true
  );
  assert.deepEqual(
    events.map(event => event.type),
    [
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
    ]
  );
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
  assert.equal(events[7].data.taskRunId, "roi-demo");
  assert.equal(events[7].data.name, "roi_report.md");
  assert.equal(events[7].data.status, "ready");
  assert.equal(events[8].data.id, "roi-demo");
  assert.equal(events[8].data.taskRunId, "roi-demo");
  assert.equal(events[9].data.id, "roi-demo");
  assert.equal(events[9].data.taskRunId, "roi-demo");
  assert.deepEqual(events[3].data, {
    id: "search",
    tool: "web_search",
    ok: false,
    label: "web_search",
    detail: "missing key",
    status: "blocked",
    reason: "missing key",
  });
});

test("parses structured UserAction lines and preserves plain text fallback", () => {
  assert.deepEqual(parseUserActionLine("hello task"), {
    type: "user.message",
    data: { text: "hello task", refs: [] },
  });
  assert.deepEqual(
    parseUserActionLine(
      '{"type":"pending.run","data":{"key":"1","command":"run_roi_demo"}}'
    ),
    {
      type: "pending.run",
      data: { key: "1", command: "run_roi_demo" },
    }
  );
  assert.throws(
    () => parseUserActionLine('{"type":"artifact.delete"}'),
    /data/
  );
});

test("applies artifact UserAction commands as TaskEvents", () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-artifact-actions-"));
  const artifactDir = join(root, ".crewclaw", "artifacts", "task1");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "report.md");
  writeFileSync(artifactPath, "# report\nnon-empty\n");
  const record = {
    id: "art1",
    artifact_id: "art1",
    taskRunId: "task1",
    path: artifactPath,
  };
  const lines = [];
  const output = { write: line => lines.push(line) };
  const emit = createTaskJsonlEmitter({ output, now: () => 42 });

  applyUserAction(
    parseUserActionLine(
      '{"type":"artifact.preview","data":{"artifact_id":"art1"}}'
    ),
    { emit, root, resolveArtifact: () => record }
  );
  applyUserAction(
    parseUserActionLine(
      '{"type":"artifact.export","data":{"artifact_id":"art1"}}'
    ),
    { emit, root, resolveArtifact: () => record }
  );
  applyUserAction(
    parseUserActionLine(
      '{"type":"artifact.reveal","data":{"artifact_id":"art1"}}'
    ),
    {
      emit,
      root,
      resolveArtifact: () => record,
      executeReveal: () => ({ ok: true }),
    }
  );
  applyUserAction(
    parseUserActionLine(
      '{"type":"artifact.delete","data":{"artifact_id":"art1"}}'
    ),
    { emit, root, resolveArtifact: () => record }
  );
  // v0.18 P0-b：approval.resolve（工具授权）不再产生任何事件——approval.accepted 的语义是
  // "交付物验收"（前端计入 KPI），工具授权只该由桥侧发 approval.resolved。此处断言零事件，
  // 只返回判定结果给调用方。
  const resolved = applyUserAction(
    parseUserActionLine(
      '{"type":"approval.resolve","data":{"id":"ap1","decision":"accept"}}'
    ),
    { emit }
  );
  assert.deepEqual(resolved, {
    handled: true,
    approval: true,
    decision: "accept",
  });

  const events = lines.map(line => JSON.parse(line));
  assert.deepEqual(
    events.map(event => event.type),
    [
      "artifact.selected",
      "artifact.exported",
      "artifact.revealed",
      "artifact.deleted",
    ]
  );
  assert.ok(
    events.every(
      event => event.data.id === "art1" && event.data.artifact_id === "art1"
    )
  );
  assert.ok(
    events.every(
      event => event.data.taskRunId === "task1" && event.data.ok === true
    )
  );
  assert.equal(events[0].data.available, true);
  assert.equal(events[1].data.available, true);
  assert.equal(
    existsSync(events[1].data.path),
    true,
    "export copies a real file"
  );
  assert.equal(events[2].data.available, true);
  assert.equal(
    existsSync(artifactPath),
    false,
    "delete removes the real artifact file"
  );
  rmSync(root, { recursive: true, force: true });
});

test("artifact actions reject paths outside the workspace artifact namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-artifact-boundary-"));
  const outside = mkdtempSync(join(tmpdir(), "crewclaw-artifact-outside-"));
  const outsidePath = join(outside, "report.md");
  writeFileSync(outsidePath, "# outside\n");
  const record = { artifact_id: "outside", path: outsidePath };
  const events = [];
  let revealCalls = 0;

  for (const type of [
    "artifact.preview",
    "artifact.reveal",
    "artifact.export",
    "artifact.delete",
  ]) {
    const result = applyUserAction(
      { type, data: { artifact_id: "outside" } },
      {
        root,
        resolveArtifact: () => record,
        emit: (eventType, data) => events.push({ type: eventType, data }),
        executeReveal: () => {
          revealCalls += 1;
          return { ok: true };
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "artifact_outside_workspace");
  }

  assert.equal(revealCalls, 0, "an external file is never handed to the OS");
  assert.equal(
    existsSync(outsidePath),
    true,
    "an external file is not deleted"
  );
  assert.equal(
    existsSync(join(root, ".crewclaw", "exports")),
    false,
    "an external file is not copied into exports"
  );
  assert.equal(
    events.every(event => event.data.ok === false),
    true
  );
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("artifact actions reject an artifacts-root junction", () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-artifact-junction-"));
  const outside = mkdtempSync(join(tmpdir(), "crewclaw-artifact-target-"));
  const artifactRoot = join(root, ".crewclaw", "artifacts");
  mkdirSync(join(root, ".crewclaw"), { recursive: true });
  const outsidePath = join(outside, "report.md");
  writeFileSync(outsidePath, "# junction target\n");
  symlinkSync(outside, artifactRoot, "junction");
  const record = {
    artifact_id: "junction",
    path: join(artifactRoot, "report.md"),
  };
  let revealCalls = 0;

  for (const type of [
    "artifact.preview",
    "artifact.reveal",
    "artifact.export",
    "artifact.delete",
  ]) {
    const result = applyUserAction(
      { type, data: { artifact_id: "junction" } },
      {
        root,
        resolveArtifact: () => record,
        executeReveal: () => {
          revealCalls += 1;
          return { ok: true };
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "artifact_link_component");
  }

  assert.equal(revealCalls, 0);
  assert.equal(readFileSync(outsidePath, "utf8"), "# junction target\n");
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("artifact actions reject a hardlinked artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-artifact-hardlink-"));
  const artifactDir = join(root, ".crewclaw", "artifacts", "task1");
  mkdirSync(artifactDir, { recursive: true });
  const outsidePath = join(root, "outside.md");
  const artifactPath = join(artifactDir, "report.md");
  writeFileSync(outsidePath, "# linked bytes\n");
  linkSync(outsidePath, artifactPath);
  const record = { artifact_id: "hardlink", path: artifactPath };
  let revealCalls = 0;

  for (const type of [
    "artifact.preview",
    "artifact.reveal",
    "artifact.export",
    "artifact.delete",
  ]) {
    const result = applyUserAction(
      { type, data: { artifact_id: "hardlink" } },
      {
        root,
        resolveArtifact: () => record,
        executeReveal: () => {
          revealCalls += 1;
          return { ok: true };
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "artifact_link_component");
  }

  assert.equal(revealCalls, 0);
  assert.equal(readFileSync(outsidePath, "utf8"), "# linked bytes\n");
  rmSync(root, { recursive: true, force: true });
});

test("artifact export rejects a junction or hardlink at the export destination", () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-export-boundary-"));
  const outside = mkdtempSync(join(tmpdir(), "crewclaw-export-target-"));
  const artifactDir = join(root, ".crewclaw", "artifacts", "task1");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "report.md");
  writeFileSync(artifactPath, "# safe source\n");
  const record = { artifact_id: "art1", path: artifactPath };
  const exportRoot = join(root, ".crewclaw", "exports");
  symlinkSync(outside, exportRoot, "junction");

  let result = applyUserAction(
    { type: "artifact.export", data: { artifact_id: "art1" } },
    { root, resolveArtifact: () => record }
  );
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(outside, "art1-report.md")), false);

  rmSync(exportRoot);
  mkdirSync(exportRoot);
  const outsidePath = join(root, "outside-export.md");
  const destination = join(exportRoot, "art1-report.md");
  writeFileSync(outsidePath, "do not replace\n");
  linkSync(outsidePath, destination);
  result = applyUserAction(
    { type: "artifact.export", data: { artifact_id: "art1" } },
    { root, resolveArtifact: () => record }
  );
  assert.equal(result.ok, false);
  assert.equal(readFileSync(outsidePath, "utf8"), "do not replace\n");

  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("artifact actions fail honestly when the artifact cannot be resolved", () => {
  const lines = [];
  const emit = createTaskJsonlEmitter({
    output: { write: line => lines.push(line) },
    now: () => 42,
  });
  const result = applyUserAction(
    parseUserActionLine(
      '{"type":"artifact.reveal","data":{"artifact_id":"missing"}}'
    ),
    { emit, resolveArtifact: () => null }
  );
  assert.equal(result.ok, false);
  const event = JSON.parse(lines[0]);
  assert.equal(event.type, "artifact.revealed");
  assert.equal(event.data.ok, false);
  assert.equal(event.data.available, false);
  assert.equal(event.data.code, "artifact_not_found");
});

test("malformed artifact actions are contained instead of throwing", () => {
  const lines = [];
  const emit = createTaskJsonlEmitter({
    output: { write: line => lines.push(line) },
    now: () => 42,
  });
  const result = applyUserAction(
    { type: "artifact.delete", data: {} },
    { emit }
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(lines[0]).type, "debug.line");
});
