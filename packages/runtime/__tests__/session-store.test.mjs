import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { sanitizeForSave, saveSession, loadSession } from '../session-store.mjs';

const history = [
  { role: 'user', content: 'q1' },
  {
    role: 'user',
    content: [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:abc' } },
    ],
  },
  { role: 'assistant', content: '答1' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
  { role: 'tool', tool_call_id: 'c1', content: 'ls 输出' },
];

function assertSanitizeForSave() {
  const out = sanitizeForSave(history);

  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { role: 'user', content: 'q1' });
  assert.equal(out[1].role, 'user');
  assert.ok(out[1].content.includes('看图'));
  assert.ok(out[1].content.includes('省略'));
  assert.ok(out[1].content.includes('图片'));
  assert.deepEqual(out[2], { role: 'assistant', content: '答1' });
  assert.equal(out.some((item) => item.role === 'tool'), false);
  assert.equal(out.some((item) => Object.hasOwn(item, 'tool_calls')), false);
}

async function assertSaveLoadRoundTrip() {
  const root = os.tmpdir();
  const agentId = `test-agent-${process.pid}`;
  const sessionPath = path.join(root, '.sessions', `${agentId}.json`);

  try {
    const saved = saveSession(root, agentId, history);
    assert.equal(saved.ok, true);
    assert.equal(saved.count, 3);

    const loaded = loadSession(root, agentId);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.messages, sanitizeForSave(history));
    assert.equal(typeof loaded.savedAt, 'string');

    const missing = loadSession(root, `missing-agent-xyz-${process.pid}`);
    assert.equal(missing.ok, false);
  } finally {
    fs.rmSync(sessionPath, { force: true });
  }
}

assertSanitizeForSave();
await assertSaveLoadRoundTrip();
