import * as budgetGuard from "./budget-guard.mjs";

const REQUIRED_COMPLETION_EVENTS = [
  "plan.created",
  "artifact.created",
  "outcome.checked",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function tokenUsage(value = {}) {
  return {
    prompt_tokens: numberOrZero(
      firstDefined(
        value.prompt_tokens,
        value.promptTokens,
        value.input_tokens,
        value.inputTokens
      )
    ),
    completion_tokens: numberOrZero(
      firstDefined(
        value.completion_tokens,
        value.completionTokens,
        value.output_tokens,
        value.outputTokens
      )
    ),
  };
}

function eventType(event) {
  if (typeof event === "string") return event;
  return event?.type ?? event?.event_type ?? event?.event ?? null;
}

function eventTypes(taskRun = {}) {
  return new Set(
    asArray(firstDefined(taskRun.timeline_events, taskRun.events))
      .map(eventType)
      .filter(Boolean)
  );
}

export function assembleProofPack(taskRun = {}) {
  const usage = firstDefined(taskRun.usage, taskRun.cost);

  return {
    task_run_id: taskRun.task_run_id ?? null,
    plan_snapshot: taskRun.plan ?? null,
    timeline_events: asArray(
      firstDefined(taskRun.timeline_events, taskRun.events)
    ),
    tool_calls: asArray(firstDefined(taskRun.tool_calls, taskRun.tools)),
    artifacts: asArray(taskRun.artifacts),
    evidence_cards: asArray(taskRun.evidence),
    outcome_checks: asArray(taskRun.outcome_checks),
    user_approval: taskRun.approval ?? null,
    cost_summary: usage === null ? null : costSummary(usage),
  };
}

export function validateCompletion(taskRun = {}) {
  const types = eventTypes(taskRun);
  const missing = REQUIRED_COMPLETION_EVENTS.filter(type => !types.has(type));
  const approvalPresent =
    types.has("approval.requested") || Boolean(taskRun.approval);

  if (!approvalPresent) {
    missing.push("approval.requested");
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function costSummary(usage = {}) {
  const tokens = tokenUsage(usage);
  let cost;

  if (typeof budgetGuard.estimateCost === "function") {
    cost = budgetGuard.estimateCost({
      promptTokens: tokens.prompt_tokens,
      completionTokens: tokens.completion_tokens,
    }).cost;
  } else {
    cost =
      tokens.prompt_tokens * 0.000002 + tokens.completion_tokens * 0.000008;
  }

  return {
    prompt_tokens: tokens.prompt_tokens,
    completion_tokens: tokens.completion_tokens,
    cost: numberOrZero(cost),
  };
}
