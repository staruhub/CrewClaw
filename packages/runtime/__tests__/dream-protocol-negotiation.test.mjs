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

import { buildIndexedSystem } from "../context-runtime.mjs";
import {
  assessDreamFromWorkspace,
  generateDreamCandidate,
} from "../dream-controller.mjs";
import { dreamJobPath, reflectionsDir } from "../dream-paths.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";
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

function startBridge(
  root,
  employeeId,
  dreamPolicy = { mode: "recommended" },
  options = {}
) {
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
    agentLoop: options.agentLoop || (async () => "unused"),
    agentLoopDeps: options.agentLoopDeps,
    refreshAgentContext: options.refreshAgentContext,
    meta: {
      mode: "Chat",
      agentId: employeeId,
      dreamPolicy,
      ...(options.meta || {}),
    },
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

async function activationAndRollbackRefreshTheNextModelTurn() {
  const root = createRuntimeTestRoot("crew-dream-context-refresh-");
  const employeeId = "dream-context-refresh-agent";
  const now = Date.parse("2026-07-17T08:00:00.000Z");
  seedReflections(root, employeeId);
  let harness;
  try {
    const assessment = assessDreamFromWorkspace(root, employeeId, { now });
    assert.equal(assessment.recommended, true);
    const baseline = {
      score: 80,
      verdict: "PASS",
      mock: false,
      provider_status: "verified",
      memory_state_hash: assessment.base_memory_hash,
      evaluated_at: now,
      model: "deterministic-baseline",
    };
    const generated = await generateDreamCandidate(root, assessment, {
      dreamId: "dream-context-refresh",
      curate: async input => ({
        value: {
          summary: "沉淀上下文刷新回归记忆。",
          entries: [
            {
              op: "add",
              reason: "accepted task evidence",
              confidence: "high",
              source_task_ids: [input.reflections[0].task_id],
              evidence_ids: input.reflections[0].evidence_ids,
              item: {
                category: "project_facts",
                confidence: "high",
                text: "Dream refresh marker is ACTIVE_MEMORY_7429.",
              },
            },
          ],
        },
        actual_cost_usd: 0.01,
      }),
      modelId: "deterministic-curator",
      baseline,
      evaluateCandidate: async items => ({
        score: 90,
        verdict: "PASS",
        mock: false,
        provider_status: "verified",
        memory_state_hash: computeMemoryStateHash(items).memory_state_hash,
        evaluated_at: now,
        model: "deterministic-candidate-evaluator",
      }),
      now,
    });
    assert.equal(generated.ok, true);
    assert.equal(generated.job.state, "REVIEW_REQUIRED");

    const rebuildContext = () => {
      const indexed = buildIndexedSystem({
        soul: "You are the context refresh test employee.",
        root,
        employeeId,
      });
      return {
        system: indexed.system,
        contextIndex: {
          skills: indexed.skillIndex,
          memory: indexed.memoryIndex,
        },
        memoryStateHash: indexed.memoryState.memory_state_hash,
      };
    };
    const initialContext = rebuildContext();
    const agentLoopDeps = { system: initialContext.system };
    const systemsSeenByModel = [];
    harness = startBridge(
      root,
      employeeId,
      { mode: "recommended" },
      {
        agentLoopDeps,
        refreshAgentContext: rebuildContext,
        meta: {
          contextIndex: initialContext.contextIndex,
          memoryStateHash: initialContext.memoryStateHash,
        },
        agentLoop: async options => {
          systemsSeenByModel.push(options.system);
          options.onDelta("context refresh verified");
          return "context refresh verified";
        },
      }
    );
    await waitUntilReady(harness);
    const ready = harness.events.find(
      event => event.type === EVENTS.SESSION_READY
    );
    assert.equal(ready.data.context_index.epoch, 0);
    assert.equal(
      ready.data.context_index.memory_state_hash,
      assessment.base_memory_hash
    );
    assert.doesNotMatch(agentLoopDeps.system, /ACTIVE_MEMORY_7429/);

    sendAction(harness, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    await barrier(harness);
    const activationFrom = harness.events.length;
    sendAction(harness, "dream.approve", {
      dream_id: generated.dreamId,
    });
    const activated = await waitFor(harness, EVENTS.DREAM_ACTIVATED, {
      from: activationFrom,
    });
    assert.equal(activated.data.context_refresh.status, "applied");
    assert.equal(activated.data.context_refresh.epoch, 1);
    assert.equal(
      activated.data.context_refresh.memory_state_hash,
      generated.job.candidate_memory_hash
    );
    assert.match(agentLoopDeps.system, /ACTIVE_MEMORY_7429/);
    const activeMorning = await waitFor(harness, EVENTS.DREAM_MORNING_REPORT, {
      from: activationFrom,
    });
    assert.equal(activeMorning.data.state, "ACTIVE");
    assert.equal(activeMorning.data.added_count, 1);
    assert.equal(activeMorning.data.activated, true);

    sendAction(harness, "user.message", { text: "verify activated context" });
    await waitFor(harness, EVENTS.TASK_COMPLETED, {
      from: activationFrom,
    });
    assert.match(systemsSeenByModel.at(-1), /ACTIVE_MEMORY_7429/);

    const rollbackFrom = harness.events.length;
    sendAction(harness, "dream.rollback", {
      dream_id: generated.dreamId,
    });
    const rolledBack = await waitFor(harness, EVENTS.DREAM_ROLLED_BACK, {
      from: rollbackFrom,
    });
    assert.equal(rolledBack.data.context_refresh.status, "applied");
    assert.equal(rolledBack.data.context_refresh.epoch, 2);
    assert.equal(
      rolledBack.data.context_refresh.memory_state_hash,
      assessment.base_memory_hash
    );
    assert.doesNotMatch(agentLoopDeps.system, /ACTIVE_MEMORY_7429/);
    const rolledBackMorning = await waitFor(
      harness,
      EVENTS.DREAM_MORNING_REPORT,
      { from: rollbackFrom }
    );
    assert.equal(rolledBackMorning.data.state, "ROLLED_BACK");
    assert.equal(rolledBackMorning.data.activated, false);

    sendAction(harness, "user.message", { text: "verify rolled back context" });
    await waitFor(harness, EVENTS.TASK_COMPLETED, { from: rollbackFrom });
    assert.doesNotMatch(systemsSeenByModel.at(-1), /ACTIVE_MEMORY_7429/);

    await harness.close();
    harness = startBridge(root, employeeId);
    await waitUntilReady(harness);
    sendAction(harness, "client.ready", {
      event_families: ["core/v1", "dream/v1"],
    });
    const restartedMorning = await waitFor(
      harness,
      EVENTS.DREAM_MORNING_REPORT
    );
    assert.equal(restartedMorning.data.dream_id, generated.dreamId);
    assert.equal(restartedMorning.data.state, "ROLLED_BACK");
    assert.equal(restartedMorning.data.reviewed_count, 1);
  } finally {
    await harness?.close();
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
await activationAndRollbackRefreshTheNextModelTurn();

console.log("dream protocol negotiation tests passed (7 scenarios)");
