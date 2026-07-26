// e2e-kpi-persistence.test.mjs — v0.17 P2 C1 bridge-level regression: cumulative KPI must
// survive across separate process/session boundaries, exactly like the plan's own acceptance
// bar ("两次会话跨进程验证累计"). We can't literally fork two OS processes here, but we CAN
// spin up two independent startJsonlBridge() runs against the same root + agentId — each run
// gets its own fresh in-memory bridge state (busy/pendingApproval/usageAcc all reset), which is
// exactly what a second `crew chat <expert>` invocation looks like from the KPI file's point of
// view. Only `.crewclaw/kpi/<agentId>.json` on disk carries state between the two runs.
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { readKpi } from "../kpi.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function assertEmptyKpi(kpi, message) {
  assert.equal(kpi.contract, "crewclaw.kpi/v2", message);
  assert.equal(kpi.tasks, 0, message);
  assert.equal(kpi.accepted, 0, message);
  assert.equal(kpi.auto_accepted, 0, message);
  assert.equal(kpi.chat_turns, 0, message);
  assert.equal(kpi.total_cost, 0, message);
  assert.equal(kpi.first_hired_ts, null, message);
}

function makeBridge({ root, agentId, reply }) {
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
    agentLoop: async () => reply,
    meta: { mode: "Chat", agentId },
    input,
    output,
    root,
  });
  return {
    events,
    types: () => events.map(e => e.type),
    send: line => input.push(line + "\n"),
    exit: async () => {
      input.push("/exit\n");
      await sleep(20);
      await done;
    },
  };
}

// one full turn: produce a deliverable, then accept it with the bare pending-action "1"
// (same two-line shape as conformance vector #11, CC-PROOF-001).
async function runOneAcceptedTask(root, agentId) {
  const longReport =
    "# ROI 评估报告\n\n## 结论\n" +
    "该方案预计 6 个月回本，建议采购。\n".repeat(12);
  const b = makeBridge({ root, agentId, reply: longReport });
  await sleep(20);
  b.send("帮我写一份ROI评估报告");
  await sleep(150);
  b.send("1");
  await sleep(150);
  const t = b.types();
  assert.ok(
    t.includes("approval.accepted"),
    `deliverable must be accepted; got ${t.join(",")}`
  );
  assert.ok(t.includes("task.completed"), "accept settles to task.completed");
  await b.exit();
  return b.events;
}

async function cumulativeKpiSurvivesAcrossSessions() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-kpi-"));
  const agentId = "e2e-kpi-whale";
  const hiredAt = "2026-07-14T00:00:00Z";
  fs.mkdirSync(path.join(root, ".crewclaw"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".crewclaw", "team.json"),
    `${JSON.stringify(
      [
        {
          workspace_employee_id: "e2e-kpi-hire",
          employee_id: agentId,
          version: "test",
          status: "active",
          hired_at: hiredAt,
          fired_at: null,
          permissions_granted: [],
          package_sha256: null,
          hire_source: "test_fixture",
        },
      ],
      null,
      2
    )}\n`,
    "utf8"
  );

  // ── session 1: a brand-new employee has no prior history ──────────────────────────────────
  const events1 = await runOneAcceptedTask(root, agentId);
  const ready1 = events1.find(e => e.type === "session.ready");
  assertEmptyKpi(
    ready1.data.employee.kpi_cumulative,
    "first-ever session sees honest zeros, not fabricated history"
  );
  const afterSession1 = readKpi(root, agentId);
  assert.equal(
    afterSession1.tasks,
    1,
    "session 1's accepted task is persisted"
  );
  assert.equal(afterSession1.accepted, 1);
  assert.ok(
    afterSession1.first_hired_ts,
    "first_hired_ts projects the durable active hire"
  );
  assert.equal(afterSession1.first_hired_ts, Date.parse(hiredAt));

  // ── session 2: a NEW bridge process against the SAME root — must see session 1's numbers ──
  const events2 = await runOneAcceptedTask(root, agentId);
  const ready2 = events2.find(e => e.type === "session.ready");
  assert.equal(
    ready2.data.employee.kpi_cumulative.tasks,
    1,
    "session 2 starts by seeing session 1's cumulative tasks"
  );
  assert.equal(
    ready2.data.employee.kpi_cumulative.accepted,
    1,
    "session 2 starts by seeing session 1's cumulative accepts"
  );
  assert.equal(
    ready2.data.employee.kpi_cumulative.first_hired_ts,
    afterSession1.first_hired_ts,
    "first_hired_ts carries forward unchanged into session 2"
  );

  // ── after session 2's own accept, the file reflects BOTH sessions summed ───────────────────
  const afterSession2 = readKpi(root, agentId);
  assert.equal(
    afterSession2.tasks,
    2,
    "cumulative tasks = session 1 + session 2"
  );
  assert.equal(
    afterSession2.accepted,
    2,
    "cumulative accepted = session 1 + session 2"
  );
  assert.equal(
    afterSession2.first_hired_ts,
    afterSession1.first_hired_ts,
    "first_hired_ts never moves once set"
  );

  console.log(
    "  ✓ cumulative KPI accumulates across independent bridge sessions on the same root"
  );
}

async function differentAgentsOnSameRootDoNotCrossPollinate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-kpi-multi-"));
  await runOneAcceptedTask(root, "agent-a");
  const readyB = (await runOneAcceptedTask(root, "agent-b")).find(
    e => e.type === "session.ready"
  );
  // agent-b's session.ready fires BEFORE agent-b's own task runs, so it must still read zeros
  // even though agent-a (a different employee, same root) already has a full history.
  assertEmptyKpi(
    readyB.data.employee.kpi_cumulative,
    "a different employee on the same root does not inherit agent-a's KPI"
  );
  assert.equal(readKpi(root, "agent-a").tasks, 1);
  assert.equal(readKpi(root, "agent-b").tasks, 1);
  console.log(
    "  ✓ two employees sharing a root keep fully independent cumulative KPI"
  );
}

async function main() {
  console.log("e2e-kpi-persistence: cross-session cumulative KPI regression");
  await cumulativeKpiSurvivesAcrossSessions();
  await differentAgentsOnSameRootDoNotCrossPollinate();
  console.log("e2e-kpi-persistence tests passed");
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  }
);
