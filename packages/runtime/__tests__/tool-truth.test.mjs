import assert from "node:assert/strict";
import {
  CAPABILITIES,
  getToolTruth,
  STATUS,
  toolTruthLine,
} from "../tool-truth.mjs";

function findState(states, capability) {
  return states.find(state => state.capability === capability);
}

const emptyStates = getToolTruth({});
assert.equal(findState(emptyStates, "web.search")?.status, STATUS.missing_key);
assert.equal(
  findState(emptyStates, "artifact.report")?.status,
  STATUS.configured_unverified,
  "catalog declaration alone must not claim employee availability"
);
for (const drifted of [
  "utility.weather",
  "web.extract",
  "artifact.write",
  "memory.write",
  "outcome.grade",
]) {
  assert.equal(CAPABILITIES.includes(drifted), false, drifted);
  assert.equal(findState(emptyStates, drifted), undefined, drifted);
}

const unverifiedProvider = getToolTruth({ TAVILY_API_KEY: "test-key" });
assert.equal(
  findState(unverifiedProvider, "web.search")?.status,
  STATUS.configured_unverified,
  "provider health cannot bypass employee resolution"
);

const toolResolution = {
  sessionCatalog: [
    {
      capability: "web.search",
      runtime_tool: "web_search",
      availability: "ready",
      authorization: "automatic",
      reason: "已解析",
    },
    {
      capability: "web.fetch_extract",
      runtime_tool: "web_fetch",
      availability: "ready",
      authorization: "automatic",
      reason: "已解析",
    },
    {
      capability: "artifact.report",
      runtime_tool: null,
      availability: "ready",
      authorization: "automatic",
      reason: "已解析",
    },
    {
      capability: "browser.render",
      runtime_tool: "browser_render",
      availability: "ready",
      authorization: "per_call",
      reason: "已解析",
    },
    {
      capability: "shell.run",
      runtime_tool: "bash",
      availability: "forbidden",
      authorization: "denied",
      reason: "员工策略明确禁用",
    },
    // Resolver output is still filtered through ToolCatalog.
    { capability: "invented.tool", availability: "ready" },
  ],
};

const resolved = getToolTruth(
  { TAVILY_API_KEY: "test-key" },
  { toolResolution }
);
assert.deepEqual(
  resolved.map(item => item.capability),
  [
    "web.search",
    "web.fetch_extract",
    "artifact.report",
    "browser.render",
    "shell.run",
  ]
);
assert.equal(findState(resolved, "web.search")?.status, STATUS.available);
assert.equal(
  findState(resolved, "web.fetch_extract")?.status,
  STATUS.available,
  "fetch_extract is its canonical catalog capability, not web.extract"
);
assert.equal(findState(resolved, "artifact.report")?.status, STATUS.available);
assert.equal(findState(resolved, "shell.run")?.status, STATUS.disabled);

const renderDowngraded = getToolTruth(
  { TAVILY_API_KEY: "test-key", CREW_RENDER_PROVIDER: "none" },
  { toolResolution }
);
assert.equal(
  findState(renderDowngraded, "browser.render")?.status,
  STATUS.permission_required,
  "tool truth projects the frozen session snapshot instead of recomputing provider state"
);

const providerDowngraded = getToolTruth({}, { toolResolution });
assert.equal(
  findState(providerDowngraded, "web.search")?.status,
  STATUS.available,
  "provider environment cannot mutate a previously resolved session snapshot"
);
assert.equal(
  findState(providerDowngraded, "web.fetch_extract")?.status,
  STATUS.available,
  "fetching a known URL does not require a Search provider key"
);

const line = toolTruthLine(resolved);
assert.match(line, /search ✓/);
assert.match(line, /fetch\+extract ✓/);

console.log("tool-truth tests passed");
