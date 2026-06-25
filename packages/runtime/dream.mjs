export function extractSources(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const seen = new Set();
  const sources = [];
  const matches = text.matchAll(/https?:\/\/[^\s)]+/g);

  for (const match of matches) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      sources.push(url);
    }
  }

  return sources;
}

export function reviewTaskRun({ taskRun, deliverable = '', existingMemory = [] }) {
  const newMemoryCandidates = [];
  const newPlaybookCandidates = [];
  const existingTexts = new Set(
    existingMemory.map(item => String(item.text || '').trim())
  );

  for (const url of extractSources(deliverable)) {
    if (!existingTexts.has(url.trim())) {
      newMemoryCandidates.push({
        category: 'reliable_sources',
        text: url,
        confidence: 'high'
      });
    }
  }

  if (taskRun.output_valid === true) {
    newMemoryCandidates.push({
      category: 'project_facts',
      text: '任务「' + (taskRun.user_goal || '') + '」已交付有效结果',
      confidence: 'medium'
    });
  }

  if (Array.isArray(taskRun.tool_invocations) && taskRun.tool_invocations.length > 0) {
    newPlaybookCandidates.push({
      title: taskRun.user_goal || taskRun.id,
      steps: taskRun.tool_invocations.map(t => t.tool_name)
    });
  }

  return {
    source_task_ids: [taskRun.id],
    new_memory_candidates: newMemoryCandidates,
    new_playbook_candidates: newPlaybookCandidates,
    confidence: taskRun.effective ? 'high' : (taskRun.output_valid ? 'medium' : 'low'),
    needs_user_review: true
  };
}
