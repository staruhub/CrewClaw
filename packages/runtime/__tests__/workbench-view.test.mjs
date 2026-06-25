import assert from 'node:assert/strict';
import {
  acceptancePanel,
  actionBar,
  statusHeader,
  timelinePanel,
} from '../workbench-view.mjs';

assert.ok(statusHeader({ name: 'AI 落地鲸', role: '研究员', status: 'working' }).includes('AI 落地鲸'));
assert.ok(statusHeader({ name: 'X', status: 'working' }).includes('working'));
{
  const t = timelinePanel([{ summary: '搜索官方来源' }, { summary: '提取证据' }]);
  assert.ok(t.includes('搜索官方来源'));
  assert.equal(t.split(String.fromCharCode(10)).length, 2);
}
{
  const p = acceptancePanel({
    artifactId: 'artifact_1',
    toolCount: 3,
    status: 'delivered',
    outputValid: true,
    gradePassed: false,
    missing: ['来源'],
    effective: false,
    feedback: 'skipped',
  });
  assert.ok(p.includes('任务验收') && p.includes('artifact_1') && p.includes('来源'));
}
assert.equal(actionBar(), 'Command: approve / deny / accept / reject / dream');
