// Renders the real ChatApp (workbench / TaskRun model) via ink-testing-library and drives a
// turn through a fake runTurn that streams via the bridge sink, asserting the frames: user
// turn → work timeline + answer → session tokens. No TTY.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import htm from "htm";
import { render } from "ink-testing-library";
import { ChatApp, interruptChatTurn } from "../tui/chat.mjs";
import { EVENTS } from "../tui/protocol.mjs";
import { createWorkbenchStore } from "../tui/workbench-store.mjs";

const html = htm.bind(React.createElement);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stub = text =>
  String(text)
    .split("\n")
    .map(l => "   " + l);

// fake engine turn: streams an answer + one tool through the bridge sink
const runTurn = async (text, sink) => {
  sink.onDelta("我先搜一下");
  sink.onInvocation({
    toolName: "web_search",
    args: { query: text },
    output: "（3 条结果）",
    line: `🔎 "${text}" (3 条)`,
    status: "success",
  });
  sink.onUsage({ prompt_tokens: 500, completion_tokens: 100 });
};

const store = createWorkbenchStore({ employee: { name: "鲸" }, mode: "Chat" });
const submitRef = { current: null };
const out = render(
  html`<${ChatApp}
    store=${store}
    runTurn=${runTurn}
    agentName="鲸"
    renderLines=${stub}
    submitRef=${submitRef}
    meta=${{ model: "anthropic/claude-opus-4.8" }}
  />`
);
const all = () => out.frames.join("\n");

await sleep(20);
assert.match(out.lastFrame(), /就绪/, "idle status before any turn");

// a formal task → the Router upgrades it to a TaskRun and runs the model turn
await submitRef.current("给我一份内部知识问答 ROI 报告");
await sleep(90);
assert.match(all(), /ROI 报告/, "user turn rendered");
assert.match(all(), /我先搜一下/, "answer text rendered (the model turn ran)");
assert.match(
  all(),
  /🔎|ROI/,
  "tool lands as a timeline line with its result summary"
);
assert.match(
  out.lastFrame(),
  /600\/90k tok/,
  "session usage + context budget (used/hard) in the status header"
);
assert.match(out.lastFrame(), /就绪/, "back to idle after the turn");
assert.equal(store.get().live, null, "live turn cleared after commit");
assert.equal(store.get().turns.length, 2, "user + assistant turn committed");
assert.equal(store.get().turns[1].app.generation.status, "completed");
assert.equal(
  store.get().turns[1].app.task.status,
  "needs_artifact",
  "a formal task with no deliverable cannot be marked done"
);

// Store settlement preserves a produced artifact for review instead of auto-completing it.
{
  const reviewStore = createWorkbenchStore({ mode: "Task" });
  const reviewRun = reviewStore.startTurn({ title: "review", mode: "Task" });
  reviewRun.emit(EVENTS.ARTIFACT_CREATED, {
    id: "review-artifact",
    path: "/x/review.md",
  });
  reviewRun.emit(EVENTS.OUTCOME_CHECKED, {
    valid: true,
    deliverable: "/x/review.md",
  });
  reviewStore.commitTurn(reviewRun, {
    awaitingAcceptance: true,
    artifact: { artifact_id: "review-artifact" },
  });
  const review = reviewStore.get().turns.at(-1).app;
  assert.equal(review.generation.status, "completed");
  assert.equal(review.approval.kind, "deliverable_acceptance");
  assert.equal(review.taskStreamTerminal, false);
}

// a quick utility (天气) shows the ⚡ badge — visibly NOT a TaskRun / 不计绩效 (§5.3/§6.2)
await submitRef.current("杭州天气?");
await sleep(90);
assert.match(
  all(),
  /快捷工具/,
  "quick utility shows a distinct ⚡ badge (not counted as employee work)"
);

out.unmount();

// Ctrl+C cancels the active generation first (with a real AbortSignal); only an idle Ctrl+C exits.
{
  let exited = false;
  let observedSignal = null;
  const cancelStore = createWorkbenchStore({ mode: "Chat" });
  const cancelSubmitRef = { current: null };
  const cancelOut = render(
    html`<${ChatApp}
      store=${cancelStore}
      runTurn=${async (_text, sink) => {
        observedSignal = sink.signal;
        await new Promise((resolve, reject) => {
          sink.signal.addEventListener(
            "abort",
            () => reject(sink.signal.reason),
            {
              once: true,
            }
          );
        });
      }}
      agentName="鲸"
      renderLines=${stub}
      submitRef=${cancelSubmitRef}
    />`
  );
  await sleep(20);
  const pending = cancelSubmitRef.current("取消这一轮");
  await sleep(20);
  assert.equal(
    interruptChatTurn(cancelStore, cancelStore.get(), () => {
      exited = true;
    }),
    true
  );
  await pending;
  assert.equal(observedSignal.aborted, true);
  assert.equal(exited, false);
  assert.equal(
    cancelStore.get().turns.at(-1).app.generation.status,
    "cancelled"
  );
  assert.equal(cancelStore.get().turns.at(-1).app.task.status, "blocked");
  interruptChatTurn(cancelStore, cancelStore.get(), () => {
    exited = true;
  });
  assert.equal(exited, true);
  cancelOut.unmount();
}

// A cancelled turn that resolves late cannot commit or overwrite a newer active turn.
{
  const isolated = createWorkbenchStore({ mode: "Chat" });
  const first = isolated.startTurn({ title: "first", mode: "Chat" });
  isolated.cancelTurn("cancel first", first);
  const second = isolated.startTurn({ title: "second", mode: "Chat" });
  assert.equal(isolated.commitTurn(first), false);
  assert.equal(isolated.get().live.task.id, second.get().task.id);
  isolated.cancelTurn("cleanup", second);
}

// A committed deliverable keeps its original TaskRun alive for the later digit decision. The
// acceptance/revision events must update that committed snapshot, never a throwaway second run.
async function deliveryDecision(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crew-ink-delivery-"));
  const previousRoot = process.env.CREWCLAW_ROOT;
  process.env.CREWCLAW_ROOT = root;
  const decisionStore = createWorkbenchStore({ mode: "Task" });
  const decisionSubmitRef = { current: null };
  const modelInputs = [];
  const decisionOut = render(
    html`<${ChatApp}
      store=${decisionStore}
      runTurn=${async (message, sink) => {
        modelInputs.push(message);
        const answer = `# 内部知识问答 ROI 报告\n\n- 请求：${message}\n- 结论：值得推进。`;
        sink.onDelta(answer);
        return answer;
      }}
      agentName="鲸"
      renderLines=${stub}
      submitRef=${decisionSubmitRef}
      meta=${{ mode: "Task" }}
    />`
  );
  try {
    await sleep(20);
    await decisionSubmitRef.current("生成一份内部知识问答 ROI 报告");
    const offeredState = decisionStore.get();
    const offeredTurn = offeredState.turns.find(
      turn => turn.role === "assistant"
    );
    assert.ok(
      offeredTurn?.app.approval,
      "deliverable is held for later acceptance"
    );
    assert.equal(offeredState.sessionPendingActions[0]?.key, "1");
    assert.equal(offeredState.sessionPendingActions[1]?.key, "2");
    const originalTaskRunId = offeredTurn.app.task.id;
    const approvalId = offeredTurn.app.approval.id;

    await decisionSubmitRef.current(key);
    const settledState = decisionStore.get();
    const original = settledState.turns.find(
      turn => turn.app?.task?.id === originalTaskRunId
    ).app;
    return {
      original,
      approvalId,
      modelInputs,
      assistantTurns: settledState.turns.filter(
        turn => turn.role === "assistant"
      ),
      sessionPendingActions: settledState.sessionPendingActions,
    };
  } finally {
    decisionOut.unmount();
    if (previousRoot === undefined) delete process.env.CREWCLAW_ROOT;
    else process.env.CREWCLAW_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const accepted = await deliveryDecision("1");
  assert.equal(accepted.original.task.status, "done");
  assert.equal(accepted.original.taskStreamTerminal, true);
  assert.equal(accepted.original.approval, null);
  assert.equal(
    accepted.original.settledApprovals[accepted.approvalId],
    "accepted"
  );
  assert.equal(accepted.original.acceptedCount, 1);
  assert.equal(accepted.original.artifacts[0].status, "accepted");
  assert.equal(accepted.original.pendingActions.length, 0);
  assert.equal(accepted.sessionPendingActions.length, 0);
  assert.equal(
    accepted.assistantTurns.length,
    1,
    "accept does not create a throwaway TaskRun"
  );
  assert.equal(
    accepted.original.debug.some(line => /uncorrelated|mismatched/.test(line)),
    false,
    "approval.accepted correlated with the original committed TaskRun"
  );
}

{
  const revised = await deliveryDecision("2");
  assert.equal(revised.original.task.status, "needs_revision");
  assert.equal(revised.original.taskStreamTerminal, true);
  assert.equal(revised.original.approval, null);
  assert.equal(
    revised.original.settledApprovals[revised.approvalId],
    "rejected"
  );
  assert.equal(revised.original.artifacts[0].status, "revision_needed");
  assert.equal(revised.original.pendingActions.length, 0);
  assert.equal(revised.sessionPendingActions.length, 0);
  assert.equal(
    revised.assistantTurns.length,
    2,
    "revision starts one fresh follow-up TaskRun"
  );
  assert.equal(revised.modelInputs.length, 2);
  assert.match(revised.modelInputs[1], /请根据我的反馈修订/);
  assert.equal(
    revised.original.debug.some(line => /uncorrelated|mismatched/.test(line)),
    false,
    "approval.rejected correlated with the original committed TaskRun"
  );
}

console.log("tui-chat tests passed");
