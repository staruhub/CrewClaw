import assert from "node:assert/strict";
import { tmpdir, homedir } from "node:os";

import { auditRecord, classify, isPathInsideRoot, makeGateway } from "../tool-gateway.mjs";

assert.equal(classify("web_search").level, "L0");
assert.equal(classify("bash", { command: "ls -la" }).level, "L1");
assert.equal(classify("bash", { command: "rm -rf foo" }).level, "L2");
assert.equal(classify("write_file", { path: "x" }).level, "L2");
assert.equal(classify("delete_file").level, "L4");
assert.equal(classify("totally_unknown_tool").level, "L4");
assert.equal(makeGateway().check("web_search").decision, "allow");
assert.equal(makeGateway().check("write_file").decision, "confirm");
assert.equal(makeGateway().check("delete_file").decision, "deny");

// ── v0.18 P0-c：workspace 权限是边界不是标签 ────────────────────────────────────────────────
// 只读 bash 白名单：重定向/链式/命令替换即失去只读资格。
assert.equal(classify("bash", { command: "cat notes.md > /tmp/out" }).level, "L2", "redirect escalates");
assert.equal(classify("bash", { command: "ls && rm -rf /" }).level, "L2", "&& chain escalates");
assert.equal(classify("bash", { command: "cat `whoami`" }).level, "L2", "backtick substitution escalates");
assert.equal(classify("bash", { command: "head $(find / -name id_rsa)" }).level, "L2", "$() escalates");
assert.equal(classify("bash", { command: "grep -n TODO src/main.rs" }).level, "L1", "plain read stays L1");

// 路径 containment 判定本体。
const root = tmpdir();
assert.equal(isPathInsideRoot("notes/readme.md", root), true, "relative path stays inside");
assert.equal(isPathInsideRoot("../outside.txt", root), false, ".. traversal escapes");
assert.equal(isPathInsideRoot(`${homedir()}/.ssh/id_rsa`, root), false, "absolute path outside root escapes");
assert.equal(isPathInsideRoot("~/.ssh/id_rsa", root), false, "~ expansion escapes");

// 网关裁决：workspace 只读的自动放行只对 root 内路径成立；出界升级为 confirm（只升不降）。
const gw = makeGateway({ root });
assert.equal(gw.check("read_file", { path: "docs/a.md" }).decision, "allow", "in-root read auto-allowed");
const escape = gw.check("read_file", { path: "~/.ssh/id_rsa" });
assert.equal(escape.decision, "confirm", "out-of-root read requires confirmation");
assert.match(escape.reason, /工作区外/);
assert.equal(gw.check("read_file", { path: "../secret.txt" }).decision, "confirm", ".. traversal requires confirmation");
assert.equal(gw.check("write_file", { path: "docs/a.md" }).decision, "confirm", "writes keep needing confirmation");
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
