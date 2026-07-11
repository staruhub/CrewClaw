// 裸待办令牌：数字 1-9（route 会发 1=接受 2=修订 3=打开位置 等）与 accept/reject 别名。
const BARE_PENDING_ACTION_RE = /^(?:[1-9]|a|b|accept|reject)$/i;

const DEFAULT_SCOPE_KEYWORDS = [
  "AI落地",
  "模型选型",
  "Agent工作流",
  "知识问答",
  "LLM",
  "RAG",
  "embedding",
  "prompt",
];

const RULES = {
  // A bare social greeting ("hi"/"你好") is light chat, not an unmatched query — it
  // must reach the model as employee_chat instead of the ambiguous clarify fallback.
  greeting: /^(?:hi|hello|hey|你好|嗨)$/i,
  memory: /记住|记一下|jizhu|remember|别忘/i,
  quickUtility: /天气|weather|几点|时间|算一下|换算|calculator/i,
  artifact: /输出.*markdown|生成文件|导出|打开文件夹|保存为|open folder/i,
  outOfScope: /写诗|情诗|讲笑话|poem|love poem|joke/i,
  deliverable:
    /报告|表格|PPT|代码|ROI|预算|选型|路线图|研究|联网查证|多步骤|report|analysis|research|implement|build|最新.*模型|模型.*发布/i,
  // A task that can only be answered by looking things up on the live web — latest
  // releases, prices, news, "查一下/搜一下". Preflight must verify a real search
  // provider before starting one of these; no provider ⇒ block (AC-003, CC-TOOL-001).
  needsSearch:
    /最新|最近|今年|今天|现在|查一下|搜一下|联网|上网|新闻|发布|价格|报价|多少钱|latest|newest|recent|today|current|search the web|look up|news|price|release/i,
};

export function classifyIntent(message, ctx = {}) {
  const normalizedMessage = normalizeMessage(message);

  if (BARE_PENDING_ACTION_RE.test(normalizedMessage)) {
    const matchedPendingAction = findPendingAction(
      normalizedMessage,
      ctx.pendingActions
    );

    if (matchedPendingAction) {
      return {
        type: "employee_chat",
        reason: "bare token matched pending action",
        matchedPendingAction,
      };
    }

    // 有待办但按错了号 → 这才是真歧义，值得澄清（"或直接选上面的待办编号"此时才成立）。
    if (Array.isArray(ctx.pendingActions) && ctx.pendingActions.length > 0) {
      return {
        type: "ambiguous",
        reason: "bare action token without matching pending action",
      };
    }
    // 没有任何待办时，裸 "1" 只是普通输入——交给模型，别用不存在的待办去教育用户。
    return {
      type: "employee_chat",
      reason: "bare token with no pending actions",
    };
  }

  if (RULES.memory.test(normalizedMessage)) {
    return { type: "memory_command", reason: "matched memory keyword" };
  }

  if (RULES.quickUtility.test(normalizedMessage)) {
    return { type: "quick_utility", reason: "matched quick utility keyword" };
  }

  if (RULES.artifact.test(normalizedMessage)) {
    return {
      type: "artifact_action",
      reason: "matched artifact action keyword",
    };
  }

  if (RULES.outOfScope.test(normalizedMessage)) {
    return { type: "out_of_scope", reason: "matched out-of-scope keyword" };
  }

  if (isDeliverableRequest(normalizedMessage)) {
    return {
      type: "employee_task",
      reason: "matched deliverable or task keyword",
      upgradeToTaskRun: true,
      needsSearch: RULES.needsSearch.test(normalizedMessage),
    };
  }

  if (matchesEmployeeScope(normalizedMessage, ctx.employeeScope)) {
    return { type: "employee_chat", reason: "matched employee scope keyword" };
  }

  if (RULES.greeting.test(normalizedMessage)) {
    return { type: "employee_chat", reason: "light social greeting" };
  }

  // 默认交给模型（employee_chat），不再回"没太理解"。数字员工的兜底理解能力就是模型
  // 本身——白名单规则只负责把特殊意图（记忆/工具/交付任务/出格）分流，分不出来的
  // 一律让模型接住（"你可以做什么?" 这类开放问题曾被 ambiguous 拒答，是真实用户卡点）。
  return {
    type: "employee_chat",
    reason: "default: unmatched message goes to the model",
  };
}

export function shouldUpgradeToTaskRun(message) {
  return isDeliverableRequest(normalizeMessage(message));
}

function normalizeMessage(message) {
  return String(message ?? "").trim();
}

function findPendingAction(token, pendingActions = []) {
  if (!Array.isArray(pendingActions)) {
    return undefined;
  }

  const normalizedToken = token.toLowerCase();

  return pendingActions.find(action => {
    const key = action?.key;
    return (
      key !== undefined && String(key).trim().toLowerCase() === normalizedToken
    );
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

  return scopeKeywords.some(keyword => {
    const normalizedKeyword = keyword.trim();
    return (
      normalizedKeyword !== "" && includesIgnoreCase(message, normalizedKeyword)
    );
  });
}

function toStringArray(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string")
    : [];
}

function includesIgnoreCase(source, target) {
  return source.toLowerCase().includes(target.toLowerCase());
}
