import assert from "node:assert/strict";

import { auditRecord, classify, makeGateway } from "../tool-gateway.mjs";

assert.equal(classify("web_search").level, "L0");
assert.equal(classify("bash", { command: "ls -la" }).level, "L1");
assert.equal(classify("bash", { command: "rm -rf foo" }).level, "L2");
assert.equal(classify("write_file", { path: "x" }).level, "L2");
assert.equal(classify("delete_file").level, "L4");
assert.equal(classify("totally_unknown_tool").level, "L4");
assert.equal(makeGateway().check("web_search").decision, "allow");
assert.equal(makeGateway().check("write_file").decision, "confirm");
assert.equal(makeGateway().check("delete_file").decision, "deny");
assert.equal(
  auditRecord({
    toolName: "bash",
    args: { command: "ls" },
    decision: "allow",
    level: "L1",
    startedAt: 1,
    endedAt: 2,
    status: "success"
  }).tool_name,
  "bash"
);
