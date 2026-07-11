import { estimateCost } from "./budget-guard.mjs";

const DEFAULT_SOFT_TOKENS = 50_000;
const DEFAULT_HARD_TOKENS = 90_000;
const ACTIVE_CONTEXT_LIMIT = 8;

const GREETING_PATTERNS = [
  /^hi$/i,
  /^hello$/i,
  /^hey$/i,
  /^hi there$/i,
  /^hello there$/i,
  /^你好$/,
  /^您好$/,
  /^早$/,
  /^早上好$/,
  /^嗨$/,
  /^哈喽$/,
];

export function newBudget({
  soft = DEFAULT_SOFT_TOKENS,
  hard = DEFAULT_HARD_TOKENS,
} = {}) {
  return {
    soft,
    hard,
    spent: {
      promptTok: 0,
      completionTok: 0,
    },
  };
}

export function addUsage(budget, usage = {}) {
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;

  return {
    ...budget,
    spent: {
      promptTok: budget.spent.promptTok + promptTokens,
      completionTok: budget.spent.completionTok + completionTokens,
    },
  };
}

export function budgetStatus(budget) {
  const promptTokens = budget.spent.promptTok;
  const completionTokens = budget.spent.completionTok;
  const totalTokens = promptTokens + completionTokens;
  const { cost } = estimateCost({ promptTokens, completionTokens });

  let status = "ok";
  if (totalTokens >= budget.hard) {
    status = "hard_exceeded";
  } else if (totalTokens >= budget.soft) {
    status = "soft_exceeded";
  }

  return { status, cost };
}

export function shouldLoadFullContext(message) {
  const normalized = String(message ?? "")
    .trim()
    .replace(/[!！.。?？,，\s]+$/u, "");

  if (!normalized) return false;
  return !GREETING_PATTERNS.some(pattern => pattern.test(normalized));
}

export function compactPlan(messages = []) {
  const keep = [];
  const summarize = [];
  const drop_to_artifact_refs = [];
  const nonArtifact = [];

  for (const message of messages) {
    if (message?.metadata?.type === "artifact") {
      drop_to_artifact_refs.push(message);
    } else {
      nonArtifact.push(message);
    }
  }

  const activeStart = Math.max(0, nonArtifact.length - ACTIVE_CONTEXT_LIMIT);

  nonArtifact.forEach((message, index) => {
    if (message?.role === "system") {
      keep.push(message);
      return;
    }

    if (shouldSummarizeMessage(message) || index < activeStart) {
      summarize.push(message);
      return;
    }

    keep.push(message);
  });

  return { keep, summarize, drop_to_artifact_refs };
}

export const commands = [
  {
    cmd: "/compact",
    description:
      "Summarize conversation, drop artifact bodies, keep active task context",
  },
  { cmd: "/reset", description: "Clear all context, start fresh session" },
  {
    cmd: "/new task",
    description: "Archive current task, open new task context",
  },
  {
    cmd: "/archive task",
    description: "Move completed task to archive, free context budget",
  },
];

function shouldSummarizeMessage(message) {
  const type = message?.metadata?.type;
  return (
    type === "skill_doc" ||
    type === "greeting" ||
    type === "quick_utility" ||
    message?.metadata?.runType === "quick_utility" ||
    message?.metadata?.scope === "quick_utility" ||
    !shouldLoadFullContext(message?.content)
  );
}
