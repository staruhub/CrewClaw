// e2e-approval-policy.test.mjs — v0.18 C4: the SETTINGS approval policy (.crewclaw/prefs.json) is
// now honored by the engine. Drives the real jsonl-bridge with injected streams and asserts the
// deliverable terminal shape changes with the policy — without breaking the default manual gate.
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import {
  APPROVAL_ALL_DELIVERIES,
  readApprovalPolicy,
  readPrefs,
} from "../tui/prefs.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const LONG_REPORT =
  "# ROI 评估报告\n\n## 结论\n" +
  "该方案预计 6 个月回本，建议采购。\n".repeat(12);

// Fresh isolated root; optionally seed prefs.json (approval policy) and a KPI accepted count.
function makeRoot({ approval, accepted } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crew-approval-"));
  if (approval !== undefined) {
    fs.mkdirSync(path.join(root, ".crewclaw"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".crewclaw", "prefs.json"),
      JSON.stringify({ approval })
    );
  }
  if (accepted !== undefined) {
    fs.mkdirSync(path.join(root, ".crewclaw", "kpi"), { recursive: true });
    // KPI v2 is an append-only formal-outcome ledger. Trust is earned from real
    // user-accepted formal outcomes, not the legacy chat counter shape.
    const outcomes = Array.from({ length: accepted }, (_, index) => ({
      id: `seed-outcome-${index + 1}`,
      task_run_id: `seed-task-${index + 1}`,
      task_kind: "formal",
      outcome: "accepted",
      acceptance_source: "user",
      cost_usd: 0,
      duration_ms: 1,
      evidence_count: 1,
      permission_violations: 0,
      safety_violations: 0,
      ts: index + 1,
    }));
    fs.writeFileSync(
      path.join(root, ".crewclaw", "kpi", "policy-agent.json"),
      JSON.stringify({
        contract: "crewclaw.kpi/v2",
        employee_id: "policy-agent",
        first_hired_ts: 1,
        legacy: {
          unclassified_tasks: 0,
          accepted_claims: 0,
          total_cost: 0,
        },
        outcomes,
      })
    );
  }
  return root;
}

async function runDeliverable(root) {
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
    agentLoop: async () => LONG_REPORT,
    meta: { mode: "Chat", agentId: "policy-agent" },
    input,
    output,
    root,
  });
  await sleep(20);
  input.push("给我一份内部知识问答ROI示例\n");
  await sleep(180);
  const types = events.map(e => e.type);
  input.push("/exit\n");
  await sleep(20);
  await done;
  return { events, types };
}

async function defaultPolicyHoldsForManualApproval() {
  const { types } = await runDeliverable(makeRoot()); // no prefs.json → default (manual)
  assert.ok(types.includes("artifact.created"), "deliverable produced");
  assert.ok(
    types.includes("approval.requested"),
    "default policy holds the deliverable for manual accept"
  );
  assert.ok(
    !types.includes("task.completed"),
    "held deliverable does not auto-complete"
  );
  assert.ok(
    !types.includes("approval.accepted"),
    "no auto-accept under the default policy"
  );
  console.log(
    "  ✓ default approval policy = manual gate (unchanged; conformance-safe)"
  );
}

async function trustAutoBelowThresholdStillAsks() {
  const { types } = await runDeliverable(
    makeRoot({ approval: 1, accepted: 1 })
  );
  assert.ok(
    types.includes("approval.requested"),
    "信任后自动 below the trust threshold still asks"
  );
  assert.ok(
    !types.includes("approval.accepted"),
    "no auto-accept before trust is earned"
  );
  console.log(
    "  ✓ 信任后自动 below threshold (accepted<3) still requires manual approval"
  );
}

async function trustAutoAboveThresholdAutoAccepts() {
  const { events, types } = await runDeliverable(
    makeRoot({ approval: 1, accepted: 3 })
  );
  assert.ok(types.includes("artifact.created"), "deliverable still produced");
  assert.ok(
    types.includes("approval.accepted"),
    "信任后自动 auto-accepts once trust is earned"
  );
  assert.ok(
    types.includes("task.completed"),
    "auto-accepted task completes without a keystroke"
  );
  assert.ok(
    !types.includes("approval.requested"),
    "no manual gate once auto-accepted"
  );
  const acc = events.find(e => e.type === "approval.accepted");
  assert.equal(
    acc.data.auto,
    true,
    "the auto-accept is flagged (transparent), and carries a proofpack"
  );
  assert.ok(
    acc.data.proofpack,
    "auto-accept still writes a ProofPack — the record stays complete"
  );
  console.log(
    "  ✓ 信任后自动 above threshold auto-accepts with full approval.accepted stream + ProofPack"
  );
}

function prefsRejectLinkedState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crew-prefs-guard-"));
  try {
    const junctionRoot = path.join(root, "junction-root");
    const outsideCrew = path.join(root, "outside-crew");
    fs.mkdirSync(junctionRoot);
    fs.mkdirSync(outsideCrew);
    fs.writeFileSync(
      path.join(outsideCrew, "prefs.json"),
      JSON.stringify({ approval: 1 })
    );
    fs.symlinkSync(
      outsideCrew,
      path.join(junctionRoot, ".crewclaw"),
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.deepEqual(readPrefs(junctionRoot), {});
    assert.equal(
      readApprovalPolicy(junctionRoot),
      APPROVAL_ALL_DELIVERIES,
      "unsafe prefs parent fails closed to manual approval"
    );

    const hardRoot = path.join(root, "hardlink-root");
    fs.mkdirSync(path.join(hardRoot, ".crewclaw"), { recursive: true });
    const outsidePrefs = path.join(root, "outside-prefs.json");
    const hardPrefs = path.join(hardRoot, ".crewclaw", "prefs.json");
    fs.writeFileSync(outsidePrefs, JSON.stringify({ approval: 1 }));
    fs.linkSync(outsidePrefs, hardPrefs);
    assert.deepEqual(readPrefs(hardRoot), {});
    assert.equal(readApprovalPolicy(hardRoot), APPROVAL_ALL_DELIVERIES);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("  ✓ prefs rejects parent junctions and final hardlinks");
}

async function main() {
  console.log(
    "e2e-approval-policy: SETTINGS approval policy is honored end to end"
  );
  await defaultPolicyHoldsForManualApproval();
  await trustAutoBelowThresholdStillAsks();
  await trustAutoAboveThresholdAutoAccepts();
  prefsRejectLinkedState();
  console.log("e2e-approval-policy tests passed");
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  }
);
