// KPI v2 is an append-only outcome ledger, not a chat counter. Every settlement keeps its
// classification and provenance; dashboard numbers are derived on read so automatic policy
// acceptance can never masquerade as explicit user acceptance.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadWorkspaceCapabilityGrants } from "./employee-tools.mjs";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const KPI_CONTRACT = "crewclaw.kpi/v2";

const SAFE_AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILLS_PER_OUTCOME = 100;
export const SKILL_RETIREMENT_MIN_SETTLED_TASKS = 3;
const TASK_KINDS = new Set(["formal", "chat", "artifact_action"]);
const OUTCOMES = new Set([
  "completed",
  "accepted",
  "auto_accepted",
  "rejected",
  "revision_requested",
  "correctly_blocked",
  "failed",
]);
const ACCEPTANCE_SOURCES = new Set(["user", "policy", "none"]);
const SUCCESSFUL_SKILL_OUTCOMES = new Set([
  "completed",
  "accepted",
  "auto_accepted",
  "correctly_blocked",
]);
const NEGATIVE_SKILL_OUTCOMES = new Set([
  "rejected",
  "revision_requested",
  "failed",
]);

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function kpiPath(root, agentId) {
  if (!SAFE_AGENT_ID.test(String(agentId || ""))) {
    throw new Error("invalid KPI employee id");
  }
  return resolveStatePath(
    join(root, ".crewclaw", "kpi", `${agentId}.json`),
    root
  );
}

function activeHireTimestamp(root, agentId) {
  const hiredAt = loadWorkspaceCapabilityGrants({
    root,
    employeeId: agentId,
  }).employee?.hired_at;
  const value = typeof hiredAt === "string" ? Date.parse(hiredAt) : NaN;
  return Number.isFinite(value) ? value : null;
}

function emptyDocument(agentId) {
  return {
    contract: KPI_CONTRACT,
    employee_id: agentId,
    first_hired_ts: null,
    legacy: { unclassified_tasks: 0, accepted_claims: 0, total_cost: 0 },
    outcomes: [],
  };
}

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeSkillUsage(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILLS_PER_OUTCOME) {
    throw new Error("invalid KPI skill_usage");
  }
  const seen = new Set();
  return value
    .map(entry => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).some(key => !["skill_id", "calls"].includes(key)) ||
        !SAFE_SKILL_ID.test(String(entry.skill_id || "")) ||
        !Number.isSafeInteger(entry.calls) ||
        entry.calls < 1
      ) {
        throw new Error("invalid KPI skill_usage entry");
      }
      if (seen.has(entry.skill_id)) {
        throw new Error("duplicate KPI skill_usage entry");
      }
      seen.add(entry.skill_id);
      return { skill_id: entry.skill_id, calls: entry.calls };
    })
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id, "en"));
}

function validateOutcome(value) {
  if (!value || typeof value !== "object")
    throw new Error("invalid KPI outcome");
  if (typeof value.id !== "string" || !value.id)
    throw new Error("missing KPI outcome id");
  if (typeof value.task_run_id !== "string" || !value.task_run_id)
    throw new Error("missing KPI task_run_id");
  if (!TASK_KINDS.has(value.task_kind))
    throw new Error("invalid KPI task_kind");
  if (!OUTCOMES.has(value.outcome))
    throw new Error("invalid KPI outcome value");
  if (!ACCEPTANCE_SOURCES.has(value.acceptance_source))
    throw new Error("invalid KPI acceptance_source");
  if (value.outcome === "accepted" && value.acceptance_source !== "user")
    throw new Error("accepted requires user provenance");
  if (value.outcome === "auto_accepted" && value.acceptance_source !== "policy")
    throw new Error("auto_accepted requires policy provenance");
  if (
    !["accepted", "auto_accepted"].includes(value.outcome) &&
    value.acceptance_source !== "none"
  )
    throw new Error("non-acceptance outcome cannot claim an acceptance source");
  normalizeSkillUsage(value.skill_usage);
  for (const key of [
    "cost_usd",
    "duration_ms",
    "evidence_count",
    "permission_violations",
    "safety_violations",
    "ts",
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < 0)
      throw new Error(`invalid KPI ${key}`);
  }
  return value;
}

function parseDocument(raw, agentId) {
  const parsed = JSON.parse(raw);
  if (parsed?.contract === KPI_CONTRACT) {
    if (parsed.employee_id !== agentId)
      throw new Error("KPI employee_id mismatch");
    if (!Array.isArray(parsed.outcomes))
      throw new Error("KPI outcomes must be an array");
    const ids = new Set();
    const taskIds = new Set();
    for (const item of parsed.outcomes) {
      validateOutcome(item);
      if (ids.has(item.id)) throw new Error("duplicate KPI outcome id");
      if (taskIds.has(item.task_run_id))
        throw new Error("duplicate KPI task settlement");
      ids.add(item.id);
      taskIds.add(item.task_run_id);
    }
    return {
      contract: KPI_CONTRACT,
      employee_id: agentId,
      first_hired_ts: Number.isFinite(parsed.first_hired_ts)
        ? parsed.first_hired_ts
        : null,
      legacy: {
        unclassified_tasks: finiteNonNegative(
          parsed.legacy?.unclassified_tasks
        ),
        accepted_claims: finiteNonNegative(parsed.legacy?.accepted_claims),
        total_cost: finiteNonNegative(parsed.legacy?.total_cost),
      },
      outcomes: parsed.outcomes,
    };
  }
  // v1 called chat turns "tasks" and did not preserve enough evidence to recover their kind.
  // Keep those counters visible as unclassified legacy data, never promote them into v2 KPIs.
  if (
    parsed &&
    typeof parsed === "object" &&
    Number.isFinite(parsed.tasks) &&
    Number.isFinite(parsed.accepted) &&
    Number.isFinite(parsed.total_cost)
  ) {
    return {
      ...emptyDocument(agentId),
      first_hired_ts: Number.isFinite(parsed.first_hired_ts)
        ? parsed.first_hired_ts
        : null,
      legacy: {
        unclassified_tasks: finiteNonNegative(parsed.tasks),
        accepted_claims: finiteNonNegative(parsed.accepted),
        total_cost: finiteNonNegative(parsed.total_cost),
      },
    };
  }
  throw new Error(
    "KPI document must be KPI v2 or a complete KPI v1 counter document"
  );
}

function readDocument(root, agentId) {
  const file = kpiPath(root, agentId);
  if (!existsSync(file)) return emptyDocument(agentId);
  return parseDocument(
    readStateFileGuarded(file, { root }).toString("utf8"),
    agentId
  );
}

/** Atomically convert one complete v1 counter file into the v2 legacy bucket. */
export function migrateKpiV1(root, agentId) {
  const file = kpiPath(root, agentId);
  if (!existsSync(file)) {
    return { migrated: false, document: emptyDocument(agentId) };
  }
  const initialRaw = readStateFileGuarded(file, { root }).toString("utf8");
  const initialParsed = JSON.parse(initialRaw);
  if (initialParsed?.contract === KPI_CONTRACT) {
    return { migrated: false, document: parseDocument(initialRaw, agentId) };
  }
  // Validate before taking the writer lock. Arbitrary or corrupt objects are never rewritten.
  parseDocument(initialRaw, agentId);
  return withStateLock(
    `${file}.lock`,
    () => {
      const currentRaw = readStateFileGuarded(file, { root }).toString("utf8");
      const currentParsed = JSON.parse(currentRaw);
      const document = parseDocument(currentRaw, agentId);
      if (currentParsed?.contract === KPI_CONTRACT) {
        return { migrated: false, document };
      }
      writeJsonAtomic(file, document, { root });
      return { migrated: true, document };
    },
    { root }
  );
}

function summarize(document) {
  const formal = document.outcomes.filter(item => item.task_kind === "formal");
  const count = outcome =>
    formal.filter(item => item.outcome === outcome).length;
  const totalCost = document.outcomes.reduce(
    (sum, item) => sum + item.cost_usd,
    0
  );
  const totalDuration = formal.reduce((sum, item) => sum + item.duration_ms, 0);
  const evidenced = formal.filter(item => item.evidence_count > 0).length;
  const successful = formal.filter(item =>
    ["completed", "accepted", "auto_accepted", "correctly_blocked"].includes(
      item.outcome
    )
  ).length;
  const skills = summarizeSkillPerformance(document.outcomes);
  return {
    contract: KPI_CONTRACT,
    tasks: formal.length,
    successful,
    completed: count("completed"),
    accepted: count("accepted"),
    auto_accepted: count("auto_accepted"),
    rejected: count("rejected"),
    revision_requested: count("revision_requested"),
    correctly_blocked: count("correctly_blocked"),
    failed: count("failed"),
    chat_turns: document.outcomes.filter(item => item.task_kind === "chat")
      .length,
    artifact_actions: document.outcomes.filter(
      item => item.task_kind === "artifact_action"
    ).length,
    total_cost: round(totalCost),
    cost_currency: "USD",
    average_cost: document.outcomes.length
      ? round(totalCost / document.outcomes.length)
      : 0,
    average_duration_ms: formal.length
      ? Math.round(totalDuration / formal.length)
      : null,
    evidence_coverage: formal.length ? evidenced / formal.length : null,
    permission_violations: document.outcomes.reduce(
      (sum, item) => sum + item.permission_violations,
      0
    ),
    safety_violations: document.outcomes.reduce(
      (sum, item) => sum + item.safety_violations,
      0
    ),
    skills,
    skill_retirement_candidates: skills
      .filter(skill => skill.retirement_candidate)
      .map(skill => skill.skill_id),
    first_hired_ts: document.first_hired_ts,
    outcomes_count: document.outcomes.length,
    legacy_unclassified_tasks: document.legacy.unclassified_tasks,
    legacy_accepted_claims: document.legacy.accepted_claims,
    legacy_total_cost: document.legacy.total_cost,
  };
}

function summarizeSkillPerformance(outcomes) {
  const bySkill = new Map();
  for (const outcome of outcomes) {
    for (const usage of normalizeSkillUsage(outcome.skill_usage)) {
      const current = bySkill.get(usage.skill_id) || {
        skill_id: usage.skill_id,
        calls: 0,
        observed_tasks: 0,
        settled_tasks: 0,
        successful_tasks: 0,
        accepted_tasks: 0,
        auto_accepted_tasks: 0,
        negative_tasks: 0,
        last_used_ts: null,
      };
      current.calls += usage.calls;
      current.observed_tasks += 1;
      current.last_used_ts = Math.max(current.last_used_ts || 0, outcome.ts);
      if (outcome.task_kind === "formal") {
        current.settled_tasks += 1;
        if (SUCCESSFUL_SKILL_OUTCOMES.has(outcome.outcome)) {
          current.successful_tasks += 1;
        }
        if (outcome.outcome === "accepted") current.accepted_tasks += 1;
        if (outcome.outcome === "auto_accepted") {
          current.auto_accepted_tasks += 1;
        }
        if (NEGATIVE_SKILL_OUTCOMES.has(outcome.outcome)) {
          current.negative_tasks += 1;
        }
      }
      bySkill.set(usage.skill_id, current);
    }
  }
  return [...bySkill.values()]
    .map(skill => {
      const accepted = skill.accepted_tasks + skill.auto_accepted_tasks;
      const successRate = skill.settled_tasks
        ? round(skill.successful_tasks / skill.settled_tasks)
        : null;
      return {
        ...skill,
        success_rate: successRate,
        acceptance_rate: skill.settled_tasks
          ? round(accepted / skill.settled_tasks)
          : null,
        retirement_candidate:
          skill.settled_tasks >= SKILL_RETIREMENT_MIN_SETTLED_TASKS &&
          accepted === 0 &&
          successRate < 0.5,
      };
    })
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id, "en"));
}

/** Missing state is distinct from unreadable state; a valid v1 document is migrated once. */
export function readKpi(root, agentId) {
  try {
    const file = kpiPath(root, agentId);
    if (!existsSync(file)) {
      return {
        ...summarize(emptyDocument(String(agentId || "unknown"))),
        state: "missing",
        error: null,
      };
    }
    return {
      ...summarize(migrateKpiV1(root, agentId).document),
      state: "valid",
      error: null,
    };
  } catch {
    return {
      ...summarize(emptyDocument(String(agentId || "unknown"))),
      state: "invalid",
      error: "KPI state is unreadable or invalid.",
    };
  }
}

/**
 * Append exactly one terminal work outcome. The legacy `accepted` option remains a compatibility
 * input, but new callers should always provide taskKind/outcome/acceptanceSource explicitly.
 */
export function recordTaskOutcome(
  root,
  agentId,
  {
    taskRunId,
    taskKind = "formal",
    outcome,
    acceptanceSource,
    accepted,
    cost = 0,
    durationMs = 0,
    evidenceCount = 0,
    permissionViolations = 0,
    safetyViolations = 0,
    skillUsage = [],
    ts = Date.now(),
  } = {}
) {
  if (!SAFE_AGENT_ID.test(String(agentId || ""))) return null;
  const resolvedOutcome =
    outcome || (accepted === true ? "accepted" : "completed");
  const resolvedAcceptance =
    acceptanceSource ||
    (resolvedOutcome === "accepted"
      ? "user"
      : resolvedOutcome === "auto_accepted"
        ? "policy"
        : "none");
  const resolvedTaskId = String(
    taskRunId || `legacy-${ts}-${Math.random().toString(16).slice(2)}`
  );
  const item = validateOutcome({
    id: `outcome-${resolvedTaskId}`,
    task_run_id: resolvedTaskId,
    task_kind: taskKind,
    outcome: resolvedOutcome,
    acceptance_source: resolvedAcceptance,
    cost_usd: finiteNonNegative(Number(cost)),
    duration_ms: finiteNonNegative(Number(durationMs)),
    evidence_count: Math.floor(finiteNonNegative(Number(evidenceCount))),
    permission_violations: Math.floor(
      finiteNonNegative(Number(permissionViolations))
    ),
    safety_violations: Math.floor(finiteNonNegative(Number(safetyViolations))),
    skill_usage: normalizeSkillUsage(skillUsage),
    ts: finiteNonNegative(Number(ts), Date.now()),
  });
  try {
    const file = kpiPath(root, agentId);
    return withStateLock(
      `${file}.lock`,
      () => {
        const current = readDocument(root, agentId);
        const prior = current.outcomes.find(
          entry => entry.task_run_id === resolvedTaskId
        );
        if (prior) return summarize(current);
        const hiredAt = activeHireTimestamp(root, agentId);
        const next = {
          ...current,
          first_hired_ts:
            hiredAt === null
              ? current.first_hired_ts
              : current.first_hired_ts === null
                ? hiredAt
                : Math.min(current.first_hired_ts, hiredAt),
          outcomes: [...current.outcomes, item],
        };
        writeJsonAtomic(file, next, { root });
        return summarize(next);
      },
      { root }
    );
  } catch (error) {
    if (process.env.CREW_STATE_LOCK_DEBUG === "1")
      console.error(`recordTaskOutcome: ${error?.stack || error}`);
    return null;
  }
}

export function readKpiLedger(root, agentId) {
  try {
    return migrateKpiV1(root, agentId).document;
  } catch {
    return null;
  }
}
