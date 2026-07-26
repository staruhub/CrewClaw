import assert from "node:assert/strict";
import {
  summarizeAction,
  summarizeEvents,
  truncateToolDetail,
} from "../event-summary.mjs";
import {
  summarizeAction as canonicalSummarizeAction,
  toolEventPresentation,
  toolResultSummary,
} from "../ui-tools.mjs";

assert.equal(
  summarizeAction,
  canonicalSummarizeAction,
  "event-summary keeps a compatibility export instead of a second semantic implementation"
);

assert.ok(
  summarizeAction({ tool: "web_search", args: { query: "Seed 2.1" } }).includes(
    "搜索来源"
  )
);
assert.ok(
  summarizeAction({
    tool: "web_fetch",
    args: { url: "https://www.volcengine.com/x" },
  }).includes("www.volcengine.com")
);
assert.ok(
  summarizeAction({ tool: "delete_file", decision: "deny" }).includes("已拦截")
);
assert.deepEqual(
  summarizeEvents([{ tool: "read_file", args: { path: "a.md" } }]).length > 0,
  true
);
assert.match(
  summarizeAction({
    tool: "list_files",
    args: { path: "docs", pattern: "*.md" },
  }),
  /正在列出 docs（\*\.md）/
);

const longDetail = truncateToolDetail("x".repeat(5000));
assert.equal(longDetail.detail.length, 4096);
assert.match(longDetail.detail, /工具详情已截断；原始 5000 字符/);
assert.equal(longDetail.truncated, true);
assert.equal(longDetail.originalChars, 5000);
assert.deepEqual(truncateToolDetail("short"), {
  detail: "short",
  truncated: false,
  originalChars: 5,
});

const requested = toolEventPresentation({
  name: "read_file",
  args: { path: "api/boot.ts" },
  phase: "requested",
});
assert.equal(requested.name, "read_file");
assert.equal(requested.args_summary, "api/boot.ts");
assert.equal(requested.label, "read_file · api/boot.ts");
assert.equal(requested.result_summary, undefined);
assert.equal(
  requested.debug_ref,
  undefined,
  "no fake debug reference is emitted"
);

const succeeded = toolEventPresentation({
  name: "read_file",
  args: { path: "api/boot.ts" },
  output: "one\ntwo\nthree",
  phase: "succeeded",
});
assert.equal(succeeded.result_summary, "3 行");
assert.equal(succeeded.summary, "3 行");
assert.equal(
  toolResultSummary({
    name: "todo_write",
    args: {
      todos: [
        { status: "completed" },
        { status: "pending" },
        { status: "pending" },
      ],
    },
    output: JSON.stringify({
      todos: [
        { status: "completed" },
        { status: "pending" },
        { status: "pending" },
      ],
    }),
    phase: "succeeded",
  }),
  "3 项 · 1/3 完成"
);
assert.equal(
  toolEventPresentation({
    name: "mcp_call",
    args: { server: "github", tool: "get_file_contents" },
    output: "{}",
    phase: "blocked",
    decision: "deny",
  }).result_summary,
  "已拦截"
);

console.log("event summary tests passed");
