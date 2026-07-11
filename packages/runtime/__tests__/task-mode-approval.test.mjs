import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  createTaskSettlementSnapshot,
  pendingTaskApprovalPath,
  persistTaskApprovalDecision,
  taskApprovalDecisionPath,
} from "../task-approval-store.mjs";
import { loadMemory } from "../memory-store.mjs";
import { validateCompletion } from "../proofpack.mjs";
import { startMockModel } from "./mock-model.mjs";
import { REPO_ROOT, RUNTIME_ENTRY } from "./test-paths.mjs";

const TASK_ID = "research-seed-2.1";
const AGENT_ID = "ai-adoption-whale";
const TIMEOUT_MS = 15_000;
const TERMINALS = new Set([
  "task.completed",
  "task.rejected",
  "task.blocked",
  "task.failed",
  "task.revision_needed",
]);

const DELIVERABLE = [
  "## 官方名称",
  "Doubao-Seed-2.1（火山引擎 Seed 2.1）。",
  "",
  "## 价格",
  "输入 6 元 / 输出 30 元（每百万 token）。",
  "",
  "## 上下文",
  "256k token。",
  "",
  "## 能力",
  "Coding、Agent、推理、多模态。",
  "",
  "## 来源",
  "https://www.volcengine.com/product/ark （官方文档）。",
  "",
  "## 置信度",
  "高（官方文档交叉验证）。",
  "",
  "## 建议",
  "推荐接入 CrewClaw，作为选型候选之一。",
].join("\n");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function startTaskProcess({ root, modelUrl }) {
  const child = spawn(
    process.execPath,
    [RUNTIME_ENTRY, AGENT_ID, "--task", TASK_ID],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CREW_TUI: "ratatui",
        CREW_MOCK: "0",
        CREWCLAW_ROOT: root,
        ZENMUX_API_KEY: "test",
        ZENMUX_BASE_URL: modelUrl,
        TAVILY_API_KEY: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const decoder = new StringDecoder("utf8");
  const events = [];
  const invalidLines = [];
  const waiters = [];
  let stdoutBuffer = "";
  let stderr = "";
  let closed = false;
  let closeResult = null;

  const notify = event => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.type === event.type && waiter.predicate(event)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    }
  };

  const acceptLine = raw => {
    const line = raw.trim();
    if (!line) return;
    try {
      const event = JSON.parse(line);
      assert.equal(typeof event?.type, "string");
      assert.equal(event.protocol_version, 1);
      events.push(event);
      notify(event);
    } catch (error) {
      invalidLines.push(`${error?.message || error}: ${line.slice(0, 240)}`);
    }
  };

  child.stdout.on("data", chunk => {
    stdoutBuffer += decoder.write(chunk);
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline === -1) break;
      acceptLine(stdoutBuffer.slice(0, newline));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }
  });
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });
  child.on("close", (code, signal) => {
    stdoutBuffer += decoder.end();
    if (stdoutBuffer.trim()) acceptLine(stdoutBuffer);
    closed = true;
    closeResult = { code, signal };
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(
          `runtime closed before ${waiter.type}: code=${code} signal=${signal}; events=${JSON.stringify(
            events.map(event => ({ type: event.type, data: event.data }))
          )}\n${stderr}`
        )
      );
    }
  });

  return {
    child,
    events,
    invalidLines,
    get stderr() {
      return stderr;
    },
    waitFor(type, predicate = () => true) {
      const existing = events.find(
        event => event.type === type && predicate(event)
      );
      if (existing) return Promise.resolve(existing);
      if (closed) {
        return Promise.reject(
          new Error(`runtime already closed before ${type}: ${stderr}`)
        );
      }
      return new Promise((resolve, reject) => {
        const waiter = { type, predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          child.kill();
          reject(new Error(`timed out waiting for ${type}\n${stderr}`));
        }, TIMEOUT_MS);
        waiters.push(waiter);
      });
    },
    waitForClose() {
      if (closed) return Promise.resolve(closeResult);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`runtime did not exit\n${stderr}`));
        }, TIMEOUT_MS);
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
    },
  };
}

function acceptApproval(harness, approval) {
  harness.child.stdin.write(
    `${JSON.stringify({
      type: "approval.resolve",
      data: {
        id: approval.data.id,
        kind: "deliverable_acceptance",
        decision: "accept",
      },
    })}\n`
  );
}

function rejectApproval(harness, approval) {
  harness.child.stdin.write(
    `${JSON.stringify({
      type: "approval.resolve",
      data: {
        id: approval.data.id,
        kind: "deliverable_acceptance",
        decision: "reject",
      },
    })}\n`
  );
}

function memoryItems(root) {
  return loadMemory(root, AGENT_ID).items;
}

function assertSingleTerminal(events, taskRunId, expected) {
  const terminals = events.filter(
    event =>
      TERMINALS.has(event.type) &&
      (event.data?.taskRunId || event.data?.id) === taskRunId
  );
  assert.deepEqual(
    terminals.map(event => event.type),
    [expected],
    `task ${taskRunId} must have exactly one ${expected} terminal`
  );
}

async function finish(harness) {
  if (!harness.child.stdin.destroyed) harness.child.stdin.end();
  const result = await harness.waitForClose();
  assert.equal(
    result.code,
    0,
    `runtime exited ${result.code}/${result.signal}\n${harness.stderr}`
  );
  assert.deepEqual(harness.invalidLines, [], "stdout must be strict JSONL");
}

async function acceptedDeliveryIsDurable(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-accept-"));
  try {
    const harness = startTaskProcess({ root, modelUrl });
    const approval = await harness.waitFor("approval.requested");
    assert.deepEqual(
      memoryItems(root),
      [],
      "deliverable candidates must not be searchable before acceptance"
    );
    assert.equal(
      harness.events.some(event => event.type === "memory.saved"),
      false
    );
    harness.child.stdin.write("a\n");
    await harness.waitFor("debug.line", event =>
      /structured approval\.resolve required/.test(event.data?.line)
    );
    assert.equal(
      existsSync(taskApprovalDecisionPath(root, approval.data.taskRunId)),
      false,
      "a legacy bare accept cannot create an acceptance decision"
    );
    harness.child.stdin.write(
      `${JSON.stringify({
        type: "approval.resolve",
        data: {
          id: `${approval.data.id}-stale`,
          kind: "deliverable_acceptance",
          decision: "reject",
        },
      })}\n`
    );
    harness.child.stdin.write(
      `${JSON.stringify({
        type: "approval.resolve",
        data: {
          id: approval.data.id,
          kind: "tool_authorization",
          decision: "reject",
        },
      })}\n`
    );
    acceptApproval(harness, approval);
    const accepted = await harness.waitFor("approval.accepted");
    const completed = await harness.waitFor("task.completed");
    await finish(harness);

    const taskRunId = approval.data.taskRunId;
    assert.equal(accepted.data.taskRunId, taskRunId);
    assert.equal(completed.data.taskRunId, taskRunId);
    assertSingleTerminal(harness.events, taskRunId, "task.completed");
    assert.ok(existsSync(accepted.data.proofpack));

    const pack = JSON.parse(readFileSync(accepted.data.proofpack, "utf8"));
    const artifact = approval.data.artifacts[0];
    assert.equal(pack.task_run_id, taskRunId);
    assert.equal(pack.artifacts[0].fingerprint.sha256, sha256(artifact.path));
    assert.equal(pack.user_approval.decision, "accept");
    const decision = JSON.parse(
      readFileSync(taskApprovalDecisionPath(root, taskRunId), "utf8")
    );
    assert.equal(
      pack.user_approval.at,
      new Date(decision.decisionAt).toISOString(),
      "ProofPack records the actual durable decision time"
    );
    assert.deepEqual(validateCompletion(pack), { valid: true, missing: [] });
    assert.equal(
      harness.events.filter(event => event.type === "approval.accepted").length,
      1,
      "stale or wrong-kind actions cannot settle the approval"
    );

    const run = JSON.parse(
      readFileSync(join(root, ".crewclaw", "runs", `${taskRunId}.json`), "utf8")
    );
    assert.equal(run.status, "accepted");
    assert.equal(run.proofpack, accepted.data.proofpack);
    assert.equal(run.memory_commit?.committed, true);
    const memory = memoryItems(root);
    assert.ok(memory.length >= 2, "accepted deliverable commits staged memory");
    assert.ok(
      memory.some(item => item.category === "reliable_sources"),
      "accepted source becomes searchable memory"
    );
    const memoryEventIndex = harness.events.findIndex(
      event => event.type === "memory.saved"
    );
    assert.ok(
      memoryEventIndex >
        harness.events.findIndex(event => event.type === "approval.requested"),
      "memory.saved is emitted only after the approval decision"
    );
    assert.equal(existsSync(pendingTaskApprovalPath(root, taskRunId)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function rejectedDeliveryDoesNotWriteMemory(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-reject-memory-"));
  try {
    const harness = startTaskProcess({ root, modelUrl });
    const approval = await harness.waitFor("approval.requested");
    assert.deepEqual(memoryItems(root), []);
    rejectApproval(harness, approval);
    await harness.waitFor("task.revision_needed");
    await finish(harness);

    assert.deepEqual(
      memoryItems(root),
      [],
      "rejected deliverable must not pollute searchable memory"
    );
    assert.equal(
      harness.events.some(event => event.type === "memory.saved"),
      false
    );
    const run = JSON.parse(
      readFileSync(
        join(root, ".crewclaw", "runs", `${approval.data.taskRunId}.json`),
        "utf8"
      )
    );
    assert.equal(run.status, "revision_needed");
    assert.equal(
      run.memory_commit,
      null,
      "rejection discards staged candidates"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function eofRestoresSameApproval(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-recover-"));
  try {
    const first = startTaskProcess({ root, modelUrl });
    const requested = await first.waitFor("approval.requested");
    assert.deepEqual(memoryItems(root), []);
    first.child.stdin.end();
    const blocked = await first.waitFor("task.blocked");
    await finish(first);
    assert.equal(blocked.data.recoverable, true);
    assertSingleTerminal(
      first.events,
      requested.data.taskRunId,
      "task.blocked"
    );
    assert.ok(
      existsSync(pendingTaskApprovalPath(root, requested.data.taskRunId))
    );
    assert.deepEqual(
      memoryItems(root),
      [],
      "EOF preserves the pending receipt but cannot commit memory"
    );

    const second = startTaskProcess({ root, modelUrl });
    const restored = await second.waitFor(
      "approval.requested",
      event => event.data?.id === requested.data.id
    );
    assert.equal(restored.data.taskRunId, requested.data.taskRunId);
    acceptApproval(second, restored);
    await second.waitFor("approval.accepted");
    await second.waitFor("task.completed");
    await finish(second);
    assertSingleTerminal(
      second.events,
      requested.data.taskRunId,
      "task.completed"
    );
    assert.equal(
      existsSync(pendingTaskApprovalPath(root, requested.data.taskRunId)),
      false
    );
    assert.ok(memoryItems(root).length >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function memoryCommitFailureRecoversAfterAcceptance(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-memory-recover-"));
  const outside = mkdtempSync(
    join(tmpdir(), "crew-task-memory-recover-outside-")
  );
  const memoryPath = join(root, ".crewclaw", "memory");
  try {
    const first = startTaskProcess({ root, modelUrl });
    const approval = await first.waitFor("approval.requested");
    mkdirSync(join(root, ".crewclaw"), { recursive: true });
    symlinkSync(
      outside,
      memoryPath,
      process.platform === "win32" ? "junction" : "dir"
    );
    acceptApproval(first, approval);
    const blocked = await first.waitFor(
      "task.blocked",
      event => event.data?.reason_code === "memory_candidate_not_persisted"
    );
    await finish(first);

    assert.equal(blocked.data.recoverable, true);
    assert.equal(
      first.events.some(event => event.type === "approval.accepted"),
      false,
      "acceptance is not announced until its post-accept memory transaction is recoverable"
    );
    assert.deepEqual(memoryItems(root), []);
    assert.equal(
      existsSync(join(outside, `${AGENT_ID}.json`)),
      false,
      "memory write cannot traverse the injected junction"
    );
    const runPath = join(
      root,
      ".crewclaw",
      "runs",
      `${approval.data.taskRunId}.json`
    );
    const acceptedRun = JSON.parse(readFileSync(runPath, "utf8"));
    assert.equal(acceptedRun.status, "accepted");
    assert.equal(acceptedRun.memory_commit?.committed, false);
    assert.ok(
      existsSync(pendingTaskApprovalPath(root, approval.data.taskRunId))
    );

    rmSync(memoryPath, { recursive: true, force: true });
    const second = startTaskProcess({ root, modelUrl });
    await second.waitFor(
      "approval.accepted",
      event => event.data?.taskRunId === approval.data.taskRunId
    );
    await second.waitFor(
      "task.completed",
      event => event.data?.taskRunId === approval.data.taskRunId
    );
    await finish(second);

    assert.ok(memoryItems(root).length >= 2);
    const recoveredRun = JSON.parse(readFileSync(runPath, "utf8"));
    assert.equal(recoveredRun.memory_commit?.committed, true);
    assert.equal(
      existsSync(pendingTaskApprovalPath(root, approval.data.taskRunId)),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

async function changedOrDeletedArtifactFailsClosed(modelUrl, mutation) {
  const root = mkdtempSync(join(tmpdir(), `crew-task-${mutation}-`));
  try {
    const harness = startTaskProcess({ root, modelUrl });
    const approval = await harness.waitFor("approval.requested");
    const artifactPath = approval.data.artifacts[0].path;
    if (mutation === "changed") {
      writeFileSync(artifactPath, "# modified after review\n", "utf8");
    } else {
      unlinkSync(artifactPath);
    }
    acceptApproval(harness, approval);
    const failed = await harness.waitFor("task.failed");
    await finish(harness);

    assert.equal(failed.data.taskRunId, approval.data.taskRunId);
    assertSingleTerminal(
      harness.events,
      approval.data.taskRunId,
      "task.failed"
    );
    assert.equal(
      harness.events.some(event => event.type === "approval.accepted"),
      false
    );
    assert.equal(
      harness.events.some(event => event.type === "task.completed"),
      false
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".crewclaw",
          "runs",
          `${approval.data.taskRunId}.proofpack.json`
        )
      ),
      false
    );
    assert.deepEqual(
      memoryItems(root),
      [],
      "failed artifact verification must not commit staged memory"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function createInterruptedPending(root, modelUrl) {
  const first = startTaskProcess({ root, modelUrl });
  const approval = await first.waitFor("approval.requested");
  first.child.stdin.end();
  await first.waitFor("task.blocked");
  await finish(first);
  const receiptPath = pendingTaskApprovalPath(root, approval.data.taskRunId);
  assert.ok(existsSync(receiptPath));
  return { approval, receiptPath };
}

function taskRunPath(root, taskRunId) {
  return join(root, ".crewclaw", "runs", `${taskRunId}.json`);
}

function taskEvidencePath(root, taskRunId) {
  return join(root, ".crewclaw", "runs", `${taskRunId}.evidence.json`);
}

function persistCrashWindowDecision(root, taskRunId) {
  const receiptPath = pendingTaskApprovalPath(root, taskRunId);
  const pending = JSON.parse(readFileSync(receiptPath, "utf8"));
  const runPath = taskRunPath(root, taskRunId);
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const evidencePath = taskEvidencePath(root, taskRunId);
  const evidence = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, "utf8"))
    : [];
  const persisted = persistTaskApprovalDecision(root, pending, {
    decisionAt: Math.max(Date.now(), pending.createdAt),
    run,
    evidence,
  });
  assert.equal(
    persisted.ok,
    true,
    `failed to prepare immutable accept crash window: ${persisted.reason || ""}`
  );
  return {
    pending,
    run,
    evidence,
    receiptPath,
    runPath,
    evidencePath,
    decisionPath: persisted.path,
    decision: persisted.decision,
    proofpackPath: join(
      root,
      ".crewclaw",
      "runs",
      `${taskRunId}.proofpack.json`
    ),
  };
}

async function tamperedRecoveryBlocks(modelUrl, mutation, expectedCode) {
  const root = mkdtempSync(join(tmpdir(), `crew-task-recovery-${mutation}-`));
  try {
    const { approval, receiptPath } = await createInterruptedPending(
      root,
      modelUrl
    );
    const taskRunId = approval.data.taskRunId;
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    let secondReceiptPath = null;

    if (mutation === "future_protocol") {
      writeFileSync(
        receiptPath,
        `${JSON.stringify({ ...receipt, protocolVersion: 2 }, null, 2)}\n`,
        "utf8"
      );
    } else if (mutation === "corrupt_receipt") {
      writeFileSync(receiptPath, "{not-json", "utf8");
    } else if (mutation === "wrong_run_artifact") {
      const runPath = join(root, ".crewclaw", "runs", `${taskRunId}.json`);
      const run = JSON.parse(readFileSync(runPath, "utf8"));
      writeFileSync(
        runPath,
        `${JSON.stringify({ ...run, artifact: "artifact_wrong" }, null, 2)}\n`,
        "utf8"
      );
    } else if (mutation === "wrong_artifact_task") {
      const artifactId = approval.data.artifacts[0].id;
      const artifactPath = join(
        root,
        ".crewclaw",
        "artifacts",
        `${artifactId}.json`
      );
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      writeFileSync(
        artifactPath,
        `${JSON.stringify({ ...artifact, task_id: "task_wrong" }, null, 2)}\n`,
        "utf8"
      );
    } else if (mutation === "double_pending") {
      const duplicateTaskRunId = `${taskRunId}-duplicate`;
      secondReceiptPath = pendingTaskApprovalPath(root, duplicateTaskRunId);
      writeFileSync(
        secondReceiptPath,
        `${JSON.stringify(
          {
            ...receipt,
            approvalId: `${receipt.approvalId}-duplicate`,
            taskRunId: duplicateTaskRunId,
            createdAt: Number(receipt.createdAt) + 1,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    } else {
      throw new Error(`unknown recovery mutation: ${mutation}`);
    }

    const second = startTaskProcess({ root, modelUrl });
    const blocked = await second.waitFor(
      "task.blocked",
      event => event.data?.reason_code === expectedCode
    );
    await finish(second);

    assert.equal(blocked.data.recoverable, false);
    assert.equal(
      second.events.some(event => event.type === "approval.requested"),
      false,
      "an untrusted pending receipt must not be offered for approval"
    );
    assert.equal(
      second.events.some(event => event.type === "task.completed"),
      false
    );
    assert.ok(
      existsSync(receiptPath),
      "blocked recovery retains the receipt for audit/manual repair"
    );
    if (secondReceiptPath) assert.ok(existsSync(secondReceiptPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function decisionSettlementTamperingBlocks(modelUrl) {
  const cases = [
    {
      name: "pending-usage",
      expectedCode: "task_accept_settlement_pending_mismatch",
      mutate(state) {
        const pending = JSON.parse(readFileSync(state.receiptPath, "utf8"));
        pending.usage.prompt_tokens += 1;
        writeFileSync(
          state.receiptPath,
          `${JSON.stringify(pending, null, 2)}\n`,
          "utf8"
        );
      },
    },
    {
      name: "pending-report-path",
      expectedCode: "task_accept_settlement_pending_mismatch",
      mutate(state) {
        const pending = JSON.parse(readFileSync(state.receiptPath, "utf8"));
        pending.reportPath = null;
        writeFileSync(
          state.receiptPath,
          `${JSON.stringify(pending, null, 2)}\n`,
          "utf8"
        );
      },
    },
    ...[
      ["run-plan", run => (run.plan = { injected: true })],
      [
        "run-events",
        run =>
          run.events.push({
            id: "evt_injected",
            task_id: run.id,
            type: "injected",
            summary: "not reviewed",
            tool_name: null,
            status: null,
            timestamp: new Date().toISOString(),
          }),
      ],
      [
        "run-tool-invocations",
        run =>
          run.tool_invocations.push({
            tool_name: "injected_tool",
            decision: "allow",
            status: "success",
          }),
      ],
      [
        "run-memory-candidates",
        run =>
          run.memory_commit.candidates.push({
            category: "reliable_sources",
            text: "INJECTED_SETTLEMENT_MEMORY",
            confidence: "high",
          }),
      ],
      ["run-degraded", run => (run.degraded = run.degraded !== true)],
    ].map(([name, mutateRun]) => ({
      name,
      expectedCode: "task_accept_settlement_run_mismatch",
      mutate(state) {
        const run = JSON.parse(readFileSync(state.runPath, "utf8"));
        mutateRun(run);
        writeFileSync(
          state.runPath,
          `${JSON.stringify(run, null, 2)}\n`,
          "utf8"
        );
      },
    })),
    {
      name: "run-employee",
      expectedCode: "pending_approval_employee_mismatch",
      mutate(state) {
        const run = JSON.parse(readFileSync(state.runPath, "utf8"));
        run.employee_id = "injected-employee";
        writeFileSync(
          state.runPath,
          `${JSON.stringify(run, null, 2)}\n`,
          "utf8"
        );
      },
    },
    {
      name: "evidence",
      expectedCode: "task_accept_settlement_evidence_mismatch",
      mutate(state) {
        const evidence = structuredClone(state.evidence);
        evidence.push({
          field: "来源",
          value: "injected",
          source_url: "https://attacker.invalid",
          source_type: "official",
          confidence: "high",
          snippet: "not reviewed",
          ts: new Date().toISOString(),
        });
        writeFileSync(
          state.evidencePath,
          `${JSON.stringify(evidence, null, 2)}\n`,
          "utf8"
        );
      },
    },
    {
      name: "decision-snapshot-hash",
      expectedCode: "task_accept_settlement_hash_mismatch",
      mutate(state) {
        const decision = JSON.parse(readFileSync(state.decisionPath, "utf8"));
        decision.settlement.snapshot.run.memory_commit.candidates.push({
          category: "reliable_sources",
          text: "INJECTED_DECISION_MEMORY",
          confidence: "high",
        });
        writeFileSync(
          state.decisionPath,
          `${JSON.stringify(decision, null, 2)}\n`,
          "utf8"
        );
      },
    },
  ];

  for (const testCase of cases) {
    const root = mkdtempSync(
      join(tmpdir(), `crew-task-settlement-${testCase.name}-`)
    );
    try {
      const { approval } = await createInterruptedPending(root, modelUrl);
      const taskRunId = approval.data.taskRunId;
      const state = persistCrashWindowDecision(root, taskRunId);
      testCase.mutate(state);

      const restarted = startTaskProcess({ root, modelUrl });
      const blocked = await restarted.waitFor(
        "task.blocked",
        event => event.data?.reason_code === testCase.expectedCode
      );
      await finish(restarted);

      assert.equal(blocked.data.recoverable, false, testCase.name);
      assert.equal(
        restarted.events.some(event => event.type === "task.completed"),
        false,
        `${testCase.name} cannot complete a tampered settlement`
      );
      assert.equal(
        restarted.events.some(event => event.type === "approval.accepted"),
        false,
        `${testCase.name} cannot announce acceptance`
      );
      assert.equal(
        existsSync(state.proofpackPath),
        false,
        `${testCase.name} cannot create a new ProofPack after decision tampering`
      );
      assert.deepEqual(
        memoryItems(root),
        [],
        `${testCase.name} cannot commit frozen or injected memory`
      );
      assert.ok(existsSync(state.decisionPath));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

async function acceptedCrashCannotInjectMemory(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-accepted-injection-"));
  try {
    const { approval } = await createInterruptedPending(root, modelUrl);
    const taskRunId = approval.data.taskRunId;
    const state = persistCrashWindowDecision(root, taskRunId);
    const acceptedAt = new Date(state.decision.decisionAt).toISOString();
    const acceptedRun = structuredClone(state.run);
    acceptedRun.status = "accepted";
    acceptedRun.updated_at = acceptedAt;
    acceptedRun.events.push({
      id: `evt_${acceptedRun.events.length + 1}`,
      task_id: taskRunId,
      type: "state_changed",
      summary: "-> accepted",
      tool_name: null,
      status: null,
      timestamp: acceptedAt,
    });
    acceptedRun.pending_approval = null;
    acceptedRun.approval_decision = {
      receipt: state.decisionPath,
      approval_id: state.pending.approvalId,
      decision: "accept",
      decision_at: state.decision.decisionAt,
      artifact_sha256: state.pending.fingerprint.sha256,
      settlement_sha256: state.decision.settlement.sha256,
    };
    acceptedRun.proofpack = state.proofpackPath;
    acceptedRun.user_feedback = "useful";
    acceptedRun.effective = acceptedRun.degraded !== true;
    acceptedRun.memory_commit.candidates.push({
      category: "reliable_sources",
      text: "INJECTED_ACCEPTED_MEMORY",
      confidence: "high",
    });
    writeFileSync(
      state.runPath,
      `${JSON.stringify(acceptedRun, null, 2)}\n`,
      "utf8"
    );

    const restarted = startTaskProcess({ root, modelUrl });
    const blocked = await restarted.waitFor(
      "task.blocked",
      event =>
        event.data?.reason_code === "task_accept_settlement_memory_mismatch"
    );
    await finish(restarted);

    assert.equal(blocked.data.recoverable, false);
    assert.equal(existsSync(state.proofpackPath), false);
    assert.deepEqual(memoryItems(root), []);
    assert.equal(
      restarted.events.some(event => event.type === "task.completed"),
      false,
      "an accepted-state memory injection cannot complete recovery"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function acceptedStateWithoutDecisionBlocks(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-accepted-no-decision-"));
  try {
    const { approval, receiptPath } = await createInterruptedPending(
      root,
      modelUrl
    );
    const taskRunId = approval.data.taskRunId;
    const runPath = join(root, ".crewclaw", "runs", `${taskRunId}.json`);
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    writeFileSync(
      runPath,
      `${JSON.stringify(
        {
          ...run,
          status: "accepted",
          pending_approval: null,
          memory_commit: {
            ...run.memory_commit,
            committed: true,
            committed_at: new Date().toISOString(),
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const restarted = startTaskProcess({ root, modelUrl });
    const blocked = await restarted.waitFor(
      "task.blocked",
      event => event.data?.reason_code === "task_accept_decision_missing"
    );
    await finish(restarted);

    assert.equal(blocked.data.recoverable, false);
    assert.equal(
      restarted.events.some(event => event.type === "task.completed"),
      false,
      "forged accepted state cannot complete without a decision receipt"
    );
    assert.deepEqual(memoryItems(root), []);
    assert.ok(existsSync(receiptPath), "tamper evidence remains for repair");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function mismatchedDecisionReceiptBlocks(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-decision-mismatch-"));
  try {
    const { approval, receiptPath } = await createInterruptedPending(
      root,
      modelUrl
    );
    const pending = JSON.parse(readFileSync(receiptPath, "utf8"));
    const run = JSON.parse(
      readFileSync(
        join(root, ".crewclaw", "runs", `${pending.taskRunId}.json`),
        "utf8"
      )
    );
    const evidencePath = join(
      root,
      ".crewclaw",
      "runs",
      `${pending.taskRunId}.evidence.json`
    );
    const evidence = existsSync(evidencePath)
      ? JSON.parse(readFileSync(evidencePath, "utf8"))
      : [];
    const mismatchedPending = {
      ...pending,
      fingerprint: {
        ...pending.fingerprint,
        sha256: "0".repeat(64),
      },
    };
    const settlement = createTaskSettlementSnapshot({
      pending: mismatchedPending,
      run,
      evidence,
    });
    assert.equal(settlement.ok, true);
    const decisionPath = taskApprovalDecisionPath(root, pending.taskRunId);
    writeFileSync(
      decisionPath,
      `${JSON.stringify(
        {
          protocolVersion: 2,
          approvalId: pending.approvalId,
          taskRunId: pending.taskRunId,
          employeeId: pending.employeeId,
          requestedTaskId: pending.requestedTaskId,
          artifact: mismatchedPending.artifact,
          fingerprint: mismatchedPending.fingerprint,
          decision: "accept",
          pendingCreatedAt: pending.createdAt,
          decisionAt: Math.max(Date.now(), pending.createdAt),
          settlement: {
            protocolVersion: 1,
            sha256: settlement.sha256,
            snapshot: settlement.snapshot,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const restarted = startTaskProcess({ root, modelUrl });
    const blocked = await restarted.waitFor(
      "task.blocked",
      event => event.data?.reason_code === "task_accept_decision_mismatch"
    );
    await finish(restarted);

    assert.equal(blocked.data.recoverable, false);
    assert.equal(
      restarted.events.some(event => event.type === "approval.requested"),
      false,
      "a mismatched durable accept must not be re-presented as a fresh choice"
    );
    assert.equal(
      restarted.events.some(event => event.type === "task.completed"),
      false
    );
    assert.ok(existsSync(receiptPath));
    assert.ok(existsSync(decisionPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function concurrentRecoverySettlesExactlyOnce(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-concurrent-recovery-"));
  try {
    const { approval } = await createInterruptedPending(root, modelUrl);
    const first = startTaskProcess({ root, modelUrl });
    const second = startTaskProcess({ root, modelUrl });
    const [firstApproval, secondApproval] = await Promise.all([
      first.waitFor(
        "approval.requested",
        event => event.data?.id === approval.data.id
      ),
      second.waitFor(
        "approval.requested",
        event => event.data?.id === approval.data.id
      ),
    ]);

    acceptApproval(first, firstApproval);
    acceptApproval(second, secondApproval);
    await Promise.all([
      first.waitFor("task.completed"),
      second.waitFor("task.completed"),
    ]);
    await Promise.all([finish(first), finish(second)]);

    const taskRunId = approval.data.taskRunId;
    const run = JSON.parse(
      readFileSync(join(root, ".crewclaw", "runs", `${taskRunId}.json`), "utf8")
    );
    const decisionPath = taskApprovalDecisionPath(root, taskRunId);
    const decision = JSON.parse(readFileSync(decisionPath, "utf8"));
    const pack = JSON.parse(readFileSync(run.proofpack, "utf8"));
    const memory = memoryItems(root);
    const memoryKeys = memory.map(item => `${item.category}\0${item.text}`);

    assert.equal(run.status, "accepted");
    assert.equal(run.approval_decision.receipt, decisionPath);
    assert.equal(run.approval_decision.decision_at, decision.decisionAt);
    assert.equal(
      pack.user_approval.at,
      new Date(decision.decisionAt).toISOString()
    );
    assert.equal(
      new Set(memoryKeys).size,
      memoryKeys.length,
      "concurrent recovery cannot duplicate searchable memory"
    );
    assert.equal(
      memory.length,
      run.memory_commit.learned,
      "only one settlement applies the staged memory batch"
    );
    assert.equal(
      existsSync(pendingTaskApprovalPath(root, taskRunId)),
      false,
      "pending receipt clears after every durable side effect"
    );
    assert.equal(
      existsSync(decisionPath),
      true,
      "decision receipt is immutable audit evidence"
    );
    for (const harness of [first, second]) {
      assertSingleTerminal(harness.events, taskRunId, "task.completed");
      assert.equal(
        harness.events.filter(event => event.type === "approval.accepted")
          .length,
        1
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function staleConcurrentRejectCannotOverwriteAccept(modelUrl) {
  const root = mkdtempSync(join(tmpdir(), "crew-task-accept-reject-race-"));
  try {
    const { approval } = await createInterruptedPending(root, modelUrl);
    const winner = startTaskProcess({ root, modelUrl });
    const loser = startTaskProcess({ root, modelUrl });
    const [winnerApproval, loserApproval] = await Promise.all([
      winner.waitFor(
        "approval.requested",
        event => event.data?.id === approval.data.id
      ),
      loser.waitFor(
        "approval.requested",
        event => event.data?.id === approval.data.id
      ),
    ]);

    acceptApproval(winner, winnerApproval);
    await winner.waitFor("task.completed");
    rejectApproval(loser, loserApproval);
    const blocked = await loser.waitFor(
      "task.blocked",
      event => event.data?.reason_code === "task_settlement_already_accepted"
    );
    await Promise.all([finish(winner), finish(loser)]);

    const taskRunId = approval.data.taskRunId;
    const run = JSON.parse(
      readFileSync(join(root, ".crewclaw", "runs", `${taskRunId}.json`), "utf8")
    );
    assert.equal(blocked.data.recoverable, false);
    assert.equal(run.status, "accepted");
    assert.equal(run.memory_commit?.committed, true);
    assert.ok(existsSync(taskApprovalDecisionPath(root, taskRunId)));
    assert.equal(
      loser.events.some(event => event.type === "task.revision_needed"),
      false,
      "a stale delivered snapshot cannot overwrite the accepted winner"
    );
    assertSingleTerminal(winner.events, taskRunId, "task.completed");
    assertSingleTerminal(loser.events, taskRunId, "task.blocked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The Dream reviewer is a second, NON-STREAM model call carrying the crewclaw.dream/v1 contract;
// the mock server routes it to this canned review so accepted deliveries stage real candidates.
const DREAM_REVIEW = {
  summary: "复盘：官方来源可靠，交付结构完整。",
  new_memory_candidates: [
    {
      category: "reliable_sources",
      text: "https://www.volcengine.com/product/ark",
      confidence: "high",
    },
    {
      category: "project_facts",
      text: "Seed 2.1 调研已交付有效结果（官方文档交叉验证）",
      confidence: "medium",
    },
  ],
  new_playbook_candidates: [],
  confidence: "high",
  needs_user_review: true,
};

const model = await startMockModel([{ content: DELIVERABLE }], {
  dreamResponse: DREAM_REVIEW,
});
try {
  await acceptedDeliveryIsDurable(model.url);
  await rejectedDeliveryDoesNotWriteMemory(model.url);
  await eofRestoresSameApproval(model.url);
  await memoryCommitFailureRecoversAfterAcceptance(model.url);
  await changedOrDeletedArtifactFailsClosed(model.url, "changed");
  await changedOrDeletedArtifactFailsClosed(model.url, "deleted");
  await tamperedRecoveryBlocks(
    model.url,
    "future_protocol",
    "pending_approval_future_protocol"
  );
  await tamperedRecoveryBlocks(
    model.url,
    "corrupt_receipt",
    "pending_approval_corrupt"
  );
  await tamperedRecoveryBlocks(
    model.url,
    "wrong_run_artifact",
    "pending_approval_run_artifact_mismatch"
  );
  await tamperedRecoveryBlocks(
    model.url,
    "wrong_artifact_task",
    "pending_approval_artifact_task_mismatch"
  );
  await tamperedRecoveryBlocks(
    model.url,
    "double_pending",
    "pending_approval_ambiguous"
  );
  await decisionSettlementTamperingBlocks(model.url);
  await acceptedCrashCannotInjectMemory(model.url);
  await acceptedStateWithoutDecisionBlocks(model.url);
  await mismatchedDecisionReceiptBlocks(model.url);
  await concurrentRecoverySettlesExactlyOnce(model.url);
  await staleConcurrentRejectCannotOverwriteAccept(model.url);
  console.log("task mode approval transaction tests passed");
} finally {
  await model.close();
}
