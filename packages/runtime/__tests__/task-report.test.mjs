import assert from "node:assert/strict";
import { renderReport } from "../task-report.mjs";

{
  const md = renderReport({
    taskRun: {
      id: "t1",
      user_goal: "调研 Seed 2.1",
      employee_id: "whale",
      status: "delivered",
      effective: false,
      tool_invocations: [],
    },
    deliverable: "正文内容",
    sources: ["https://a.com"],
    grade: { passed: true, feedback: "全部通过" },
  });

  assert.ok(md.includes("调研 Seed 2.1"));
  assert.ok(md.includes("## 交付物"));
  assert.ok(md.includes("正文内容"));
  assert.ok(md.includes("https://a.com"));
  assert.ok(md.includes("## 验收"));
}

{
  const md = renderReport({
    taskRun: {
      id: "t2",
      user_goal: "x",
      employee_id: "w",
      status: "failed",
      tool_invocations: [],
    },
  });

  assert.ok(!md.includes("## 来源"));
  assert.ok(!md.includes("## 验收"));
}
