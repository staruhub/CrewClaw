export function renderReport({ taskRun, deliverable = '', sources = [], grade = null }) {
  const nl = String.fromCharCode(10);
  const title = taskRun.user_goal || taskRun.id;
  const toolCount = taskRun.tool_invocations ? taskRun.tool_invocations.length : 0;
  const lines = [
    '# ' + title,
    '- 员工: ' + taskRun.employee_id,
    '- 状态: ' + taskRun.status,
    '- 有效任务: ' + (taskRun.effective ? '是' : '否'),
    '- 工具调用: ' + toolCount + ' 次',
    '',
    '## 交付物',
    deliverable
  ];

  if (sources && sources.length > 0) {
    lines.push('', '## 来源');
    for (const source of sources) {
      lines.push('- ' + source);
    }
  }

  if (grade !== null && grade !== undefined) {
    lines.push('', '## 验收', (grade.passed ? '通过' : '未通过') + '（' + (grade.feedback || '') + '）');
  }

  return lines.join(nl);
}
