import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { dreamJobPath, reflectionsDir } from "../dream-paths.mjs";
import { buildReflection, writeReflection } from "../reflect.mjs";
import { recordSpend } from "../spend.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { EVENTS, validateTaskEvent } from "../tui/protocol.mjs";
import { createRuntimeTestRoot } from "./test-paths.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function seedReflections(root, employeeId, count = 8) {
  for (let index = 1; index <= count; index++) {
    const reflection = buildReflection(
      {
        id: `task-${index}`,
        employee_id: employeeId,
        status: "accepted",
        output_valid: true,
        artifact: `artifact-${index}`,
        user_feedback: "useful",
        started_at: "2026-07-11T00:00:00.000Z",
        updated_at: "2026-07-11T00:01:00.000Z",
      },
      { createdAt: `2026-07-11T00:0${index}:00.000Z` }
    );
    assert.equal(writeReflection(root, reflection).ok, true);
  }
}

function startBridge(root, employeeId, dreamPolicy = { mode: "recommended" }) {
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
  const done = startJsonlBridge({
    agentLoop: async () => "unused",
    meta: { mode: "Chat", agentId: employeeId, dreamPolicy },
    input,
    output,
    root,
  });
  let closed = false;
  return {
    done,
    events,
    input,
    async close() {
      if (closed) return;
      closed = true;
      input.push("/exit\n");
      await done;
    },
  };
}

async function waitFor(harness, type, { from = 0, timeout = 5_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = harness.events.slice(from).find(event => event.type === type);
    if (found) return found;
    await sleep(10);
  }
  throw new Error(
    `missing ${type}; saw ${harness.events.map(event => event.type).join(",")}`
  );
}

async function waitUntilReady(harness) {
  const protocol = await waitFor(harness, EVENTS.PROTOCOL_READY);
  await waitFor(harness, EVENTS.SESSION_READY);
  assert.deepEqual(protocol.data.event_families, ["core/v1", "dream/v1"]);
}

function sendAction(harness, type, data = {}) {
  harness.input.push(`${JSON.stringify({ type, data })}\n`);
}

async function barrier(harness) {
  const from = harness.events.length;
  harness.input.push("{\n");
  await waitFor(harness, EVENTS.DEBUG_LINE, { from });
}

function dreamEvents(harness) {
  return harness.events.filter(event => event.type.startsWith("dream."));
}

function jobsDir(root, employeeId) {
  return join(root, ".crewclaw", "dream", employeeId, "jobs");
}

async function recommendationSurvivesRestart() {
  const root = createRuntimeTestRoot("crew-dream-negotiation-");
  const employeeId = "dream-restart-agent";
  let first;
  let restarted;
  let corruptJobRestart;
  try {
    seedReflections(root, employeeId);
    first = startBridge(root, employeeId);
    await waitUntilReady(first);
    assert.equal(
      dreamEvents(first).length,
      0,
      "dream/v1 must stay silent before client.ready"
    );

    sendAction(first, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    const recommended = await waitFor(first, EVENTS.DREAM_RECOMMENDED);
    assert.equal(validateTaskEvent(recommended).ok, true);
    assert.equal(recommended.data.employee_id, employeeId);
    assert.equal(recommended.data.generation_available, false);
    assert.ok(
      recommended.data.activation.blockers.includes("baseline_missing")
    );
    const dreamId = recommended.data.dream_id;
    const jobPath = dreamJobPath(root, employeeId, dreamId);
    assert.ok(existsSync(jobPath));
    assert.equal(
      JSON.parse(readFileSync(jobPath, "utf8")).state,
      "RECOMMENDED"
    );
    await first.close();

    restarted = startBridge(root, employeeId);
    await waitUntilReady(restarted);
    sendAction(restarted, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    const replayed = await waitFor(restarted, EVENTS.DREAM_RECOMMENDED);
    assert.equal(replayed.data.dream_id, dreamId);
    assert.equal(
      dreamEvents(restarted).some(event => event.type === EVENTS.DREAM_BLOCKED),
      false,
      "restarting with immutable input must reuse, not conflict with, the job"
    );
    assert.deepEqual(readdirSync(jobsDir(root, employeeId)), [
      `${dreamId}.json`,
    ]);
    await restarted.close();

    // A corrupt persisted recommendation is observable and fail-closed; it must not crash the
    // bridge during capability negotiation or be silently overwritten.
    writeFileSync(jobPath, "{not-json", "utf8");
    corruptJobRestart = startBridge(root, employeeId);
    await waitUntilReady(corruptJobRestart);
    sendAction(corruptJobRestart, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    const blocked = await waitFor(corruptJobRestart, EVENTS.DREAM_BLOCKED);
    assert.match(
      blocked.data.reason,
      /existing dream recommendation is unreadable/
    );
    assert.equal(
      dreamEvents(corruptJobRestart).some(
        event => event.type === EVENTS.DREAM_RECOMMENDED
      ),
      false
    );
  } finally {
    await first?.close();
    await restarted?.close();
    await corruptJobRestart?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function unsupportedClientStaysSilent() {
  const root = createRuntimeTestRoot("crew-dream-core-only-");
  const employeeId = "dream-core-only-agent";
  seedReflections(root, employeeId);
  const harness = startBridge(root, employeeId);
  try {
    await waitUntilReady(harness);
    sendAction(harness, "client.ready", { event_families: ["core/v1"] });
    await barrier(harness);
    sendAction(harness, "dream.run");
    await barrier(harness);
    assert.equal(dreamEvents(harness).length, 0);
    assert.equal(existsSync(jobsDir(root, employeeId)), false);
  } finally {
    await harness.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function manualModeRunsOnlyOnCommand() {
  const root = createRuntimeTestRoot("crew-dream-manual-");
  const employeeId = "dream-manual-agent";
  seedReflections(root, employeeId, 1);
  const harness = startBridge(root, employeeId, { mode: "manual" });
  try {
    await waitUntilReady(harness);
    sendAction(harness, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    await barrier(harness);
    assert.equal(dreamEvents(harness).length, 0);

    sendAction(harness, "dream.run");
    const recommended = await waitFor(harness, EVENTS.DREAM_RECOMMENDED);
    assert.ok(recommended.data.trigger_reasons.includes("manual_trigger"));
    assert.equal(recommended.data.metrics.accepted_tasks, 1);
  } finally {
    await harness.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function invalidReflectionFailsClosed(label, contentsFor) {
  const root = createRuntimeTestRoot(`crew-dream-${label}-`);
  const employeeId = `dream-${label}-agent`;
  const dir = reflectionsDir(root, employeeId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "broken.json"),
    typeof contentsFor === "function" ? contentsFor(employeeId) : contentsFor,
    "utf8"
  );
  const harness = startBridge(root, employeeId, { mode: "manual" });
  try {
    await waitUntilReady(harness);
    sendAction(harness, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    await barrier(harness);
    assert.equal(dreamEvents(harness).length, 0);

    sendAction(harness, "dream.run");
    const blocked = await waitFor(harness, EVENTS.DREAM_BLOCKED);
    assert.ok(blocked.data.blockers.includes("input_state_unreadable"));
    assert.equal(existsSync(jobsDir(root, employeeId)), false);
  } finally {
    await harness.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function liveBudgetChangeBlocksDream() {
  const root = createRuntimeTestRoot("crew-dream-budget-");
  const employeeId = "dream-budget-agent";
  seedReflections(root, employeeId);
  writeFileSync(
    join(root, ".crewclaw", "prefs.json"),
    JSON.stringify({ budget: 3 }),
    "utf8"
  );
  assert.equal(recordSpend(root, 3, 25).persisted, true);
  const harness = startBridge(root, employeeId);
  try {
    await waitUntilReady(harness);
    // Lower the cap from $200 to $20 after bridge startup. Eligibility must read the current
    // setting both at capability negotiation and at an explicit dream.run refresh.
    writeFileSync(
      join(root, ".crewclaw", "prefs.json"),
      JSON.stringify({ budget: 0 }),
      "utf8"
    );
    sendAction(harness, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    await barrier(harness);
    assert.equal(dreamEvents(harness).length, 0);

    sendAction(harness, "dream.run");
    const blocked = await waitFor(harness, EVENTS.DREAM_BLOCKED);
    assert.ok(blocked.data.blockers.includes("budget_unavailable"));
    assert.equal(existsSync(jobsDir(root, employeeId)), false);
  } finally {
    await harness.close();
    rmSync(root, { recursive: true, force: true });
  }
}

await recommendationSurvivesRestart();
await unsupportedClientStaysSilent();
await manualModeRunsOnlyOnCommand();
await invalidReflectionFailsClosed("syntax-corrupt", "{not-json");
await invalidReflectionFailsClosed("schema-corrupt", employeeId =>
  JSON.stringify({
    contract: "crewclaw.reflect/v1",
    employee_id: employeeId,
    outcome: "accepted",
    output_valid: true,
  })
);
await liveBudgetChangeBlocksDream();

console.log("dream protocol negotiation tests passed (6 scenarios)");
