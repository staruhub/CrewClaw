import assert from "node:assert/strict";
import { grade, ruleCheck } from "../outcome-grader.mjs";

const good = "结论：火山 Seed 2.1 Pro 名称确认，价格 6/30 元，上下文 256k token，能力覆盖 Coding 与 Agent。来源 https://www.volcengine.com 与官方文档，置信度 高。补充说明若干字以超过一百二十字的要求，确保字段完整性通过检查，本文本已足够长。";

assert.equal(ruleCheck(good).hardFails, 0);
assert.ok(ruleCheck("我觉得它大概收费 30 元一百万 token，应该不错").hardFails >= 1);
assert.equal((await grade({ task: "t", artifact: good }, async () => ({ passed: true, reason: "ok" }))).passed, true);
assert.equal((await grade({ task: "t", artifact: "no sources, just vibes 30 元" }, async () => ({ passed: true }))).passed, false);

console.log("ALL TESTS PASSED");
