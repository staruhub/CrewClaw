import assert from "node:assert/strict";
import { getToolTruth, STATUS, toolTruthLine } from "../tool-truth.mjs";

function findState(states, capability, provider) {
  return states.find(state => {
    if (state.capability !== capability) return false;
    return provider ? state.provider === provider : true;
  });
}

const emptyStates = getToolTruth({});

assert.equal(findState(emptyStates, "web.search")?.status, STATUS.missing_key);
assert.equal(
  findState(emptyStates, "utility.weather")?.status,
  STATUS.unavailable
);
assert.equal(
  findState(emptyStates, "artifact.write")?.status,
  STATUS.available
);

assert.equal(
  findState(emptyStates, "memory.write", "session")?.status,
  STATUS.available
);
assert.equal(
  findState(emptyStates, "memory.write", "persistent")?.status,
  STATUS.unavailable
);

const tavilyStates = getToolTruth({ TAVILY_API_KEY: "test-key" });
assert.equal(findState(tavilyStates, "web.search")?.status, STATUS.available);

// Case B: weather is an independent capability, not implied by web.search.
assert.equal(
  findState(tavilyStates, "utility.weather")?.status,
  STATUS.unavailable
);

const line = toolTruthLine(tavilyStates);
assert.ok(line.length > 0);
assert.match(line, /search/);
assert.match(line, /weather/);

console.log("tool-truth tests passed");
