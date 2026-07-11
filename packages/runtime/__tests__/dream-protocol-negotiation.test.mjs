import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import { buildReflection, writeReflection } from "../reflect.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { createRuntimeTestRoot } from "./test-paths.mjs";

const root = createRuntimeTestRoot("crew-dream-negotiation-");
const employeeId = "dream-test-agent";
for (let index = 1; index <= 8; index++) {
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
const bridge = startJsonlBridge({
  agentLoop: async () => "unused",
  meta: { mode: "Chat", agentId: employeeId, dreamPolicy: { mode: "recommended" } },
  input,
  output,
  root,
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(type) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const found = events.find(event => event.type === type);
    if (found) return found;
    await sleep(10);
  }
  throw new Error(`missing ${type}; saw ${events.map(event => event.type).join(",")}`);
}

await waitFor("protocol.ready");
await waitFor("session.ready");
assert.equal(
  events.some(event => event.type.startsWith("dream.")),
  false,
  "dream/v1 must stay silent before client.ready"
);

input.push(
  `${JSON.stringify({
    type: "client.ready",
    data: { event_families: ["core/v1", "dream/v1"] },
  })}\n`
);
const recommended = await waitFor("dream.recommended");
assert.equal(recommended.data.employee_id, employeeId);
assert.equal(recommended.data.generation_available, false);
assert.ok(recommended.data.activation.blockers.includes("baseline_missing"));

input.push("/exit\n");
await bridge;
rmSync(root, { recursive: true, force: true });

console.log("dream protocol negotiation tests passed");
