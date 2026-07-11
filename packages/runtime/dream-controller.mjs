// M2 — deterministic DreamController. It decides WHEN curation is worth proposing; it never
// calls a model and never mutates active memory. Candidate generation is M3, activation is M4.
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { dreamJobPath, reflectionsDir } from "./dream-paths.mjs";
import {
  computeMemoryStateHash,
  estimateInjectionTokens,
  normalizeMemoryText,
} from "./memory-hash.mjs";
import { estimateCost } from "./budget-guard.mjs";
import { loadMemory } from "./memory-store.mjs";
import { isTrustedReflection } from "./reflect.mjs";
import {
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const DREAM_EVENT_FAMILY = "dream/v1";
export const DREAM_JOB_CONTRACT = "crewclaw.dream-job/v1";

export const DEFAULT_DREAM_POLICY = Object.freeze({
  mode: "recommended",
  triggers: Object.freeze({
    min_accepted_tasks: 8,
    memory_pressure_ratio: 0.7,
    duplicate_ratio: 0.15,
    stale_ratio: 0.1,
    conflict_count: 2,
    repeat_task_count: 3,
    recommendation_score: 0.7,
  }),
  eligibility: Object.freeze({ trusted_input_ratio: 0.9 }),
  budget: Object.freeze({ memory_budget_tokens: 8_000, max_model_cost_usd: null }),
  cooldown: Object.freeze({ hours: 24 }),
  limits: Object.freeze({ max_batch_tasks: 32 }),
});

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const ratio = (value, threshold) =>
  threshold > 0 ? clamp((Number(value) || 0) / threshold) : 0;

function mergePolicy(policy = {}) {
  const mode = new Set(["recommended", "manual", "disabled"]).has(policy?.mode)
    ? policy.mode
    : DEFAULT_DREAM_POLICY.mode;
  const merged = {
    mode,
    triggers: { ...DEFAULT_DREAM_POLICY.triggers, ...(policy?.triggers || {}) },
    eligibility: {
      ...DEFAULT_DREAM_POLICY.eligibility,
      ...(policy?.eligibility || {}),
    },
    budget: { ...DEFAULT_DREAM_POLICY.budget, ...(policy?.budget || {}) },
    cooldown: { ...DEFAULT_DREAM_POLICY.cooldown, ...(policy?.cooldown || {}) },
    limits: { ...DEFAULT_DREAM_POLICY.limits, ...(policy?.limits || {}) },
  };
  merged.limits.max_batch_tasks = Math.min(
    100,
    Math.max(1, Number(merged.limits.max_batch_tasks) || 32)
  );
  return merged;
}

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(",")}}`;
}

function canonicalHash(value) {
  const canonical = canonicalStringify(value);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function loadReflectionPool(root, employeeId, { maxFiles = 10_000 } = {}) {
  const dir = reflectionsDir(root, employeeId);
  if (!existsSync(dir)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const name of readdirSync(dir).filter(name => name.endsWith(".json")).sort().slice(0, maxFiles)) {
    try {
      const path = join(dir, name);
      const record = JSON.parse(readStateFileGuarded(path, { root }).toString("utf8"));
      if (record?.employee_id !== employeeId) throw new Error("employee mismatch");
      records.push(record);
    } catch (error) {
      errors.push({ file: name, reason: error?.message || String(error) });
    }
  }
  return { records, errors };
}

function duplicateRatio(items) {
  const active = (items || []).filter(item => item?.status === undefined || item.status === "active");
  if (active.length === 0) return 0;
  const keys = active.map(item => `${item.category}\u0000${normalizeMemoryText(item.text).toLowerCase()}`);
  return (keys.length - new Set(keys).size) / keys.length;
}

function staleRatio(items, nowMs) {
  const active = (items || []).filter(item => item?.status === undefined || item.status === "active");
  if (active.length === 0) return 0;
  const stale = active.filter(item => item.valid_until && Date.parse(item.valid_until) <= nowMs).length;
  return stale / active.length;
}

function conflictCount(items) {
  const active = (items || []).filter(item => item?.status === undefined || item.status === "active");
  const consumed = new Set();
  let conflicts = 0;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].category !== active[j].category) continue;
      const a = normalizeMemoryText(active[i].text).toLowerCase();
      const b = normalizeMemoryText(active[j].text).toLowerCase();
      if (a === b) continue;
      if (active[i].supersedes === b || active[j].supersedes === a) {
        const key = `${i}:${j}`;
        if (!consumed.has(key)) {
          consumed.add(key);
          conflicts++;
        }
      }
    }
  }
  return conflicts;
}

function repeatedFailureCount(reflections) {
  const byPattern = new Map();
  for (const reflection of reflections) {
    for (const failure of reflection.verified_failures || []) {
      const key = `${failure.code}\u0000${failure.tool || ""}`;
      const tasks = byPattern.get(key) || new Set();
      tasks.add(reflection.task_id);
      byPattern.set(key, tasks);
    }
  }
  return Math.max(0, ...[...byPattern.values()].map(tasks => tasks.size));
}

function scoreMetrics(metrics, policy) {
  const t = policy.triggers;
  const pressure = Math.max(
    ratio(metrics.accepted_tasks, t.min_accepted_tasks),
    ratio(metrics.memory_pressure_ratio, t.memory_pressure_ratio),
    ratio(metrics.duplicate_ratio, t.duplicate_ratio)
  );
  const repeated = ratio(metrics.repeated_pattern_count, t.repeat_task_count);
  const hygiene = Math.max(
    ratio(metrics.stale_ratio, t.stale_ratio),
    ratio(metrics.conflict_count, t.conflict_count)
  );
  const reuse = Math.max(repeated, ratio(metrics.accepted_tasks, t.min_accepted_tasks));
  return Math.round(
    (0.3 * pressure +
      0.25 * repeated +
      0.2 * clamp(metrics.trusted_input_ratio) +
      0.15 * hygiene +
      0.1 * reuse) *
      10_000
  ) / 10_000;
}

/** Pure two-gate decision. Manual trigger bypasses soft thresholds/cooldown, never safety gates. */
export function assessDream({
  employeeId,
  reflections = [],
  memoryItems = [],
  baseline = null,
  policy: rawPolicy,
  employeeIdle = true,
  budgetAvailable = true,
  recommendationEnabled = true,
  manualTrigger = false,
  lastDreamAt = null,
  now = Date.now(),
} = {}) {
  const policy = mergePolicy(rawPolicy);
  const nonLegacy = reflections.filter(record => record?.legacy_committed !== true);
  const trusted = nonLegacy.filter(isTrustedReflection);
  const selected = trusted
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(-policy.limits.max_batch_tasks);
  const memoryState = computeMemoryStateHash(memoryItems);
  const trustedRatio = nonLegacy.length ? trusted.length / nonLegacy.length : 0;
  const acceptedTasks = new Set(
    trusted.filter(record => record.outcome === "accepted").map(record => record.task_id)
  ).size;
  const metrics = {
    accepted_tasks: acceptedTasks,
    trusted_input_ratio: trustedRatio,
    memory_tokens: memoryState.estimated_injection_tokens,
    memory_pressure_ratio:
      memoryState.estimated_injection_tokens / policy.budget.memory_budget_tokens,
    duplicate_ratio: duplicateRatio(memoryItems),
    stale_ratio: staleRatio(memoryItems, Number(now)),
    conflict_count: conflictCount(memoryItems),
    repeated_pattern_count: repeatedFailureCount(trusted),
  };
  metrics.recommendation_score = scoreMetrics(metrics, policy);
  const estimatedInputTokens =
    memoryState.estimated_injection_tokens +
    selected.reduce((sum, record) => sum + estimateInjectionTokens(JSON.stringify(record)), 0) +
    1_000;
  const estimatedOutputTokens = Math.max(
    512,
    Math.ceil(memoryState.estimated_injection_tokens * 0.75),
    selected.length * 64
  );
  const estimatedCost = estimateCost({
    promptTokens: estimatedInputTokens,
    completionTokens: estimatedOutputTokens,
  }).cost;

  const cooldownUntil = lastDreamAt
    ? Date.parse(lastDreamAt) + policy.cooldown.hours * 3_600_000
    : 0;
  const curationBlockers = [];
  if (policy.mode === "disabled") curationBlockers.push("dream_disabled");
  if (!employeeIdle) curationBlockers.push("employee_busy");
  if (!budgetAvailable) curationBlockers.push("budget_unavailable");
  if (
    Number.isFinite(policy.budget.max_model_cost_usd) &&
    estimatedCost > policy.budget.max_model_cost_usd
  )
    curationBlockers.push("dream_cost_cap_exceeded");
  if (trusted.length === 0) curationBlockers.push("no_trusted_input");
  if (trustedRatio < policy.eligibility.trusted_input_ratio)
    curationBlockers.push("trusted_input_ratio_low");
  if (!manualTrigger && cooldownUntil > Number(now)) curationBlockers.push("cooldown_active");

  const triggerReasons = [];
  const t = policy.triggers;
  if (metrics.accepted_tasks >= t.min_accepted_tasks) triggerReasons.push("accepted_tasks");
  if (metrics.memory_pressure_ratio >= t.memory_pressure_ratio) triggerReasons.push("memory_pressure");
  if (metrics.duplicate_ratio >= t.duplicate_ratio) triggerReasons.push("duplicate_pressure");
  if (metrics.stale_ratio >= t.stale_ratio) triggerReasons.push("stale_pressure");
  if (metrics.conflict_count >= t.conflict_count) triggerReasons.push("conflict_pressure");
  if (metrics.repeated_pattern_count >= t.repeat_task_count) triggerReasons.push("repeated_pattern");
  if (metrics.recommendation_score >= t.recommendation_score) triggerReasons.push("recommendation_score");
  if (manualTrigger) triggerReasons.push("manual_trigger");

  const curationEligible = curationBlockers.length === 0;
  const modeAllowsRecommendation =
    manualTrigger || (policy.mode === "recommended" && recommendationEnabled);
  const recommended =
    curationEligible && modeAllowsRecommendation && triggerReasons.length > 0;

  const activationBlockers = [];
  if (!baseline) activationBlockers.push("baseline_missing");
  else {
    if (baseline.mock !== false) activationBlockers.push("baseline_not_real");
    if (baseline.provider_status && baseline.provider_status !== "verified")
      activationBlockers.push("baseline_provider_unverified");
    if (baseline.memory_state_hash !== memoryState.memory_state_hash)
      activationBlockers.push("baseline_memory_mismatch");
  }
  // Candidate eval, approval, safety, and base-hash checks are intentionally unresolved until
  // M3/M4; report them as next-stage requirements, not curation blockers.
  activationBlockers.push("candidate_eval_required", "human_approval_required");

  return {
    contract: "crewclaw.dream-assessment/v1",
    employee_id: employeeId,
    assessed_at: new Date(Number(now)).toISOString(),
    policy,
    metrics,
    cost: {
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      estimated_usd: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    },
    input: {
      reflection_ids: selected.map(record => record.task_id),
      task_run_ids: selected.map(record => record.task_id),
      evidence_ids: [...new Set(selected.flatMap(record => record.evidence_ids || []))],
      input_snapshot_hash: canonicalHash(
        selected
      ),
    },
    base_memory_hash: memoryState.memory_state_hash,
    curation: { eligible: curationEligible, blockers: curationBlockers },
    activation: { eligible: activationBlockers.length === 0, blockers: activationBlockers },
    trigger_reasons: triggerReasons,
    recommended,
    cooldown_until: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
  };
}

export function assessDreamFromWorkspace(root, employeeId, options = {}) {
  const pool = loadReflectionPool(root, employeeId);
  const memory = loadMemory(root, employeeId);
  const assessment = assessDream({
      employeeId,
      reflections: pool.records,
      memoryItems: memory.items,
      ...options,
    });
  const inputErrors = [...pool.errors];
  if (memory.error) inputErrors.push({ file: "active-memory", reason: memory.error });
  if (inputErrors.length > 0) {
    assessment.curation.eligible = false;
    assessment.curation.blockers = [
      ...new Set([...assessment.curation.blockers, "input_state_unreadable"]),
    ];
    assessment.recommended = false;
  }
  return { ...assessment, input_errors: inputErrors };
}

/** Persist a RECOMMENDED job only; M3 owns QUEUED→DREAMING and candidate artifacts. */
export function persistDreamRecommendation(root, assessment, { dreamId } = {}) {
  if (!assessment?.recommended) {
    return { ok: false, written: false, reason: "dream is not recommended" };
  }
  const id = dreamId || `dream-${Date.now()}`;
  const path = dreamJobPath(root, assessment.employee_id, id);
  const job = {
    contract: DREAM_JOB_CONTRACT,
    dream_id: id,
    employee_id: assessment.employee_id,
    model: null,
    created_at: assessment.assessed_at,
    state: "RECOMMENDED",
    base_memory_hash: assessment.base_memory_hash,
    candidate_memory_hash: null,
    input: assessment.input,
    cost: { estimated_usd: assessment.cost.estimated_usd, actual_usd: null },
  };
  const identity = value => ({
    contract: value?.contract,
    dream_id: value?.dream_id,
    employee_id: value?.employee_id,
    state: value?.state,
    base_memory_hash: value?.base_memory_hash,
    input: value?.input,
  });
  return withStateLock(
    `${path}.lock`,
    () => {
      if (existsSync(path)) {
        const existing = JSON.parse(readStateFileGuarded(path, { root }).toString("utf8"));
        if (canonicalHash(identity(existing)) !== canonicalHash(identity(job))) {
          return {
            ok: false,
            written: false,
            path,
            reason: "dream recommendation id already exists with different content",
          };
        }
        return { ok: true, written: false, path, job: existing };
      }
      writeJsonAtomic(path, job, { root });
      return { ok: true, written: true, path, job };
    },
    { root }
  );
}
