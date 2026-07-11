import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureArtifactFingerprint } from "../acceptance-transaction.mjs";
import {
  findPendingTaskApproval,
  pendingTaskApprovalPath,
  persistPendingTaskApproval,
  persistTaskApprovalDecision,
  removePendingTaskApproval,
  taskApprovalDecisionPath,
  verifyPendingTaskApprovalBinding,
  verifyPendingTaskArtifact,
} from "../task-approval-store.mjs";
import { MAX_STATE_FILE_BYTES } from "../state-lock.mjs";

function createBoundTask(
  root,
  {
    taskRunId,
    artifactId,
    employeeId = "employee-1",
    requestedTaskId = "demo-1",
    goal = "write a report",
    createdAt = Date.now(),
  }
) {
  const artifacts = join(root, ".crewclaw", "artifacts");
  const runs = join(root, ".crewclaw", "runs");
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(runs, { recursive: true });
  const artifactPath = join(artifacts, `${artifactId}.md`);
  writeFileSync(artifactPath, `# reviewed bytes for ${taskRunId}\n`, "utf8");
  writeFileSync(
    join(artifacts, `${artifactId}.json`),
    `${JSON.stringify(
      {
        id: artifactId,
        task_id: taskRunId,
        type: "research_report",
        title: "Review",
        content: `# reviewed bytes for ${taskRunId}\n`,
        status: "delivered",
        accepted: false,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const run = {
    id: taskRunId,
    employee_id: employeeId,
    requested_task_id: requestedTaskId,
    user_goal: goal,
    artifact: artifactId,
    status: "delivered",
    events: [],
    tool_invocations: [],
    plan: { steps: ["review"] },
    memory_commit: { candidates: [], lessons: 0, committed: false },
  };
  const pending = {
    approvalId: `approval-${taskRunId}`,
    taskRunId,
    employeeId,
    requestedTaskId,
    goal,
    artifact: { id: artifactId, path: artifactPath },
    fingerprint: captureArtifactFingerprint(artifactPath),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    reportPath: join(runs, `${taskRunId}.report.md`),
    createdAt,
  };
  assert.equal(pending.fingerprint.ok, true);
  return { artifactPath, pending, run };
}

const root = mkdtempSync(join(tmpdir(), "crew-task-approval-"));
const linkedRoot = mkdtempSync(join(tmpdir(), "crew-task-approval-link-"));
const outside = mkdtempSync(join(tmpdir(), "crew-task-approval-outside-"));
try {
  const first = createBoundTask(root, {
    taskRunId: "task-1",
    artifactId: "artifact_1",
  });
  const callerVersionCannotOverride = {
    ...first.pending,
    protocolVersion: 999,
  };
  const saved = persistPendingTaskApproval(root, callerVersionCannotOverride, {
    run: first.run,
  });
  assert.equal(saved.ok, true);
  assert.equal(
    persistPendingTaskApproval(root, callerVersionCannotOverride, {
      run: first.run,
    }).existing,
    true
  );
  const stored = JSON.parse(
    readFileSync(pendingTaskApprovalPath(root, "task-1"), "utf8")
  );
  assert.equal(stored.protocolVersion, 1);

  const differentFingerprint = {
    ...callerVersionCannotOverride,
    fingerprint: {
      ...callerVersionCannotOverride.fingerprint,
      sha256: "0".repeat(64),
    },
  };
  assert.equal(
    persistPendingTaskApproval(root, differentFingerprint, {
      run: first.run,
    }).code,
    "pending_approval_conflict",
    "the same ids with different fingerprint bytes are not an idempotent retry"
  );

  const restored = findPendingTaskApproval(root, {
    employeeId: "employee-1",
    requestedTaskId: "demo-1",
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.pending.taskRunId, "task-1");
  assert.equal(
    verifyPendingTaskApprovalBinding(root, restored.pending, first.run).ok,
    true
  );
  assert.equal(verifyPendingTaskArtifact(root, restored.pending).ok, true);

  assert.equal(
    verifyPendingTaskApprovalBinding(root, restored.pending, {
      ...first.run,
      id: "task-wrong",
    }).code,
    "pending_approval_run_mismatch"
  );
  assert.equal(
    verifyPendingTaskApprovalBinding(root, restored.pending, {
      ...first.run,
      artifact: "artifact_wrong",
    }).code,
    "pending_approval_run_artifact_mismatch"
  );

  const artifactJsonPath = join(
    root,
    ".crewclaw",
    "artifacts",
    "artifact_1.json"
  );
  const artifactMetadata = JSON.parse(readFileSync(artifactJsonPath, "utf8"));
  writeFileSync(
    artifactJsonPath,
    `${JSON.stringify({ ...artifactMetadata, task_id: "task-wrong" }, null, 2)}\n`,
    "utf8"
  );
  assert.equal(
    verifyPendingTaskApprovalBinding(root, restored.pending, first.run).code,
    "pending_approval_artifact_task_mismatch"
  );
  writeFileSync(
    artifactJsonPath,
    `${JSON.stringify(artifactMetadata, null, 2)}\n`,
    "utf8"
  );

  writeFileSync(
    first.artifactPath,
    "# changed after approval request\n",
    "utf8"
  );
  assert.equal(
    verifyPendingTaskArtifact(root, restored.pending).code,
    "artifact_changed"
  );
  assert.equal(removePendingTaskApproval(root, "task-1").ok, true);

  const futurePath = pendingTaskApprovalPath(root, "task-future");
  writeFileSync(
    futurePath,
    `${JSON.stringify(
      { ...stored, protocolVersion: 2, taskRunId: "task-future" },
      null,
      2
    )}\n`,
    "utf8"
  );
  assert.equal(
    findPendingTaskApproval(root, { employeeId: "employee-1" }).code,
    "pending_approval_future_protocol",
    "a future receipt must block instead of being skipped"
  );
  rmSync(futurePath, { force: true });

  const corruptPath = pendingTaskApprovalPath(root, "task-corrupt");
  writeFileSync(corruptPath, "{not-json", "utf8");
  assert.equal(
    findPendingTaskApproval(root, { employeeId: "employee-1" }).code,
    "pending_approval_corrupt"
  );
  rmSync(corruptPath, { force: true });

  const mismatchedFile = pendingTaskApprovalPath(root, "task-other");
  writeFileSync(mismatchedFile, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  assert.equal(
    findPendingTaskApproval(root, { employeeId: "employee-1" }).code,
    "pending_approval_filename_mismatch"
  );
  rmSync(mismatchedFile, { force: true });

  const doubleA = createBoundTask(root, {
    taskRunId: "task-double-a",
    artifactId: "artifact_double_a",
    createdAt: 1,
  });
  const doubleB = createBoundTask(root, {
    taskRunId: "task-double-b",
    artifactId: "artifact_double_b",
    createdAt: 2,
  });
  assert.equal(
    persistPendingTaskApproval(root, doubleA.pending, { run: doubleA.run }).ok,
    true
  );
  assert.equal(
    persistPendingTaskApproval(root, doubleB.pending, { run: doubleB.run }).ok,
    true
  );
  const ambiguous = findPendingTaskApproval(root, {
    employeeId: "employee-1",
    requestedTaskId: "demo-1",
  });
  assert.equal(ambiguous.code, "pending_approval_ambiguous");
  assert.deepEqual(
    new Set(ambiguous.taskRunIds),
    new Set(["task-double-a", "task-double-b"])
  );
  removePendingTaskApproval(root, "task-double-a");
  removePendingTaskApproval(root, "task-double-b");
  assert.equal(
    findPendingTaskApproval(root, { employeeId: "employee-1" }).pending,
    null
  );

  const oversized = createBoundTask(root, {
    taskRunId: "task-oversized-decision",
    artifactId: "artifact_oversized_decision",
  });
  assert.equal(
    persistPendingTaskApproval(root, oversized.pending, {
      run: oversized.run,
    }).ok,
    true
  );
  const oversizedPending = JSON.parse(
    readFileSync(pendingTaskApprovalPath(root, oversized.run.id), "utf8")
  );
  const oversizedDecision = persistTaskApprovalDecision(
    root,
    oversizedPending,
    {
      decisionAt: oversizedPending.createdAt + 1,
      run: {
        ...oversized.run,
        memory_commit: {
          candidates: [
            {
              category: "reliable_sources",
              text: "x".repeat(MAX_STATE_FILE_BYTES),
              confidence: "high",
            },
          ],
          lessons: 0,
          committed: false,
        },
      },
      evidence: [],
    }
  );
  assert.equal(oversizedDecision.code, "task_accept_decision_not_persisted");
  assert.equal(
    existsSync(taskApprovalDecisionPath(root, oversized.run.id)),
    false,
    "an oversized settlement snapshot leaves no unreadable decision final"
  );
  removePendingTaskApproval(root, oversized.run.id);

  mkdirSync(join(linkedRoot, ".crewclaw"), { recursive: true });
  const outsideArtifact = join(outside, "artifact_2.md");
  writeFileSync(outsideArtifact, "# outside bytes\n", "utf8");
  writeFileSync(
    join(outside, "artifact_2.json"),
    `${JSON.stringify({ id: "artifact_2", task_id: "task-escape" }, null, 2)}\n`,
    "utf8"
  );
  symlinkSync(
    outside,
    join(linkedRoot, ".crewclaw", "artifacts"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const escapedPath = join(
    linkedRoot,
    ".crewclaw",
    "artifacts",
    "artifact_2.md"
  );
  const escapedPending = {
    approvalId: "approval-escape",
    taskRunId: "task-escape",
    employeeId: "employee-1",
    requestedTaskId: "demo-1",
    goal: "write a report",
    artifact: { id: "artifact_2", path: escapedPath },
    fingerprint: captureArtifactFingerprint(escapedPath),
    usage: { prompt_tokens: 1, completion_tokens: 1 },
    reportPath: join(linkedRoot, ".crewclaw", "runs", "task-escape.report.md"),
    createdAt: Date.now(),
  };
  const escapedRun = {
    id: "task-escape",
    employee_id: "employee-1",
    requested_task_id: "demo-1",
    user_goal: "write a report",
    artifact: "artifact_2",
    status: "delivered",
  };
  assert.equal(escapedPending.fingerprint.ok, true);
  assert.equal(
    verifyPendingTaskArtifact(linkedRoot, escapedPending).code,
    "artifact_link_component"
  );
  assert.equal(
    persistPendingTaskApproval(linkedRoot, escapedPending, {
      run: escapedRun,
    }).code,
    "artifact_link_component",
    "a receipt cannot bless an artifact reached through an external junction"
  );
  assert.equal(
    existsSync(pendingTaskApprovalPath(linkedRoot, "task-escape")),
    false,
    "rejected artifact writes no pending approval receipt"
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(linkedRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

console.log("task approval store tests passed");
