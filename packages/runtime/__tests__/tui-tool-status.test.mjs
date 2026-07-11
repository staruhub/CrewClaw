// Honest tool-status: search is ✗ without a real provider key; render reflects whether
// playwright is actually installed; structured error codes accompany ✗.
import assert from "node:assert/strict";
import { getToolStatus, toolStatusLine } from "../tui/tool-status.mjs";

// 1) no keys → search degraded (DDG), with a missing_key code; fetch + evidence ok
{
  const st = getToolStatus({});
  const search = st.find(s => s.tool === "web.search");
  assert.equal(search.ok, false, "no search key → not ok");
  assert.equal(search.code, "missing_key");
  assert.match(search.reason, /provider|DDG/);
  assert.equal(st.find(s => s.tool === "web.fetch").ok, true);
  assert.equal(st.find(s => s.tool === "evidence").ok, true);
  assert.match(toolStatusLine(st), /search ✗/);
}

// 2) a real provider key → search ok, labelled by backend
{
  const st = getToolStatus({ TAVILY_API_KEY: "x" });
  const search = st.find(s => s.tool === "web.search");
  assert.equal(search.ok, true);
  assert.equal(search.label, "tavily");
  assert.match(toolStatusLine(st), /search ✓/);
}

// 3) render: a cloud provider that isn't implemented is honestly ✗ with a code
{
  const st = getToolStatus({ CREW_RENDER_PROVIDER: "firecrawl" });
  const render = st.find(s => s.tool === "browser.render");
  assert.equal(render.ok, false);
  assert.equal(render.code, "no_render_provider");
}

console.log("tui-tool-status tests passed");
