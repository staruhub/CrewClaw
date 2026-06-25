import assert from 'node:assert/strict';
import { summarizeAction, summarizeEvents } from '../event-summary.mjs';

assert.ok(summarizeAction({ tool: 'web_search', args: { query: 'Seed 2.1' } }).includes('搜索来源'));
assert.ok(summarizeAction({ tool: 'web_fetch', args: { url: 'https://www.volcengine.com/x' } }).includes('www.volcengine.com'));
assert.ok(summarizeAction({ tool: 'delete_file', decision: 'deny' }).includes('已拦截'));
assert.deepEqual(summarizeEvents([{ tool: 'read_file', args: { path: 'a.md' } }]).length > 0, true);

console.log('event summary tests passed');
