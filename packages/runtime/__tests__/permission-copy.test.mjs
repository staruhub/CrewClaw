import { humanScope, riskWord, permissionRequest } from '../permission-copy.mjs';
import assert from 'node:assert/strict';

assert.equal(humanScope('public_web'), '只读公开网页');
assert.equal(humanScope('weird_scope'), 'weird_scope');
assert.equal(riskWord('L4'), '极高');
const t = permissionRequest({ employeeName: 'AI 落地鲸', toolLabel: 'Browser Render', scope: 'public_web', level: 'L0', reason: '网页抓取失败需 JS 渲染' });
assert.ok(t.includes('AI 落地鲸'));
assert.ok(t.includes('网页抓取失败需 JS 渲染'));
assert.ok(t.includes('只读公开网页'));
assert.ok(t.includes('仅本次任务'));
console.log('ALL TESTS PASSED');
