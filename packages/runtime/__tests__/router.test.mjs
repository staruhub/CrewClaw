import assert from 'node:assert/strict';
import { classifyIntent, shouldUpgradeToTaskRun } from '../router.mjs';

const cases = [
  {
    name: 'hi stays light and does not upgrade',
    message: 'hi',
    assert(result) {
      assert.ok(
        ['ambiguous', 'employee_chat'].includes(result.type),
        `expected ambiguous or employee_chat, got ${result.type}`,
      );
      assert.equal(shouldUpgradeToTaskRun(this.message), false);
    },
  },
  {
    name: 'weather routes to quick utility',
    message: '杭州天气?',
    assert(result) {
      assert.equal(result.type, 'quick_utility');
    },
  },
  {
    name: 'latest model releases upgrade to employee task',
    message: '最新有哪些模型发布?',
    assert(result) {
      assert.equal(result.type, 'employee_task');
      assert.equal(result.upgradeToTaskRun, true);
      assert.equal(shouldUpgradeToTaskRun(this.message), true);
    },
  },
  {
    name: 'internal knowledge QA ROI example upgrades to employee task',
    message: '给我一份内部知识问答ROI示例',
    assert(result) {
      assert.equal(result.type, 'employee_task');
      assert.equal(result.upgradeToTaskRun, true);
      assert.equal(shouldUpgradeToTaskRun(this.message), true);
    },
  },
  {
    name: 'bare token matches pending action',
    message: '1',
    ctx: { pendingActions: [{ key: 1, label: 'Accept' }] },
    assert(result) {
      assert.equal(result.type, 'employee_chat');
      assert.deepEqual(result.matchedPendingAction, { key: 1, label: 'Accept' });
    },
  },
  {
    name: 'bare token without pending action is ambiguous',
    message: '1',
    assert(result) {
      assert.equal(result.type, 'ambiguous');
      assert.equal(result.matchedPendingAction, undefined);
    },
  },
  {
    name: 'jizhu routes to memory command',
    message: 'jizhu',
    assert(result) {
      assert.equal(result.type, 'memory_command');
    },
  },
  {
    name: 'markdown output routes to artifact action',
    message: '输出一份markdown',
    assert(result) {
      assert.equal(result.type, 'artifact_action');
    },
  },
  {
    name: 'love poem is out of scope',
    message: '帮我写情诗',
    assert(result) {
      assert.equal(result.type, 'out_of_scope');
    },
  },
];

for (const testCase of cases) {
  const result = classifyIntent(testCase.message, testCase.ctx);
  assert.equal(typeof result.reason, 'string', `${testCase.name}: reason should be a string`);
  assert.notEqual(result.reason.length, 0, `${testCase.name}: reason should not be empty`);
  testCase.assert(result);
}

console.log(`router tests passed (${cases.length} vectors)`);
