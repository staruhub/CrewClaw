import assert from "node:assert/strict";
import { getToolStatus, toolStatusLine } from "../tui/tool-status.mjs";

const toolResolution = {
  sessionCatalog: [
    {
      capability: "web.search",
      runtime_tool: "web_search",
      availability: "ready",
      authorization: "automatic",
    },
    {
      capability: "web.fetch_extract",
      runtime_tool: "web_fetch",
      availability: "ready",
      authorization: "automatic",
    },
    {
      capability: "evidence.create",
      runtime_tool: null,
      availability: "ready",
      authorization: "automatic",
    },
  ],
};

let frozenSearchStatus;

{
  const status = getToolStatus({}, { toolResolution });
  const search = status.find(item => item.tool === "web.search");
  assert.equal(
    search.ok,
    true,
    "a resolved session snapshot is the availability truth, not ambient env"
  );
  assert.equal(search.code, "");
  assert.equal(search.label, "available");
  frozenSearchStatus = search;
  assert.equal(status.find(item => item.tool === "web.fetch_extract").ok, true);
  assert.equal(status.find(item => item.tool === "evidence.create").ok, true);
  assert.equal(
    status.some(item => item.tool === "web.extract"),
    false
  );
  assert.match(toolStatusLine(status), /search ✓/);
}

{
  const status = getToolStatus({ TAVILY_API_KEY: "x" }, { toolResolution });
  const search = status.find(item => item.tool === "web.search");
  assert.equal(search.ok, true);
  assert.deepEqual(
    search,
    frozenSearchStatus,
    "ambient provider changes cannot mutate a frozen session snapshot"
  );
  assert.match(toolStatusLine(status), /search ✓/);
}

{
  const status = getToolStatus({ TAVILY_API_KEY: "x" });
  assert.equal(
    status.some(item => item.ok),
    false,
    "without an employee resolution no catalog entry may be advertised available"
  );
}

console.log("tui-tool-status tests passed");
