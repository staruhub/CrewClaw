import assert from 'node:assert/strict';

import {
  checkBudget,
  estimateCost,
  formatBudget,
} from '../budget-guard.mjs';

{
  const r = estimateCost({ promptTokens: 1_000_000, completionTokens: 0 });
  assert.equal(r.cost, 15);
  assert.equal(r.tokens, 1_000_000);
}

{
  const r = estimateCost({ promptTokens: 0, completionTokens: 2_000_000 });
  assert.equal(r.cost, 150);
}

assert.deepEqual(checkBudget(1, null), { ok: true, over: 0, remaining: null });

{
  const b = checkBudget(6, 5);
  assert.equal(b.ok, false);
  assert.equal(b.over, 1);
}

assert.ok(formatBudget({ tokens: 1234, cost: 0.18, limit: 5 }).includes('1,234'));
assert.ok(formatBudget({ tokens: 10, cost: 6, limit: 5 }).includes('超预算'));

console.log('budget-guard tests passed');
