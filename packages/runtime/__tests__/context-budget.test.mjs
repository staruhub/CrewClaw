import assert from 'node:assert/strict';

import {
  addUsage,
  budgetStatus,
  compactPlan,
  newBudget,
  shouldLoadFullContext,
} from '../context-budget.mjs';

const defaults = newBudget();
assert.equal(defaults.soft, 50_000);
assert.equal(defaults.hard, 90_000);
assert.deepEqual(defaults.spent, { promptTok: 0, completionTok: 0 });

const firstUsage = addUsage(defaults, { promptTokens: 100, completionTokens: 25 });
const secondUsage = addUsage(firstUsage, {
  promptTokens: 300,
  completionTokens: 75,
});
assert.deepEqual(secondUsage.spent, { promptTok: 400, completionTok: 100 });
assert.deepEqual(defaults.spent, { promptTok: 0, completionTok: 0 });

assert.equal(
  budgetStatus(
    addUsage(newBudget(), { promptTokens: 10_000, completionTokens: 1_000 }),
  ).status,
  'ok',
);
assert.equal(
  budgetStatus(
    addUsage(newBudget(), { promptTokens: 49_000, completionTokens: 1_000 }),
  ).status,
  'soft_exceeded',
);
assert.equal(
  budgetStatus(
    addUsage(newBudget(), { promptTokens: 89_000, completionTokens: 1_000 }),
  ).status,
  'hard_exceeded',
);

const artifactMessage = {
  role: 'assistant',
  content: 'long artifact body',
  metadata: { type: 'artifact', artifactId: 'art_1' },
};
const ordinaryMessage = { role: 'user', content: '分析竞争对手' };
const plan = compactPlan([
  { role: 'system', content: 'system instructions' },
  ordinaryMessage,
  artifactMessage,
]);
assert.ok(plan.drop_to_artifact_refs.includes(artifactMessage));
assert.equal(plan.keep.includes(artifactMessage), false);
assert.equal(plan.drop_to_artifact_refs.includes(ordinaryMessage), false);
assert.ok(plan.keep.includes(ordinaryMessage) || plan.summarize.includes(ordinaryMessage));

assert.equal(shouldLoadFullContext('hi'), false);
assert.equal(shouldLoadFullContext('hello'), false);
assert.equal(shouldLoadFullContext('给我一份ROI报告'), true);
assert.equal(shouldLoadFullContext('分析竞争对手'), true);

console.log('ALL TESTS PASSED');
