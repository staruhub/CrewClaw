import assert from "node:assert/strict";
import { classifyIntent, shouldUpgradeToTaskRun } from "../router.mjs";

const cases = [
  {
    name: "hi is a light greeting that reaches the model as employee_chat",
    message: "hi",
    assert(result) {
      assert.equal(result.type, "employee_chat");
      assert.equal(shouldUpgradeToTaskRun(this.message), false);
    },
  },
  {
    name: "weather routes to quick utility",
    message: "杭州天气?",
    assert(result) {
      assert.equal(result.type, "quick_utility");
    },
  },
  {
    name: "latest model releases upgrade to employee task",
    message: "最新有哪些模型发布?",
    assert(result) {
      assert.equal(result.type, "employee_task");
      assert.equal(result.upgradeToTaskRun, true);
      assert.equal(shouldUpgradeToTaskRun(this.message), true);
    },
  },
  {
    name: "internal knowledge QA ROI example upgrades to employee task",
    message: "给我一份内部知识问答ROI示例",
    assert(result) {
      assert.equal(result.type, "employee_task");
      assert.equal(result.upgradeToTaskRun, true);
      assert.equal(shouldUpgradeToTaskRun(this.message), true);
    },
  },
  {
    name: "bare token matches pending action",
    message: "1",
    ctx: { pendingActions: [{ key: 1, label: "Accept" }] },
    assert(result) {
      assert.equal(result.type, "employee_chat");
      assert.deepEqual(result.matchedPendingAction, {
        key: 1,
        label: "Accept",
      });
    },
  },
  {
    // 有待办但按错号 → 真歧义，澄清语"或直接选上面的待办编号"此时才成立。
    name: "bare token mismatching existing pending actions is ambiguous",
    message: "9",
    ctx: { pendingActions: [{ key: 1, label: "Accept" }] },
    assert(result) {
      assert.equal(result.type, "ambiguous");
      assert.equal(result.matchedPendingAction, undefined);
    },
  },
  {
    // 没有任何待办时，裸 "1" 是普通输入 → 交给模型，不再拒答（真实用户卡点）。
    name: "bare token with no pending actions goes to the model",
    message: "1",
    assert(result) {
      assert.equal(result.type, "employee_chat");
      assert.equal(result.matchedPendingAction, undefined);
    },
  },
  {
    // route 发 3=打开位置，正则必须认 3（曾漏）。
    name: "bare 3 matches the reveal pending action",
    message: "3",
    ctx: { pendingActions: [{ key: "3", label: "打开位置" }] },
    assert(result) {
      assert.equal(result.type, "employee_chat");
      assert.equal(result.matchedPendingAction.key, "3");
    },
  },
  {
    // 白名单没命中的开放问题默认走模型，不再"没太理解"。
    name: "unmatched open question defaults to employee_chat (the model)",
    message: "你可以做什么?",
    assert(result) {
      assert.equal(result.type, "employee_chat");
    },
  },
  {
    name: "jizhu routes to memory command",
    message: "jizhu",
    assert(result) {
      assert.equal(result.type, "memory_command");
    },
  },
  {
    name: "markdown output routes to artifact action",
    message: "输出一份markdown",
    assert(result) {
      assert.equal(result.type, "artifact_action");
    },
  },
  {
    name: "love poem is out of scope",
    message: "帮我写情诗",
    assert(result) {
      assert.equal(result.type, "out_of_scope");
    },
  },
];

for (const testCase of cases) {
  const result = classifyIntent(testCase.message, testCase.ctx);
  assert.equal(
    typeof result.reason,
    "string",
    `${testCase.name}: reason should be a string`
  );
  assert.notEqual(
    result.reason.length,
    0,
    `${testCase.name}: reason should not be empty`
  );
  testCase.assert(result);
}

console.log(`router tests passed (${cases.length} vectors)`);
