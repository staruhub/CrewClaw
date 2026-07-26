// Approval lifecycle over the Ratatui JSONL boundary. Tool authorization and deliverable
// acceptance deliberately use different terminal events and must both correlate by approval id.
import assert from "node:assert/strict";
import {
  cpSync,
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
import { Readable, Writable } from "node:stream";
import {
  persistProofPackDurably,
  writeJsonDurably,
} from "../acceptance-transaction.mjs";
import { estimateCost } from "../budget-guard.mjs";
import { readKpi, recordTaskOutcome } from "../kpi.mjs";
import { assembleProofPack } from "../proofpack.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const LONG_REPORT =
  "# 服务器清理报告\n\n## 结论\n" +
  "建议按风险分级清理，并保留审计记录。\n".repeat(16);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, message, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail(message);
}

function harness(agentLoop, agentId, options = {}) {
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
  const root =
    options.root || mkdtempSync(join(tmpdir(), "crewclaw-approval-"));
  const done = startJsonlBridge({
    agentLoop,
    agentLoopDeps: { confirm: async () => true },
    meta: { mode: "Chat", agentId },
    input,
    output,
    root,
    artifactActionDeps: options.artifactActionDeps,
    proofPackWriter: options.proofPackWriter,
  });
  return {
    input,
    events,
    root,
    done,
    ofType(type) {
      return events.filter(event => event.type === type);
    },
  };
}

function resolveApproval(h, id, decision) {
  h.input.push(
    JSON.stringify({ type: "approval.resolve", data: { id, decision } }) + "\n"
  );
}

async function closeHarness(h) {
  h.input.push("/exit\n");
  await h.done;
  rmSync(h.root, { recursive: true, force: true });
}

async function toolAuthorizationCorrelatesById() {
  const h = harness(async deps => {
    deps.onDelta("准备执行敏感命令…");
    const allowed = await deps.confirm("执行命令: rm -rf ./tmp", {
      tool: "bash",
    });
    deps.onDelta(allowed ? "已执行" : "已取消");
    return allowed ? "done" : "skipped";
  }, "tool-approval-agent");

  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.required").length === 1,
    "tool approval was not requested"
  );
  const required = h.ofType("approval.required")[0];
  assert.equal(required.data.kind, "tool_authorization");

  resolveApproval(h, "wrong-id", "allow");
  await pause(50);
  assert.equal(
    h.ofType("approval.resolved").length,
    0,
    "wrong id must not resolve the pending tool"
  );
  assert.ok(
    !h.events
      .filter(event => event.type === "token.delta")
      .map(event => event.data.text || "")
      .join("")
      .includes("已执行")
  );

  resolveApproval(h, required.data.id, "allow_session");
  await pause(50);
  assert.equal(
    h.ofType("approval.resolved").length,
    0,
    "an unscoped tool must reject session authorization and stay pending"
  );

  resolveApproval(h, required.data.id, "allow");
  await waitFor(
    () =>
      h.events
        .filter(event => event.type === "token.delta")
        .map(event => event.data.text || "")
        .join("")
        .includes("已执行"),
    "matching tool approval did not resume the agent"
  );
  const resolved = h.ofType("approval.resolved")[0];
  assert.deepEqual(
    resolved.data,
    {
      id: required.data.id,
      taskRunId: required.data.taskRunId,
      kind: "tool_authorization",
      decision: "allow",
    },
    "tool resolution must preserve correlation and lifecycle kind"
  );
  assert.equal(
    h.ofType("approval.accepted").length,
    0,
    "tool authorization must not pollute acceptance KPI"
  );
  assert.equal(h.ofType("approval.rejected").length, 0);

  resolveApproval(h, required.data.id, "allow");
  await pause(50);
  assert.equal(
    h.ofType("approval.resolved").length,
    1,
    "stale tool action must not settle twice"
  );
  await closeHarness(h);
}

async function sessionPermissionLeaseScopesAuditsAndRevokes() {
  let call = 0;
  const paths = [
    "docs/spec/first.md",
    "docs/spec/second.md",
    "docs/spec/third.md",
  ];
  const h = harness(async deps => {
    const path = paths[call++];
    const allowed = await deps.confirm(`写入 ${path} ?`, {
      tool: "write_file",
      args: { path },
      scope: "workspace",
      level: "L2",
    });
    return allowed ? "ok" : "denied";
  }, "session-permission-agent");

  h.input.push("第一次写入\n");
  await waitFor(
    () => h.ofType("approval.required").length === 1,
    "first scoped approval was not requested"
  );
  const first = h.ofType("approval.required")[0];
  assert.deepEqual(first.data.choices, ["allow", "allow_session", "deny"]);
  assert.deepEqual(first.data.session_lease?.allowlist, [
    { tool: "write_file", pattern: "docs/spec/**" },
  ]);
  resolveApproval(h, first.data.id, "allow_session");
  await waitFor(
    () => h.ofType("task.completed").length === 1,
    "session-granted first task did not complete"
  );
  assert.equal(h.ofType("approval.resolved")[0].data.decision, "allow_session");
  assert.equal(
    h.ofType("approval.resolved")[0].data.decision_source,
    "user_session_grant"
  );

  h.input.push("同目录第二次写入\n");
  await waitFor(
    () => h.ofType("task.completed").length === 2,
    "matching session lease did not resume the repeated tool call"
  );
  const autoRequired = h.ofType("approval.required")[1];
  const autoResolved = h.ofType("approval.resolved")[1];
  assert.equal(autoRequired.data.auto, true);
  assert.equal(autoResolved.data.auto, true);
  assert.equal(autoResolved.data.decision, "allow_session");
  assert.equal(autoResolved.data.decision_source, "session_permission_lease");

  h.input.push("/permissions\n");
  await waitFor(
    () => h.ofType("command.output").length === 1,
    "session permission list command did not respond"
  );
  assert.match(
    h.ofType("command.output")[0].data.text,
    /write_file .* docs\/spec\/\*\*/
  );
  h.input.push("/permissions clear\n");
  await waitFor(
    () => h.ofType("command.output").length === 2,
    "session permission revoke command did not respond"
  );
  assert.match(h.ofType("command.output")[1].data.text, /已撤销 1 条/);

  h.input.push("撤销后第三次写入\n");
  await waitFor(
    () => h.ofType("approval.required").length === 3,
    "revoked lease must require approval again"
  );
  const third = h.ofType("approval.required")[2];
  assert.notEqual(third.data.auto, true);
  assert.equal(
    h.ofType("approval.resolved").length,
    2,
    "revoked lease must not auto-resolve"
  );
  resolveApproval(h, third.data.id, "deny");
  await waitFor(
    () => h.ofType("approval.resolved").length === 3,
    "final denial did not settle"
  );
  await closeHarness(h);
}

async function structuredDeliverableAcceptSettlesOnce() {
  const agentId = "deliverable-accept-agent";
  const h = harness(async () => LONG_REPORT, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  const requested = h.ofType("approval.requested")[0];
  const taskRunId = h.ofType("task.started")[0].data.id;
  assert.equal(
    taskRunId,
    requested.data.taskRunId,
    "task and approval ids share one correlation id"
  );
  assert.match(
    taskRunId,
    /^task-[0-9a-f-]{36}$/i,
    "task id uses a cross-process UUID"
  );
  assert.match(
    requested.data.id,
    /^delivery-appr-[0-9a-f-]{36}$/i,
    "approval id uses a cross-process UUID"
  );
  assert.equal(requested.data.kind, "deliverable_acceptance");
  assert.equal(
    h.ofType("task.completed").length,
    0,
    "held deliverable must not complete early"
  );

  resolveApproval(h, "wrong-delivery-id", "accept");
  await pause(50);
  assert.equal(
    h.ofType("approval.accepted").length,
    0,
    "wrong id must not accept a deliverable"
  );

  resolveApproval(h, requested.data.id, "allow_session");
  await pause(50);
  assert.equal(
    h.ofType("approval.accepted").length,
    0,
    "a tool-only session decision must not accept a deliverable"
  );
  assert.equal(
    h.ofType("approval.rejected").length,
    0,
    "a tool-only session decision must leave deliverable approval pending"
  );

  resolveApproval(h, requested.data.id, "banana");
  await pause(50);
  assert.equal(
    h.ofType("approval.rejected").length,
    0,
    "unknown decision must keep the approval pending"
  );

  resolveApproval(h, requested.data.id, "accept");
  await waitFor(
    () => h.ofType("task.completed").length === 1,
    "accepted deliverable did not complete"
  );
  const accepted = h.ofType("approval.accepted")[0];
  assert.equal(accepted.data.id, requested.data.id);
  assert.equal(accepted.data.taskRunId, requested.data.taskRunId);
  assert.equal(accepted.data.kind, "deliverable_acceptance");
  assert.ok(
    accepted.data.proofpack && existsSync(accepted.data.proofpack),
    "accept must persist a ProofPack"
  );
  assert.equal(
    readKpi(h.root, agentId).accepted,
    1,
    "accept must increment durable KPI exactly once"
  );

  resolveApproval(h, requested.data.id, "accept");
  await pause(50);
  assert.equal(
    h.ofType("approval.accepted").length,
    1,
    "duplicate accept must be stale"
  );
  assert.equal(
    h.ofType("task.completed").length,
    1,
    "duplicate accept must not complete twice"
  );
  assert.equal(
    readKpi(h.root, agentId).accepted,
    1,
    "duplicate accept must not increment KPI twice"
  );
  await closeHarness(h);
}

async function acceptedSkillUsageFlowsToKpi() {
  const agentId = "skill-kpi-agent";
  const h = harness(async deps => {
    deps.onSkillLaunched({ id: "skill-call-1", skill: "cleanup-guide" });
    deps.onSkillLaunched({ id: "skill-call-2", skill: "cleanup-guide" });
    return LONG_REPORT;
  }, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "skill-attributed deliverable did not reach approval"
  );
  const requested = h.ofType("approval.requested")[0];
  const pending = JSON.parse(
    readFileSync(
      join(
        h.root,
        ".crewclaw",
        "runs",
        `${requested.data.taskRunId}.pending-approval.json`
      ),
      "utf8"
    )
  );
  assert.deepEqual(pending.skillUsage, [
    { skill_id: "cleanup-guide", calls: 2 },
  ]);

  resolveApproval(h, requested.data.id, "accept");
  await waitFor(
    () => h.ofType("task.completed").length === 1,
    "skill-attributed acceptance did not settle"
  );
  const skill = readKpi(h.root, agentId).skills.find(
    item => item.skill_id === "cleanup-guide"
  );
  assert.equal(skill.calls, 2);
  assert.equal(skill.settled_tasks, 1);
  assert.equal(skill.accepted_tasks, 1);
  assert.equal(skill.success_rate, 1);
  assert.equal(skill.retirement_candidate, false);
  await closeHarness(h);
}

async function structuredDeliverableRejectIsAnHonestTerminal() {
  const agentId = "deliverable-reject-agent";
  const h = harness(async () => LONG_REPORT, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  const requested = h.ofType("approval.requested")[0];

  resolveApproval(h, requested.data.id, "reject");
  await waitFor(
    () => h.ofType("task.rejected").length === 1,
    "rejected deliverable lacked a terminal event"
  );
  const rejected = h.ofType("approval.rejected")[0];
  assert.equal(rejected.data.id, requested.data.id);
  assert.equal(rejected.data.taskRunId, requested.data.taskRunId);
  assert.equal(rejected.data.kind, "deliverable_acceptance");
  assert.equal(
    h.ofType("task.completed").length,
    0,
    "rejected delivery must never claim task.completed"
  );
  assert.equal(h.ofType("approval.accepted").length, 0);
  assert.equal(
    readKpi(h.root, agentId).accepted,
    0,
    "reject must not increment accepted KPI"
  );
  assert.equal(
    readKpi(h.root, agentId).tasks,
    1,
    "reject still settles the attempted task once"
  );
  const artifactUpdate = h.ofType("artifact.updated").at(-1);
  assert.equal(artifactUpdate?.data?.patch?.status, "rejected");

  resolveApproval(h, requested.data.id, "reject");
  await pause(50);
  assert.equal(
    h.ofType("approval.rejected").length,
    1,
    "stale reject must not settle twice"
  );
  assert.equal(h.ofType("task.rejected").length, 1);
  await closeHarness(h);
}

async function digitPendingActionRemainsCompatible() {
  const agentId = "digit-accept-agent";
  const h = harness(async () => LONG_REPORT, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );

  h.input.push("1\n");
  await waitFor(
    () => h.ofType("approval.accepted").length === 1,
    "digit PendingAction no longer accepts"
  );
  assert.equal(
    h.ofType("task.started").length,
    1,
    "digit acceptance must not create a synthetic task"
  );
  assert.equal(h.ofType("task.completed").length, 1);
  assert.equal(readKpi(h.root, agentId).accepted, 1);
  await closeHarness(h);
}

async function changedOrMissingArtifactCannotBeAccepted() {
  const agentId = "artifact-revalidation-agent";
  const h = harness(async () => LONG_REPORT, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  const requested = h.ofType("approval.requested")[0];
  const artifactPath = requested.data.artifacts[0].path;
  assert.equal(
    existsSync(artifactPath),
    true,
    "offered artifact exists before review"
  );
  rmSync(artifactPath, { force: true });

  resolveApproval(h, requested.data.id, "accept");
  await waitFor(
    () => h.ofType("task.rejected").length === 1,
    "missing artifact did not fail settlement"
  );
  assert.equal(h.ofType("approval.accepted").length, 0);
  assert.equal(h.ofType("task.completed").length, 0);
  assert.equal(
    readKpi(h.root, agentId).tasks,
    0,
    "validation failure must not write KPI"
  );
  const outcome = h.ofType("outcome.checked").at(-1);
  assert.equal(outcome.data.valid, false);
  assert.ok(
    outcome.data.gaps.some(code =>
      ["artifact_missing", "artifact_missing_or_empty"].includes(code)
    )
  );
  await closeHarness(h);
}

async function artifactsRootJunctionCannotBeAccepted() {
  const agentId = "artifact-junction-agent";
  const h = harness(async () => LONG_REPORT, agentId);
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "junction fixture approval was not requested"
  );
  const requested = h.ofType("approval.requested")[0];
  const artifactsRoot = join(h.root, ".crewclaw", "artifacts");
  const outside = mkdtempSync(join(tmpdir(), "crewclaw-artifacts-outside-"));
  cpSync(artifactsRoot, outside, { recursive: true });
  rmSync(artifactsRoot, { recursive: true, force: true });
  symlinkSync(
    outside,
    artifactsRoot,
    process.platform === "win32" ? "junction" : "dir"
  );

  resolveApproval(h, requested.data.id, "accept");
  await waitFor(
    () => h.ofType("task.rejected").length === 1,
    "junction-swapped artifact was not rejected"
  );
  assert.equal(h.ofType("approval.accepted").length, 0);
  assert.equal(readKpi(h.root, agentId).accepted, 0);
  assert.match(
    h.ofType("outcome.checked").at(-1)?.data?.gaps?.[0] || "",
    /artifact_(?:link_component|symlink_escape)/
  );
  await closeHarness(h);
  rmSync(outside, { recursive: true, force: true });
}

async function proofPackFailureCannotCompleteOrAffectKpi() {
  const agentId = "proofpack-failure-agent";
  const h = harness(async () => LONG_REPORT, agentId, {
    proofPackWriter: () => null,
  });
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  const requested = h.ofType("approval.requested")[0];
  resolveApproval(h, requested.data.id, "accept");
  await waitFor(
    () => h.ofType("task.rejected").length === 1,
    "ProofPack failure did not fail settlement"
  );
  assert.equal(h.ofType("approval.accepted").length, 0);
  assert.equal(h.ofType("task.completed").length, 0);
  assert.equal(
    readKpi(h.root, agentId).tasks,
    0,
    "ProofPack failure must not write KPI"
  );
  assert.equal(h.ofType("approval.rejected")[0].data.decision, "reject");
  assert.equal(
    h.ofType("approval.rejected")[0].data.reason_code,
    "proofpack_failed"
  );
  await closeHarness(h);
}

async function approvalEofPersistsAndRestores() {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-approval-resume-"));
  const agentId = "approval-resume-agent";
  const first = harness(async () => LONG_REPORT, agentId, { root });
  first.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => first.ofType("approval.requested").length === 1,
    "first approval was not requested"
  );
  const approvalId = first.ofType("approval.requested")[0].data.id;
  first.input.push(null);
  await first.done;
  assert.equal(
    first.ofType("task.blocked").at(-1)?.data?.recoverable,
    true,
    "EOF must leave a recoverable blocked terminal"
  );
  assert.equal(
    first.ofType("approval.rejected").at(-1)?.data?.decision,
    "reject"
  );
  assert.equal(
    first.ofType("approval.rejected").at(-1)?.data?.reason_code,
    "interrupted"
  );

  const second = harness(async () => LONG_REPORT, agentId, { root });
  await waitFor(
    () => second.ofType("approval.requested").length === 1,
    "pending approval was not restored"
  );
  const restored = second.ofType("approval.requested")[0];
  assert.equal(
    restored.data.id,
    approvalId,
    "recovery preserves approval correlation id"
  );
  assert.equal(restored.data.restored, true);
  resolveApproval(second, restored.data.id, "accept");
  await waitFor(
    () => second.ofType("task.completed").length === 1,
    "restored approval did not complete"
  );
  assert.equal(readKpi(root, agentId).accepted, 1);
  await closeHarness(second);
}

async function acceptedCrashRecoveryIsIdempotent() {
  for (const kpiAppliedBeforeCrash of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "crewclaw-approval-crash-"));
    const agentId = `approval-crash-${kpiAppliedBeforeCrash ? "kpi" : "pack"}`;
    const first = harness(async () => LONG_REPORT, agentId, { root });
    first.input.push("给我一份服务器清理报告\n");
    await waitFor(
      () => first.ofType("approval.requested").length === 1,
      "crash fixture approval was not requested"
    );
    const requested = first.ofType("approval.requested")[0];
    first.input.push(null);
    await first.done;

    const pendingPath = join(
      root,
      ".crewclaw",
      "runs",
      `${requested.data.taskRunId}.pending-approval.json`
    );
    const held = JSON.parse(readFileSync(pendingPath, "utf8"));
    const decisionAt = held.createdAt + 1;
    const decisionPath = join(
      root,
      ".crewclaw",
      "runs",
      `${held.taskRunId}.approval-decision.json`
    );
    assert.equal(
      writeJsonDurably(
        decisionPath,
        {
          version: 1,
          id: held.id,
          taskRunId: held.taskRunId,
          agentId: held.agentId,
          decision: "accept",
          decisionAt,
          fingerprintSha256: held.fingerprint.sha256,
          auto: false,
        },
        { root }
      ).ok,
      true
    );
    const pack = assembleProofPack({
      task_run_id: held.taskRunId,
      user_goal: held.goal,
      artifacts: [{ ...held.artifact, fingerprint: held.fingerprint }],
      outcome_checks: [
        {
          valid: true,
          deliverable: held.artifact.path,
          fingerprint: held.fingerprint,
        },
      ],
      approval: { decision: "accept", at: decisionAt },
      usage: held.usage,
    });
    assert.equal(
      persistProofPackDurably({ root, taskRunId: held.taskRunId, pack }).ok,
      true,
      "simulated process wrote ProofPack before crashing"
    );
    if (kpiAppliedBeforeCrash) {
      const cost = estimateCost({
        promptTokens: held.usage.prompt,
        completionTokens: held.usage.completion,
      }).cost;
      recordTaskOutcome(root, agentId, {
        accepted: true,
        cost,
        taskRunId: held.taskRunId,
      });
    }

    const restarted = harness(async () => LONG_REPORT, agentId, { root });
    await waitFor(
      () => restarted.ofType("task.completed").length === 1,
      "durable accept decision was not resumed to completion"
    );
    assert.equal(restarted.ofType("approval.accepted").length, 1);
    assert.equal(
      readKpi(root, agentId).accepted,
      1,
      "ProofPack/KPI crash retry settles KPI exactly once"
    );
    assert.equal(existsSync(pendingPath), false, "pending receipt clears last");
    assert.equal(
      existsSync(decisionPath),
      false,
      "decision receipt clears last"
    );
    await closeHarness(restarted);
  }
}

async function unsupportedOrAmbiguousReceiptsBlockRecovery() {
  const futureRoot = mkdtempSync(join(tmpdir(), "crewclaw-approval-future-"));
  const futureAgent = "approval-future-agent";
  const runs = join(futureRoot, ".crewclaw", "runs");
  mkdirSync(runs, { recursive: true });
  writeFileSync(
    join(runs, "task-future.pending-approval.json"),
    JSON.stringify({
      version: 2,
      status: "pending",
      id: "approval-future",
      taskRunId: "task-future",
      agentId: futureAgent,
    })
  );
  const future = harness(async () => LONG_REPORT, futureAgent, {
    root: futureRoot,
  });
  assert.match(
    future.ofType("task.blocked")[0]?.data?.reason || "",
    /version_unsupported/,
    "future receipt version fails closed instead of disappearing"
  );
  await closeHarness(future);

  const unsafeRoot = mkdtempSync(join(tmpdir(), "crewclaw-approval-unsafe-"));
  const unsafeAgent = "approval-unsafe-agent";
  const unsafeRuns = join(unsafeRoot, ".crewclaw", "runs");
  mkdirSync(unsafeRuns, { recursive: true });
  writeFileSync(
    join(unsafeRuns, "unsafe.pending-approval.json"),
    JSON.stringify({
      version: 1,
      status: "pending",
      id: "approval-unsafe",
      taskRunId: "../unsafe",
      agentId: unsafeAgent,
      root: unsafeRoot,
      goal: "unsafe receipt must not alias a safe filename",
      artifact: { artifact_id: "artifact-unsafe", path: "unused" },
      fingerprint: { ok: true, path: "unused" },
      usage: {},
      createdAt: 1,
    })
  );
  const unsafe = harness(async () => LONG_REPORT, unsafeAgent, {
    root: unsafeRoot,
  });
  assert.match(
    unsafe.ofType("task.blocked")[0]?.data?.reason || "",
    /pending_approval_scan_failed/,
    "unsafe taskRunId cannot alias a sanitized approval receipt path"
  );
  await closeHarness(unsafe);

  const ambiguousRoot = mkdtempSync(
    join(tmpdir(), "crewclaw-approval-ambiguous-")
  );
  const ambiguousAgent = "approval-ambiguous-agent";
  const first = harness(async () => LONG_REPORT, ambiguousAgent, {
    root: ambiguousRoot,
  });
  first.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => first.ofType("approval.requested").length === 1,
    "ambiguous fixture approval was not requested"
  );
  first.input.push(null);
  await first.done;
  const firstTaskId = first.ofType("approval.requested")[0].data.taskRunId;
  const firstPath = join(
    ambiguousRoot,
    ".crewclaw",
    "runs",
    `${firstTaskId}.pending-approval.json`
  );
  const secondReceipt = JSON.parse(readFileSync(firstPath, "utf8"));
  secondReceipt.taskRunId = `${firstTaskId}-second`;
  writeFileSync(
    join(
      ambiguousRoot,
      ".crewclaw",
      "runs",
      `${secondReceipt.taskRunId}.pending-approval.json`
    ),
    JSON.stringify(secondReceipt)
  );
  const ambiguous = harness(async () => LONG_REPORT, ambiguousAgent, {
    root: ambiguousRoot,
  });
  assert.match(
    ambiguous.ofType("task.blocked")[0]?.data?.reason || "",
    /pending_approval_ambiguous/,
    "multiple receipts fail closed instead of choosing the newest"
  );
  await closeHarness(ambiguous);
}

async function approvalReceiptsRejectLinkedState() {
  const container = mkdtempSync(join(tmpdir(), "crewclaw-approval-links-"));
  try {
    const junctionRoot = join(container, "junction-workspace");
    const outsideRuns = join(container, "outside-runs");
    mkdirSync(join(junctionRoot, ".crewclaw"), { recursive: true });
    mkdirSync(outsideRuns);
    symlinkSync(
      outsideRuns,
      join(junctionRoot, ".crewclaw", "runs"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const junction = harness(
      async () => LONG_REPORT,
      "approval-junction-agent",
      { root: junctionRoot }
    );
    assert.match(
      junction.ofType("task.blocked")[0]?.data?.reason || "",
      /pending_approval_scan_failed/,
      "approval recovery rejects a runs parent junction"
    );
    junction.input.push("/exit\n");
    await junction.done;
    assert.deepEqual(
      existsSync(join(outsideRuns, ".delivery-approval.lock")),
      false,
      "the bridge never creates a lock through the junction"
    );

    const decisionRoot = join(container, "decision-workspace");
    mkdirSync(decisionRoot);
    const decision = harness(
      async () => LONG_REPORT,
      "approval-hardlink-agent",
      { root: decisionRoot }
    );
    decision.input.push("给我一份服务器清理报告\n");
    await waitFor(
      () => decision.ofType("approval.requested").length === 1,
      "hardlink fixture approval was not requested"
    );
    const requested = decision.ofType("approval.requested")[0];
    const outsideDecision = join(container, "outside-decision.json");
    const decisionPath = join(
      decisionRoot,
      ".crewclaw",
      "runs",
      `${requested.data.taskRunId}.approval-decision.json`
    );
    writeFileSync(outsideDecision, '{"outside":true}\n');
    linkSync(outsideDecision, decisionPath);
    const outsideBefore = readFileSync(outsideDecision, "utf8");
    resolveApproval(decision, requested.data.id, "accept");
    await waitFor(
      () =>
        decision
          .ofType("debug.line")
          .some(event => /验收决策无法持久化/.test(event.data?.line || "")),
      "unsafe decision receipt was not reported"
    );
    assert.equal(decision.ofType("task.completed").length, 0);
    assert.equal(
      decision.ofType("approval.accepted").length,
      0,
      "an unsafe decision receipt keeps the approval pending"
    );
    assert.equal(readFileSync(outsideDecision, "utf8"), outsideBefore);
    decision.input.push("/exit\n");
    await decision.done;
    assert.equal(decision.ofType("task.rejected").length, 1);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
}

async function toolApprovalEofDeniesAndUnblocksWaiter() {
  let resumed = false;
  const h = harness(async deps => {
    const allowed = await deps.confirm("执行受控命令", { tool: "bash" });
    resumed = true;
    return allowed ? "allowed" : "denied";
  }, "tool-eof-agent");
  h.input.push("执行一个受控任务\n");
  await waitFor(
    () => h.ofType("approval.required").length === 1,
    "tool approval was not requested"
  );
  const required = h.ofType("approval.required")[0];
  h.input.push(null);
  await h.done;
  await pause(30);
  assert.equal(resumed, true, "EOF must resolve the pending tool waiter");
  const resolved = h.ofType("approval.resolved")[0];
  assert.equal(resolved.data.id, required.data.id);
  assert.equal(resolved.data.taskRunId, required.data.taskRunId);
  assert.equal(resolved.data.decision, "deny");
  const blocked = h.ofType("task.blocked")[0];
  assert.equal(blocked.data.id, required.data.taskRunId);
  assert.equal(h.ofType("task.completed").length, 0);
  rmSync(h.root, { recursive: true, force: true });
}

async function explicitExitCancelsPendingApprovalAndReturns() {
  const h = harness(async () => LONG_REPORT, "explicit-exit-agent");
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  h.input.push("/exit\n");
  await Promise.race([
    h.done,
    pause(1_000).then(() =>
      assert.fail("explicit /exit left the bridge process waiting")
    ),
  ]);
  const rejected = h.ofType("approval.rejected")[0];
  assert.equal(rejected.data.decision, "reject");
  assert.equal(rejected.data.reason_code, "interrupted");
  assert.equal(
    rejected.data.recoverable,
    false,
    "explicit exit is cancellation, not automatic resume"
  );
  assert.equal(h.ofType("task.rejected").length, 1);

  const restarted = harness(async () => "好的。", "explicit-exit-agent", {
    root: h.root,
  });
  assert.equal(
    restarted.ofType("approval.requested").length,
    0,
    "explicitly cancelled approval must not resurrect"
  );
  restarted.input.push("/exit\n");
  await restarted.done;
  rmSync(h.root, { recursive: true, force: true });
}

async function legacyRevealAndReviseRemainUsable() {
  const agentId = "legacy-review-actions-agent";
  const h = harness(async () => LONG_REPORT, agentId, {
    artifactActionDeps: { executeReveal: () => ({ ok: true }) },
  });
  h.input.push("给我一份服务器清理报告\n");
  await waitFor(
    () => h.ofType("approval.requested").length === 1,
    "deliverable approval was not requested"
  );
  const firstApproval = h.ofType("approval.requested")[0];

  h.input.push("3\n");
  await waitFor(
    () => h.ofType("artifact.revealed").length === 1,
    "legacy reveal was not executed"
  );
  assert.equal(h.ofType("artifact.revealed")[0].data.ok, true);
  assert.equal(
    h.ofType("task.rejected").length,
    0,
    "reveal must keep approval pending"
  );

  h.input.push("2\n");
  await waitFor(
    () => h.ofType("task.started").length === 2,
    "legacy revise did not start a revision task"
  );
  await waitFor(
    () => h.ofType("approval.requested").length === 2,
    "revision did not produce a new reviewable artifact"
  );
  assert.equal(h.ofType("approval.rejected")[0].data.id, firstApproval.data.id);
  assert.equal(h.ofType("approval.rejected")[0].data.decision, "reject");
  assert.equal(h.ofType("approval.rejected")[0].data.reason_code, "revise");
  const secondApproval = h.ofType("approval.requested")[1];
  assert.notEqual(
    secondApproval.data.id,
    firstApproval.data.id,
    "revision gets a collision-safe approval id"
  );
  resolveApproval(h, secondApproval.data.id, "reject");
  await waitFor(
    () => h.ofType("task.rejected").length === 2,
    "revision rejection did not settle"
  );
  await closeHarness(h);
}

async function malformedUserActionDoesNotCrashBridge() {
  const h = harness(async () => "好的。", "malformed-action-agent");
  h.input.push('{"type":"artifact.delete"}\n');
  await waitFor(
    () => h.ofType("debug.line").length === 1,
    "malformed action was not reported"
  );
  h.input.push("你好\n");
  await waitFor(
    () => h.ofType("task.completed").length === 1,
    "bridge stopped after malformed action"
  );
  await closeHarness(h);
}

async function main() {
  await toolAuthorizationCorrelatesById();
  await sessionPermissionLeaseScopesAuditsAndRevokes();
  await structuredDeliverableAcceptSettlesOnce();
  await acceptedSkillUsageFlowsToKpi();
  await structuredDeliverableRejectIsAnHonestTerminal();
  await digitPendingActionRemainsCompatible();
  await changedOrMissingArtifactCannotBeAccepted();
  await artifactsRootJunctionCannotBeAccepted();
  await proofPackFailureCannotCompleteOrAffectKpi();
  await approvalEofPersistsAndRestores();
  await acceptedCrashRecoveryIsIdempotent();
  await unsupportedOrAmbiguousReceiptsBlockRecovery();
  await approvalReceiptsRejectLinkedState();
  await toolApprovalEofDeniesAndUnblocksWaiter();
  await explicitExitCancelsPendingApprovalAndReturns();
  await legacyRevealAndReviseRemainUsable();
  await malformedUserActionDoesNotCrashBridge();
  console.log("tui-jsonl-approval tests passed");
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
