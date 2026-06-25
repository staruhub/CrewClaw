import assert from 'node:assert/strict';
import { extractSources, reviewTaskRun } from '../dream.mjs';

assert.deepEqual(extractSources('see https://a.com and https://a.com and http://b.org'), ['https://a.com', 'http://b.org']);
assert.deepEqual(extractSources(null), []);

const r = reviewTaskRun({
  taskRun: {
    id: 'task_1',
    user_goal: '调研X',
    output_valid: true,
    effective: true,
    tool_invocations: [
      { tool_name: 'web_search' },
      { tool_name: 'web_fetch' }
    ]
  },
  deliverable: '来源 https://volcengine.com 置信度 高'
});

assert.ok(r.new_memory_candidates.some(c => c.category === 'reliable_sources' && c.text === 'https://volcengine.com'));
assert.deepEqual(r.new_playbook_candidates[0].steps, ['web_search', 'web_fetch']);
assert.equal(r.confidence, 'high');

const r2 = reviewTaskRun({
  taskRun: {
    id: 't',
    output_valid: true
  },
  deliverable: 'https://x.com',
  existingMemory: [
    {
      category: 'reliable_sources',
      text: 'https://x.com'
    }
  ]
});

assert.ok(r2.new_memory_candidates.every(c => c.text !== 'https://x.com'));
