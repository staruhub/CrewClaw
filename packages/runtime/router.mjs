const BARE_PENDING_ACTION_RE = /^(?:1|2|a|b|accept|reject)$/i;

const DEFAULT_SCOPE_KEYWORDS = [
  'AI落地',
  '模型选型',
  'Agent工作流',
  '知识问答',
  'LLM',
  'RAG',
  'embedding',
  'prompt',
];

const RULES = {
  memory: /记住|记一下|jizhu|remember|别忘/i,
  quickUtility: /天气|weather|几点|时间|算一下|换算|calculator/i,
  artifact: /输出.*markdown|生成文件|导出|打开文件夹|保存为|open folder/i,
  outOfScope: /写诗|情诗|讲笑话|poem|love poem|joke/i,
  deliverable:
    /报告|表格|PPT|代码|ROI|预算|选型|路线图|研究|联网查证|多步骤|report|analysis|research|implement|build|最新.*模型|模型.*发布/i,
};

export function classifyIntent(message, ctx = {}) {
  const normalizedMessage = normalizeMessage(message);

  if (BARE_PENDING_ACTION_RE.test(normalizedMessage)) {
    const matchedPendingAction = findPendingAction(normalizedMessage, ctx.pendingActions);

    if (matchedPendingAction) {
      return {
        type: 'employee_chat',
        reason: 'bare token matched pending action',
        matchedPendingAction,
      };
    }

    return {
      type: 'ambiguous',
      reason: 'bare action token without matching pending action',
    };
  }

  if (RULES.memory.test(normalizedMessage)) {
    return { type: 'memory_command', reason: 'matched memory keyword' };
  }

  if (RULES.quickUtility.test(normalizedMessage)) {
    return { type: 'quick_utility', reason: 'matched quick utility keyword' };
  }

  if (RULES.artifact.test(normalizedMessage)) {
    return { type: 'artifact_action', reason: 'matched artifact action keyword' };
  }

  if (RULES.outOfScope.test(normalizedMessage)) {
    return { type: 'out_of_scope', reason: 'matched out-of-scope keyword' };
  }

  if (isDeliverableRequest(normalizedMessage)) {
    return {
      type: 'employee_task',
      reason: 'matched deliverable or task keyword',
      upgradeToTaskRun: true,
    };
  }

  if (matchesEmployeeScope(normalizedMessage, ctx.employeeScope)) {
    return { type: 'employee_chat', reason: 'matched employee scope keyword' };
  }

  return { type: 'ambiguous', reason: 'no intent rule matched' };
}

export function shouldUpgradeToTaskRun(message) {
  return isDeliverableRequest(normalizeMessage(message));
}

function normalizeMessage(message) {
  return String(message ?? '').trim();
}

function findPendingAction(token, pendingActions = []) {
  if (!Array.isArray(pendingActions)) {
    return undefined;
  }

  const normalizedToken = token.toLowerCase();

  return pendingActions.find((action) => {
    const key = action?.key;
    return key !== undefined && String(key).trim().toLowerCase() === normalizedToken;
  });
}

function isDeliverableRequest(message) {
  return RULES.deliverable.test(message);
}

function matchesEmployeeScope(message, employeeScope = {}) {
  const scopeKeywords = [
    ...DEFAULT_SCOPE_KEYWORDS,
    ...toStringArray(employeeScope.skills),
    ...toStringArray(employeeScope.keywords),
  ];

  return scopeKeywords.some((keyword) => {
    const normalizedKeyword = keyword.trim();
    return normalizedKeyword !== '' && includesIgnoreCase(message, normalizedKeyword);
  });
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function includesIgnoreCase(source, target) {
  return source.toLowerCase().includes(target.toLowerCase());
}
