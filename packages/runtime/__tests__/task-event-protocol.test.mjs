import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  EVENTS,
  TASK_EVENT_PROTOCOL_VERSION,
  isTaskEvent,
  makeEvent,
  validateTaskEvent,
  validateTaskEventPayload,
} from "../tui/protocol.mjs";
import {
  initialAppState,
  reduce as reduceAppState,
} from "../tui/app-state.mjs";

test("TaskEvent v1 envelope is explicit and payload remains namespaced", () => {
  assert.equal(TASK_EVENT_PROTOCOL_VERSION, 1);
  assert.deepEqual(makeEvent(EVENTS.TASK_STARTED, { id: "task-1" }, 42), {
    protocol_version: 1,
    type: "task.started",
    ts: 42,
    data: { id: "task-1" },
  });
});

test("Node event registry contains the cross-runtime lifecycle events", () => {
  const mirrored = [
    EVENTS.SESSION_READY,
    EVENTS.TOOL_CALLED,
    EVENTS.TOOL_BLOCKED,
    EVENTS.ARTIFACT_EXPORTED,
    EVENTS.TASK_FAILED,
    EVENTS.TASK_REVISION_NEEDED,
  ];

  assert.deepEqual(mirrored, [
    "session.ready",
    "tool.called",
    "tool.blocked",
    "artifact.exported",
    "task.failed",
    "task.revision_needed",
  ]);
  assert.equal(mirrored.every(isTaskEvent), true);
  assert.equal(
    new Set(Object.values(EVENTS)).size,
    Object.values(EVENTS).length,
    "event names must be unique"
  );
});

test("dream/v1 freezes the memory and executable growth lifecycle events", () => {
  const dreamEvents = Object.values(EVENTS).filter(type =>
    type.startsWith("dream.")
  );
  assert.deepEqual(dreamEvents.sort(), [
    "dream.activated",
    "dream.approved",
    "dream.blocked",
    "dream.candidate_ready",
    "dream.morning_report",
    "dream.next_cycle_recommended",
    "dream.next_task_approved",
    "dream.next_task_delivery_ready",
    "dream.next_task_evaluated",
    "dream.next_task_learned",
    "dream.next_task_queued",
    "dream.next_task_ready",
    "dream.next_task_settled",
    "dream.next_task_started",
    "dream.recommended",
    "dream.rejected",
    "dream.revision_task_created",
    "dream.rolled_back",
    "dream.started",
    "dream.validation_failed",
  ]);
});

test("critical payload validators enforce canonical correlation fields", () => {
  const valid = [
    [EVENTS.TASK_STARTED, { id: "task-1" }],
    [EVENTS.TASK_MODE_CHANGED, { taskRunId: "task-1", mode: "Task" }],
    [EVENTS.TASK_UPGRADED_FROM_CHAT, { taskRunId: "task-1" }],
    [EVENTS.TASK_COMPLETED, { id: "task-1" }],
    [EVENTS.TASK_FAILED, { taskRunId: "task-1", reason: "runtime crashed" }],
    [
      EVENTS.OUTCOME_CHECKED,
      { taskRunId: "task-1", valid: true, deliverable: "/x/report.md" },
    ],
    [
      EVENTS.ARTIFACT_CREATED,
      { id: "artifact-1", taskRunId: "task-1", path: "/x/report.md" },
    ],
    [
      EVENTS.ARTIFACT_EXPORTED,
      {
        artifact_id: "artifact-1",
        taskRunId: "task-1",
        ok: true,
        path: "/exports/report.md",
      },
    ],
    [
      EVENTS.ARTIFACT_EXPORTED,
      { artifact_id: "artifact-1", taskRunId: "task-1", ok: false },
    ],
    [
      EVENTS.APPROVAL_REQUESTED,
      { id: "approval-1", taskRunId: "task-1", kind: "deliverable_acceptance" },
    ],
    [
      EVENTS.APPROVAL_RESOLVED,
      {
        id: "approval-2",
        taskRunId: "task-1",
        kind: "tool_authorization",
        decision: "allow",
      },
    ],
    [
      EVENTS.PROTOCOL_READY,
      {
        protocol: "crewclaw.task-event/v1",
        event_families: ["core/v1", "dream/v1"],
      },
    ],
    [EVENTS.DREAM_RECOMMENDED, { dream_id: "dream-1", employee_id: "whale" }],
    [
      EVENTS.DREAM_MORNING_REPORT,
      { dream_id: "dream-1", employee_id: "whale" },
    ],
  ];
  for (const [type, data] of valid) {
    assert.deepEqual(
      validateTaskEventPayload(type, data),
      { ok: true, errors: [] },
      type
    );
  }

  assert.equal(validateTaskEventPayload(EVENTS.TASK_COMPLETED, {}).ok, false);
  assert.equal(
    validateTaskEventPayload(EVENTS.TASK_COMPLETED, {
      id: "task-1",
      taskRunId: "task-2",
    }).ok,
    false,
    "terminal id and canonical taskRunId cannot contradict each other"
  );
  assert.equal(
    validateTaskEventPayload(EVENTS.OUTCOME_CHECKED, {
      taskRunId: "task-1",
      valid: true,
    }).ok,
    false,
    "a passing outcome must identify the real deliverable"
  );
  assert.equal(
    validateTaskEventPayload(EVENTS.APPROVAL_ACCEPTED, {
      id: "approval-1",
      taskRunId: "task-1",
      kind: "tool_authorization",
    }).ok,
    false,
    "deliverable acceptance cannot masquerade as tool authorization"
  );
});

test("tool presentation fields are additive, typed, and legacy-compatible", () => {
  assert.deepEqual(
    validateTaskEventPayload(EVENTS.TOOL_SUCCEEDED, {
      id: "tool-1",
      tool: "read_file",
      name: "read_file",
      args_summary: "api/boot.ts",
      result_summary: "123 行",
      truncated: false,
    }),
    { ok: true, errors: [] }
  );
  assert.deepEqual(
    validateTaskEventPayload(EVENTS.TOOL_SUCCEEDED, {
      id: "tool-legacy",
      tool: "read_file",
      summary: "done",
    }),
    { ok: true, errors: [] },
    "v1 producers may omit the additive presentation fields"
  );
  assert.equal(
    validateTaskEventPayload(EVENTS.TOOL_SUCCEEDED, {
      id: "tool-invalid",
      tool: "read_file",
      result_summary: { lines: 123 },
    }).ok,
    false
  );
  assert.equal(
    validateTaskEventPayload(EVENTS.TOOL_SUCCEEDED, {
      id: "tool-invalid-debug",
      tool: "read_file",
      debug_ref: "",
    }).ok,
    false
  );
});

test("Node and Rust share strict TaskEvent envelope vectors", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const vectors = JSON.parse(
    readFileSync(
      resolve(here, "fixtures/task-event-envelope-v1-vectors.json"),
      "utf8"
    )
  );
  for (const vector of vectors) {
    assert.equal(validateTaskEvent(vector.event).ok, vector.valid, vector.name);
  }
});

test("same-version unknown events remain additive while future envelopes fail closed", () => {
  assert.deepEqual(
    validateTaskEvent({
      protocol_version: 1,
      type: "future.additive_event",
      ts: 1,
      data: { value: 1 },
    }),
    { ok: true, known: false, errors: [] }
  );
  const future = validateTaskEvent({
    protocol_version: 2,
    type: EVENTS.TASK_STARTED,
    ts: 1,
    data: { id: "task-1" },
  });
  assert.equal(future.ok, false);
  assert.ok(future.errors.some(error => error.includes("protocol_version")));
});

test("the complete Node event registry stays mirrored by Rust", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const rustProtocol = readFileSync(
    resolve(here, "../../../crates/crewclaw-cli/src/workbench/protocol.rs"),
    "utf8"
  );
  const enumStart = rustProtocol.indexOf("pub enum TaskEvent");
  const enumEnd = rustProtocol.indexOf("pub struct ResolvedReference");
  assert.ok(
    enumStart >= 0 && enumEnd > enumStart,
    "could not locate Rust TaskEvent enum"
  );
  const rustEventEnum = rustProtocol.slice(enumStart, enumEnd);
  const rustEvents = [
    ...rustEventEnum.matchAll(/#\[serde\(rename = "([^"]+)"\)\]/g),
  ]
    .map(match => match[1])
    .sort();
  const nodeEvents = Object.values(EVENTS).sort();

  assert.deepEqual(
    rustEvents,
    nodeEvents,
    "Node and Rust event names must be an exact mirror"
  );
  for (const eventType of nodeEvents) {
    assert.match(
      rustProtocol,
      new RegExp(`serde\\(rename = "${eventType.replace(".", "\\.")}"\\)`)
    );
    assert.match(
      rustProtocol,
      new RegExp(`"${eventType.replace(".", "\\.")}" =>`)
    );
    assert.ok(
      rustProtocol.includes(`=> "${eventType}"`),
      `${eventType} missing from event_type()`
    );
  }
});

test("the Node reference reducer gives every known event an explicit case", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const reducer = readFileSync(resolve(here, "../tui/app-state.mjs"), "utf8");
  const handled = new Set(
    [...reducer.matchAll(/case EVENTS\.([A-Z_]+):/g)].map(match => match[1])
  );
  assert.deepEqual(
    Object.keys(EVENTS).filter(name => !handled.has(name)),
    [],
    "known protocol events must never disappear through the reducer default"
  );
});

test("the shared golden JSONL reduces to the cross-runtime semantic snapshot", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtureDir = resolve(here, "fixtures");
  const events = readFileSync(
    resolve(fixtureDir, "task-events-v1.jsonl"),
    "utf8"
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const expected = JSON.parse(
    readFileSync(resolve(fixtureDir, "task-events-v1.expected.json"), "utf8")
  );
  const state = events.reduce(reduceAppState, initialAppState());
  const artifact = state.artifacts.find(
    candidate => candidate.id === "artifact-golden"
  );
  const snapshot = {
    mode: state.mode,
    task: { id: state.task?.id, status: state.task?.status },
    status: state.status,
    artifact: {
      id: artifact?.id,
      task_id: artifact?.taskId,
      status: artifact?.status,
      path: artifact?.path,
    },
    proof: {
      valid: state.proof?.valid,
      deliverable: state.proof?.deliverable,
    },
    approval: state.approval,
    accepted_count: state.acceptedCount,
  };
  assert.deepEqual(snapshot, expected);
});
