// Dream lifecycle controller. Recommendation stays deterministic; M3 candidate generation and
// M4 activation/rollback are explicit, auditable transitions and never expose staged memory early.
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  dreamActivationPath,
  dreamApprovalPath,
  dreamArchivePath,
  dreamCandidateDiffPath,
  dreamCandidateMemoryPath,
  dreamCandidateValidationPath,
  dreamDir,
  dreamJobPath,
  reflectionsDir,
} from "./dream-paths.mjs";
import {
  computeMemoryStateHash,
  estimateInjectionTokens,
  normalizeMemoryText,
} from "./memory-hash.mjs";
import { estimateCost } from "./budget-guard.mjs";
import { markCertificationStale } from "./certification.mjs";
import { readKpi } from "./kpi.mjs";
import { loadMemory } from "./memory-store.mjs";
import { loadMemoryCandidates } from "./memory-candidates.mjs";
import { assertReflectionShape, isTrustedReflection } from "./reflect.mjs";
import {
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const DREAM_EVENT_FAMILY = "dream/v1";
export const DREAM_JOB_CONTRACT = "crewclaw.dream-job/v1";
export const DREAM_CANDIDATE_CONTRACT = "crewclaw.dream-candidate/v1";
export const DREAM_DIFF_CONTRACT = "crewclaw.dream-diff/v1";
export const DREAM_APPROVAL_CONTRACT = "crewclaw.dream-approval/v1";
export const MEMORY_ACTIVATION_CONTRACT = "crewclaw.memory-activation/v1";
export const DREAM_VALIDATION_CONTRACT = "crewclaw.dream-validation/v1";
export const DREAM_MORNING_REPORT_CONTRACT = "crewclaw.dream-morning-report/v1";

function invalidateCertificationForMemoryChange(
  root,
  employeeId,
  memoryStateHash,
  reason,
  at
) {
  const result = markCertificationStale(root, employeeId, {
    reason,
    observedMemoryStateHash: memoryStateHash,
    at,
  });
  if (
    !result.written &&
    !new Set(["credential_missing", "credential_current"]).has(result.reason)
  ) {
    throw new Error(`certification invalidation failed: ${result.reason}`);
  }
  return result;
}

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
  budget: Object.freeze({
    memory_budget_tokens: 8_000,
    max_model_cost_usd: null,
  }),
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
  if (Array.isArray(value))
    return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(",")}}`;
}

function canonicalHash(value) {
  const canonical = canonicalStringify(value);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function loadReflectionPool(
  root,
  employeeId,
  { maxFiles = 10_000 } = {}
) {
  const dir = reflectionsDir(root, employeeId);
  if (!existsSync(dir)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const name of readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .sort()
    .slice(0, maxFiles)) {
    try {
      const path = join(dir, name);
      const record = JSON.parse(
        readStateFileGuarded(path, { root }).toString("utf8")
      );
      assertReflectionShape(record);
      if (record?.employee_id !== employeeId)
        throw new Error("employee mismatch");
      records.push(record);
    } catch (error) {
      errors.push({ file: name, reason: error?.message || String(error) });
    }
  }
  return { records, errors };
}

function duplicateRatio(items) {
  const active = (items || []).filter(
    item => item?.status === undefined || item.status === "active"
  );
  if (active.length === 0) return 0;
  const keys = active.map(
    item =>
      `${item.category}\u0000${normalizeMemoryText(item.text).toLowerCase()}`
  );
  return (keys.length - new Set(keys).size) / keys.length;
}

function staleRatio(items, nowMs) {
  const active = (items || []).filter(
    item => item?.status === undefined || item.status === "active"
  );
  if (active.length === 0) return 0;
  const stale = active.filter(
    item => item.valid_until && Date.parse(item.valid_until) <= nowMs
  ).length;
  return stale / active.length;
}

function conflictCount(items) {
  const active = (items || []).filter(
    item => item?.status === undefined || item.status === "active"
  );
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
  const reuse = Math.max(
    repeated,
    ratio(metrics.accepted_tasks, t.min_accepted_tasks)
  );
  return (
    Math.round(
      (0.3 * pressure +
        0.25 * repeated +
        0.2 * clamp(metrics.trusted_input_ratio) +
        0.15 * hygiene +
        0.1 * reuse) *
        10_000
    ) / 10_000
  );
}

/** Pure two-gate decision. Manual trigger bypasses soft thresholds/cooldown, never safety gates. */
export function assessDream({
  employeeId,
  reflections = [],
  memoryItems = [],
  memoryCandidates = [],
  skillPerformance = [],
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
  const nonLegacy = reflections.filter(
    record => record?.legacy_committed !== true
  );
  const trusted = nonLegacy.filter(isTrustedReflection);
  const selected = trusted
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(-policy.limits.max_batch_tasks);
  const selectedCandidates = (
    Array.isArray(memoryCandidates) ? memoryCandidates : []
  )
    .filter(
      item =>
        item?.status === "pending_review" &&
        ["medium", "high"].includes(item.confidence) &&
        typeof item.text === "string" &&
        item.text.trim()
    )
    .slice(-policy.limits.max_batch_tasks);
  const memoryState = computeMemoryStateHash(memoryItems);
  const trustedRatio = nonLegacy.length ? trusted.length / nonLegacy.length : 0;
  const acceptedTasks = new Set(
    trusted
      .filter(record => record.outcome === "accepted")
      .map(record => record.task_id)
  ).size;
  const metrics = {
    accepted_tasks: acceptedTasks,
    trusted_input_ratio: trustedRatio,
    memory_tokens: memoryState.estimated_injection_tokens,
    memory_pressure_ratio:
      memoryState.estimated_injection_tokens /
      policy.budget.memory_budget_tokens,
    duplicate_ratio: duplicateRatio(memoryItems),
    stale_ratio: staleRatio(memoryItems, Number(now)),
    conflict_count: conflictCount(memoryItems),
    repeated_pattern_count: repeatedFailureCount(trusted),
  };
  const skillRetirementCandidates = (
    Array.isArray(skillPerformance) ? skillPerformance : []
  )
    .filter(
      skill =>
        skill?.retirement_candidate === true &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(skill.skill_id || ""))
    )
    .map(skill => ({
      skill_id: skill.skill_id,
      calls: Number(skill.calls) || 0,
      settled_tasks: Number(skill.settled_tasks) || 0,
      successful_tasks: Number(skill.successful_tasks) || 0,
      accepted_tasks: Number(skill.accepted_tasks) || 0,
      auto_accepted_tasks: Number(skill.auto_accepted_tasks) || 0,
      negative_tasks: Number(skill.negative_tasks) || 0,
      success_rate: Number.isFinite(skill.success_rate)
        ? skill.success_rate
        : null,
      acceptance_rate: Number.isFinite(skill.acceptance_rate)
        ? skill.acceptance_rate
        : null,
    }))
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id, "en"));
  metrics.skill_retirement_candidate_count = skillRetirementCandidates.length;
  metrics.recommendation_score = scoreMetrics(metrics, policy);
  const estimatedInputTokens =
    memoryState.estimated_injection_tokens +
    selected.reduce(
      (sum, record) => sum + estimateInjectionTokens(JSON.stringify(record)),
      0
    ) +
    selectedCandidates.reduce(
      (sum, record) => sum + estimateInjectionTokens(JSON.stringify(record)),
      0
    ) +
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
  if (trusted.length === 0 && selectedCandidates.length === 0)
    curationBlockers.push("no_trusted_input");
  if (
    selectedCandidates.length === 0 &&
    trustedRatio < policy.eligibility.trusted_input_ratio
  )
    curationBlockers.push("trusted_input_ratio_low");
  if (!manualTrigger && cooldownUntil > Number(now))
    curationBlockers.push("cooldown_active");

  const triggerReasons = [];
  const t = policy.triggers;
  if (metrics.accepted_tasks >= t.min_accepted_tasks)
    triggerReasons.push("accepted_tasks");
  if (metrics.memory_pressure_ratio >= t.memory_pressure_ratio)
    triggerReasons.push("memory_pressure");
  if (metrics.duplicate_ratio >= t.duplicate_ratio)
    triggerReasons.push("duplicate_pressure");
  if (metrics.stale_ratio >= t.stale_ratio)
    triggerReasons.push("stale_pressure");
  if (metrics.conflict_count >= t.conflict_count)
    triggerReasons.push("conflict_pressure");
  if (metrics.repeated_pattern_count >= t.repeat_task_count)
    triggerReasons.push("repeated_pattern");
  if (metrics.recommendation_score >= t.recommendation_score)
    triggerReasons.push("recommendation_score");
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
      memory_candidate_ids: selectedCandidates.map(record => record.id),
      task_run_ids: [
        ...new Set([
          ...selected.map(record => record.task_id),
          ...selectedCandidates.map(record => record.source_task_id),
        ]),
      ],
      evidence_ids: [
        ...new Set(selected.flatMap(record => record.evidence_ids || [])),
      ],
      input_snapshot_hash: canonicalHash({
        reflections: selected,
        memory_candidates: selectedCandidates,
      }),
    },
    base_memory_hash: memoryState.memory_state_hash,
    curation: { eligible: curationEligible, blockers: curationBlockers },
    activation: {
      eligible: activationBlockers.length === 0,
      blockers: activationBlockers,
    },
    skill_signals: {
      advisory_only: true,
      retirement_candidates: skillRetirementCandidates,
    },
    trigger_reasons: triggerReasons,
    recommended,
    cooldown_until: cooldownUntil
      ? new Date(cooldownUntil).toISOString()
      : null,
  };
}

export function assessDreamFromWorkspace(root, employeeId, options = {}) {
  const pool = loadReflectionPool(root, employeeId);
  const candidatePool = loadMemoryCandidates(root, employeeId);
  const memory = loadMemory(root, employeeId);
  const skillPerformance = readKpi(root, employeeId).skills;
  const assessment = assessDream({
    employeeId,
    reflections: pool.records,
    memoryCandidates: candidatePool.records,
    memoryItems: memory.items,
    skillPerformance,
    ...options,
  });
  const inputErrors = [...pool.errors, ...candidatePool.errors];
  if (memory.error)
    inputErrors.push({ file: "active-memory", reason: memory.error });
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
    skill_signals: assessment.skill_signals,
    cost: { estimated_usd: assessment.cost.estimated_usd, actual_usd: null },
  };
  const identity = value => ({
    contract: value?.contract,
    dream_id: value?.dream_id,
    employee_id: value?.employee_id,
    base_memory_hash: value?.base_memory_hash,
    input: value?.input,
  });
  return withStateLock(
    `${path}.lock`,
    () => {
      if (existsSync(path)) {
        let existing;
        try {
          existing = JSON.parse(
            readStateFileGuarded(path, { root }).toString("utf8")
          );
        } catch (error) {
          return {
            ok: false,
            written: false,
            path,
            reason: `existing dream recommendation is unreadable: ${error?.message || String(error)}`,
          };
        }
        if (
          canonicalHash(identity(existing)) !== canonicalHash(identity(job))
        ) {
          return {
            ok: false,
            written: false,
            path,
            reason:
              "dream recommendation id already exists with different content",
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

// ── M3/M4: candidate → validation → approval → atomic activation → rollback ────────────────

const MEMORY_CATEGORIES = new Set([
  "user_prefs",
  "project_facts",
  "successful_toolchains",
  "failure_paths",
  "reliable_sources",
  "verified_sops",
]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const DIFF_OPS = new Set(["add", "merge", "replace", "drop", "keep"]);
const SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const RELATIVE_DATE_PATTERN =
  /\b(?:today|tomorrow|yesterday)\b|\b(?:next|last|this)\s+(?:day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:今天|明天|昨天|后天|前天|本周|这周|下周|上周|本月|这个月|下个月|上个月|今年|明年|去年)/iu;

function readJsonArtifact(path, root) {
  return JSON.parse(readStateFileGuarded(path, { root }).toString("utf8"));
}

function memoryPath(root, employeeId) {
  if (
    !/^[a-zA-Z0-9._:-]+$/.test(String(employeeId)) ||
    String(employeeId).includes("..")
  ) {
    throw new Error(
      `employeeId contains unsafe path characters: ${employeeId}`
    );
  }
  return join(root, ".crewclaw", "memory", `${employeeId}.json`);
}

function stableMemoryKey(item) {
  return `${String(item?.category || "")}\u0000${normalizeMemoryText(item?.text)}`;
}

function reviewRequiredMemoryKeys(items, nowMs = Date.now()) {
  const active = (Array.isArray(items) ? items : []).filter(
    item => item?.status === undefined || item.status === "active"
  );
  const required = new Set(
    active
      .filter(item => {
        if (!item.valid_until) return false;
        const expires = Date.parse(item.valid_until);
        return Number.isFinite(expires) && expires <= Number(nowMs);
      })
      .map(stableMemoryKey)
  );
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].category !== active[j].category) continue;
      const a = normalizeMemoryText(active[i].text);
      const b = normalizeMemoryText(active[j].text);
      if (active[i].supersedes === b || active[j].supersedes === a) {
        required.add(stableMemoryKey(active[i]));
        required.add(stableMemoryKey(active[j]));
      }
    }
  }
  return [...required].sort();
}

function invalidReferenceMemoryKeys(items, reflections) {
  const byTask = new Map(
    (Array.isArray(reflections) ? reflections : []).map(record => [
      String(record.task_id),
      new Set((record.evidence_ids || []).map(String)),
    ])
  );
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.status === undefined || item.status === "active")
    .filter(item => {
      const taskIds = Array.isArray(item.source_task_ids)
        ? item.source_task_ids.map(String).filter(Boolean)
        : [];
      const evidenceIds = Array.isArray(item.evidence_ids)
        ? item.evidence_ids.map(String).filter(Boolean)
        : [];
      if (taskIds.some(taskId => !byTask.has(taskId))) return true;
      if (evidenceIds.length === 0) return false;
      if (taskIds.length === 0) return true;
      const scopedEvidence = new Set(
        taskIds.flatMap(taskId => [...(byTask.get(taskId) || [])])
      );
      return evidenceIds.some(evidenceId => !scopedEvidence.has(evidenceId));
    })
    .map(stableMemoryKey)
    .sort();
}

function unresolvedSupersedesConflicts(items) {
  const active = (Array.isArray(items) ? items : []).filter(
    item => item?.status === undefined || item.status === "active"
  );
  const conflicts = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].category !== active[j].category) continue;
      const a = normalizeMemoryText(active[i].text);
      const b = normalizeMemoryText(active[j].text);
      if (active[i].supersedes === b || active[j].supersedes === a) {
        conflicts.push([
          stableMemoryKey(active[i]),
          stableMemoryKey(active[j]),
        ]);
      }
    }
  }
  return conflicts;
}

function normalizeIso(value, fallback) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeExistingMemoryItem(item, nowIso) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("active memory contains a non-object item");
  }
  const category = String(item.category || "");
  const text = normalizeMemoryText(item.text);
  const confidence = String(item.confidence || "");
  if (!MEMORY_CATEGORIES.has(category) || !text || text.length > 2_000) {
    throw new Error("active memory contains an invalid category or text");
  }
  if (!CONFIDENCE_LEVELS.has(confidence)) {
    throw new Error("active memory contains an invalid confidence");
  }
  const normalized = {
    category,
    text,
    confidence,
    status: ["active", "superseded", "archived"].includes(item.status)
      ? item.status
      : "active",
    source_type: item.source_type === "dream" ? "dream" : "legacy",
    source_task_ids: Array.isArray(item.source_task_ids)
      ? item.source_task_ids.map(String).filter(Boolean)
      : [],
    evidence_ids: Array.isArray(item.evidence_ids)
      ? item.evidence_ids.map(String).filter(Boolean)
      : [],
    created_by_model:
      typeof item.created_by_model === "string" && item.created_by_model
        ? item.created_by_model
        : null,
    dream_run_id:
      typeof item.dream_run_id === "string" && item.dream_run_id
        ? item.dream_run_id
        : null,
    savedAt: normalizeIso(item.savedAt, nowIso),
  };
  if (item.valid_until !== undefined)
    normalized.valid_until = item.valid_until
      ? normalizeIso(item.valid_until, null)
      : null;
  if (item.supersedes !== undefined)
    normalized.supersedes = item.supersedes ? String(item.supersedes) : null;
  if (item.sensitive !== undefined)
    normalized.sensitive = item.sensitive === true;
  if (item.ephemeral !== undefined)
    normalized.ephemeral = item.ephemeral === true;
  return normalized;
}

function validateCuratorResponse(value, assessment) {
  let parsed = value;
  if (typeof parsed === "string") {
    const text = parsed.trim();
    if (!text.startsWith("{") || !text.endsWith("}")) {
      throw new Error("dream curator must return one JSON object");
    }
    parsed = JSON.parse(text);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dream curator response is not an object");
  }
  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "entries,summary") {
    throw new Error(
      "dream curator response must contain only entries and summary"
    );
  }
  if (
    typeof parsed.summary !== "string" ||
    !parsed.summary.trim() ||
    parsed.summary.length > 4_000
  ) {
    throw new Error("dream curator summary is invalid");
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length > 100) {
    throw new Error("dream curator entries are invalid or exceed 100");
  }
  const allowedTasks = new Set(assessment.input.task_run_ids || []);
  const allowedEvidence = new Set(assessment.input.evidence_ids || []);
  const entries = parsed.entries.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`dream diff entry ${index} is not an object`);
    }
    const allowed = new Set([
      "op",
      "reason",
      "confidence",
      "source_task_ids",
      "evidence_ids",
      "item",
      "replaces",
    ]);
    if (Object.keys(raw).some(key => !allowed.has(key))) {
      throw new Error(`dream diff entry ${index} has unknown fields`);
    }
    if (!DIFF_OPS.has(raw.op))
      throw new Error(`dream diff entry ${index} has invalid op`);
    if (
      typeof raw.reason !== "string" ||
      !raw.reason.trim() ||
      raw.reason.length > 1_000
    ) {
      throw new Error(`dream diff entry ${index} has invalid reason`);
    }
    if (!CONFIDENCE_LEVELS.has(raw.confidence)) {
      throw new Error(`dream diff entry ${index} has invalid confidence`);
    }
    const sourceTaskIds = Array.isArray(raw.source_task_ids)
      ? [...new Set(raw.source_task_ids.map(String).filter(Boolean))]
      : [];
    const evidenceIds = Array.isArray(raw.evidence_ids)
      ? [...new Set(raw.evidence_ids.map(String).filter(Boolean))]
      : [];
    if (
      sourceTaskIds.length === 0 ||
      sourceTaskIds.some(id => !allowedTasks.has(id))
    ) {
      throw new Error(
        `dream diff entry ${index} has untrusted task provenance`
      );
    }
    if (evidenceIds.some(id => !allowedEvidence.has(id))) {
      throw new Error(
        `dream diff entry ${index} has untrusted evidence provenance`
      );
    }
    const replaces = Array.isArray(raw.replaces)
      ? [...new Set(raw.replaces.map(String).filter(Boolean))]
      : [];
    const needsItem = ["add", "merge", "replace"].includes(raw.op);
    if (needsItem) {
      if (
        !raw.item ||
        typeof raw.item !== "object" ||
        Array.isArray(raw.item)
      ) {
        throw new Error(`dream diff entry ${index} requires an item`);
      }
      if (
        Object.keys(raw.item).some(
          key =>
            ![
              "category",
              "text",
              "confidence",
              "valid_until",
              "supersedes",
            ].includes(key)
        )
      ) {
        throw new Error(`dream diff entry ${index} item has unknown fields`);
      }
      if (!MEMORY_CATEGORIES.has(raw.item.category)) {
        throw new Error(`dream diff entry ${index} item category is invalid`);
      }
      if (!CONFIDENCE_LEVELS.has(raw.item.confidence)) {
        throw new Error(`dream diff entry ${index} item confidence is invalid`);
      }
      const text = normalizeMemoryText(raw.item.text);
      if (!text || text.length > 2_000 || SECRET_PATTERN.test(text)) {
        throw new Error(`dream diff entry ${index} item text is unsafe`);
      }
      if (RELATIVE_DATE_PATTERN.test(text)) {
        throw new Error(
          `dream diff entry ${index} item text contains a relative date`
        );
      }
      if (raw.item.valid_until) {
        const validUntil = String(raw.item.valid_until);
        if (
          !ISO_UTC.test(validUntil) ||
          !Number.isFinite(Date.parse(validUntil))
        ) {
          throw new Error(
            `dream diff entry ${index} item valid_until must be RFC 3339 UTC`
          );
        }
      }
    } else if (raw.item !== undefined) {
      throw new Error(
        `dream diff entry ${index} must not contain an item for ${raw.op}`
      );
    }
    if (
      ["merge", "replace", "drop"].includes(raw.op) &&
      replaces.length === 0
    ) {
      throw new Error(`dream diff entry ${index} requires replaces keys`);
    }
    return {
      op: raw.op,
      reason: raw.reason.trim(),
      confidence: raw.confidence,
      source_task_ids: sourceTaskIds,
      evidence_ids: evidenceIds,
      ...(raw.item
        ? {
            item: {
              category: raw.item.category,
              text: normalizeMemoryText(raw.item.text),
              confidence: raw.item.confidence,
              ...(raw.item.valid_until
                ? {
                    valid_until: new Date(
                      String(raw.item.valid_until)
                    ).toISOString(),
                  }
                : {}),
              ...(raw.item.supersedes
                ? { supersedes: normalizeMemoryText(raw.item.supersedes) }
                : {}),
            },
          }
        : {}),
      ...(replaces.length ? { replaces } : {}),
    };
  });
  const reviewed = new Set(entries.flatMap(entry => entry.replaces || []));
  const missed = (assessment.input.review_required_memory_keys || []).filter(
    key => !reviewed.has(key)
  );
  if (missed.length) {
    throw new Error(
      `dream curator skipped required stale/conflict review: ${missed.join(", ")}`
    );
  }
  const invalidReferenceKeys = new Set(
    assessment.input.invalid_reference_memory_keys || []
  );
  const keptInvalidReferences = entries
    .filter(entry => entry.op === "keep")
    .flatMap(entry => entry.replaces || [])
    .filter(key => invalidReferenceKeys.has(key));
  if (keptInvalidReferences.length) {
    throw new Error(
      `dream curator kept memory with invalid provenance: ${[
        ...new Set(keptInvalidReferences),
      ].join(", ")}`
    );
  }
  return { summary: parsed.summary.trim(), entries };
}

function buildCandidateArtifacts({
  dreamId,
  employeeId,
  assessment,
  currentItems,
  curated,
  modelId,
  nowIso,
}) {
  const items = currentItems
    .map(item => normalizeExistingMemoryItem(item, nowIso))
    .filter(item => item.status === "active");
  const byKey = new Map(items.map(item => [stableMemoryKey(item), item]));
  const diffEntries = [];
  for (const entry of curated.entries) {
    const replaces = entry.replaces || [];
    for (const key of entry.op === "keep" ? [] : replaces) {
      if (!byKey.has(key))
        throw new Error(`dream diff replaces unknown memory key: ${key}`);
      byKey.delete(key);
    }
    let item;
    if (entry.item) {
      item = {
        ...entry.item,
        status: "active",
        source_type: "dream",
        source_task_ids: entry.source_task_ids,
        evidence_ids: entry.evidence_ids,
        created_by_model: modelId,
        dream_run_id: dreamId,
        savedAt: nowIso,
        sensitive: false,
        ephemeral: false,
      };
      const key = stableMemoryKey(item);
      if (byKey.has(key))
        throw new Error(`dream diff creates duplicate memory: ${key}`);
      byKey.set(key, item);
    }
    diffEntries.push({
      op: entry.op,
      reason: entry.reason,
      confidence: entry.confidence,
      source_task_ids: entry.source_task_ids,
      evidence_ids: entry.evidence_ids,
      ...(item ? { item } : {}),
      ...(replaces.length ? { replaces } : {}),
    });
  }
  if (diffEntries.length === 0)
    throw new Error("dream curator produced no reviewable changes");
  const candidateItems = [...byKey.values()].sort((a, b) =>
    stableMemoryKey(a) < stableMemoryKey(b)
      ? -1
      : stableMemoryKey(a) > stableMemoryKey(b)
        ? 1
        : 0
  );
  const conflicts = unresolvedSupersedesConflicts(candidateItems);
  if (conflicts.length) {
    throw new Error(
      `dream curator left supersedes conflicts active: ${conflicts
        .map(pair => pair.join(" <> "))
        .join(", ")}`
    );
  }
  const memoryState = computeMemoryStateHash(candidateItems);
  if (memoryState.memory_state_hash === assessment.base_memory_hash) {
    throw new Error("dream curator produced no semantic memory change");
  }
  const candidate = {
    contract: DREAM_CANDIDATE_CONTRACT,
    dream_run_id: dreamId,
    base_memory_hash: assessment.base_memory_hash,
    candidate_memory_hash: memoryState.memory_state_hash,
    items: candidateItems,
    created_at: nowIso,
  };
  const diff = { contract: DREAM_DIFF_CONTRACT, entries: diffEntries };
  return { candidate, diff };
}

function normalizedEvalProof(value) {
  if (!value || typeof value !== "object") return null;
  const score = Number(value.score);
  return {
    score: Number.isFinite(score) ? score : null,
    verdict: String(value.verdict || ""),
    mock: value.mock,
    provider_status: String(value.provider_status || ""),
    memory_state_hash: String(value.memory_state_hash || ""),
    evaluated_at: value.evaluated_at ?? null,
    model: value.model ?? value.judge_model ?? null,
  };
}

function activationBlockers({
  baseHash,
  candidateHash,
  baseline,
  candidateEval,
  approved = false,
}) {
  const blockers = [];
  if (!baseline) blockers.push("baseline_missing");
  else {
    if (!Number.isFinite(baseline.score))
      blockers.push("baseline_score_invalid");
    if (baseline.mock !== false) blockers.push("baseline_not_real");
    if (baseline.provider_status !== "verified")
      blockers.push("baseline_provider_unverified");
    if (baseline.memory_state_hash !== baseHash)
      blockers.push("baseline_memory_mismatch");
  }
  if (!candidateEval) blockers.push("candidate_eval_required");
  else {
    if (!Number.isFinite(candidateEval.score))
      blockers.push("candidate_eval_score_invalid");
    if (candidateEval.mock !== false) blockers.push("candidate_eval_not_real");
    if (candidateEval.provider_status !== "verified")
      blockers.push("candidate_eval_provider_unverified");
    if (candidateEval.memory_state_hash !== candidateHash)
      blockers.push("candidate_eval_memory_mismatch");
    if (candidateEval.verdict !== "PASS")
      blockers.push("candidate_eval_failed");
    if (
      baseline &&
      Number.isFinite(candidateEval.score) &&
      Number.isFinite(baseline.score) &&
      candidateEval.score < baseline.score
    )
      blockers.push("candidate_score_regressed");
  }
  if (!approved) blockers.push("human_approval_required");
  return [...new Set(blockers)];
}

function updateDreamJob(root, employeeId, dreamId, update) {
  const path = dreamJobPath(root, employeeId, dreamId);
  return withStateLock(
    `${path}.lock`,
    () => {
      const current = readJsonArtifact(path, root);
      if (current.dream_id !== dreamId || current.employee_id !== employeeId) {
        throw new Error("dream job identity mismatch");
      }
      const next = update({ ...current });
      writeJsonAtomic(path, next, { root });
      return next;
    },
    { root }
  );
}

function writeArtifactIdempotent(path, value, root) {
  return withStateLock(
    `${path}.lock`,
    () => {
      if (existsSync(path)) {
        const existing = readJsonArtifact(path, root);
        if (canonicalHash(existing) !== canonicalHash(value)) {
          throw new Error(
            `dream artifact already exists with different content: ${path}`
          );
        }
        return existing;
      }
      writeJsonAtomic(path, value, { root });
      return value;
    },
    { root }
  );
}

/**
 * Generate one candidate with a real injected curator. The controller never silently falls back to
 * heuristics. `evaluateCandidate` is optional; without a verified real eval the candidate remains
 * reviewable but activation is explicitly blocked.
 */
export async function generateDreamCandidate(
  root,
  assessment,
  {
    dreamId,
    curate,
    modelId,
    baseline = null,
    evaluateCandidate = null,
    now = Date.now(),
  } = {}
) {
  if (!assessment?.recommended)
    return { ok: false, reason: "dream is not recommended" };
  if (
    typeof curate !== "function" ||
    typeof modelId !== "string" ||
    !modelId.trim()
  ) {
    return {
      ok: false,
      reason: "real dream generation requires an explicit curator and model id",
    };
  }
  const employeeId = assessment.employee_id;
  const id = dreamId || `dream-${Date.now()}`;
  const recommendation = persistDreamRecommendation(root, assessment, {
    dreamId: id,
  });
  if (!recommendation.ok) return recommendation;
  updateDreamJob(root, employeeId, id, job => ({
    ...job,
    state: "DREAMING",
    model: modelId,
  }));

  try {
    const pool = loadReflectionPool(root, employeeId);
    if (pool.errors.length)
      throw new Error("reflection input became unreadable");
    const selected = new Set(assessment.input.reflection_ids || []);
    const reflections = pool.records.filter(record =>
      selected.has(record.task_id)
    );
    if (reflections.length !== selected.size)
      throw new Error("dream reflection snapshot is incomplete");
    const candidatePool = loadMemoryCandidates(root, employeeId);
    if (candidatePool.errors.length)
      throw new Error("memory candidate input became unreadable");
    const selectedCandidateIds = new Set(
      assessment.input.memory_candidate_ids || []
    );
    const memoryCandidates = candidatePool.records.filter(record =>
      selectedCandidateIds.has(record.id)
    );
    if (memoryCandidates.length !== selectedCandidateIds.size)
      throw new Error("dream memory candidate snapshot is incomplete");
    const memory = loadMemory(root, employeeId);
    if (memory.error)
      throw new Error(`active memory is unreadable: ${memory.error}`);
    const currentHash = computeMemoryStateHash(memory.items).memory_state_hash;
    if (currentHash !== assessment.base_memory_hash) {
      throw new Error("base memory changed before candidate generation");
    }
    const nowIso = new Date(Number(now)).toISOString();
    const staleOrConflictKeys = reviewRequiredMemoryKeys(
      memory.items,
      Number(now)
    );
    const invalidReferenceKeys = invalidReferenceMemoryKeys(
      memory.items,
      pool.records
    );
    const reviewRequired = [
      ...new Set([...staleOrConflictKeys, ...invalidReferenceKeys]),
    ].sort();
    const curationAssessment = {
      ...assessment,
      input: {
        ...assessment.input,
        review_required_memory_keys: reviewRequired,
        invalid_reference_memory_keys: invalidReferenceKeys,
      },
    };
    const rawResult = await curate({
      contract: "crewclaw.dream-curation-input/v1",
      employee_id: employeeId,
      dream_id: id,
      base_memory_hash: assessment.base_memory_hash,
      reflections,
      memory_candidates: memoryCandidates,
      active_memory: memory.items,
      review_required_memory_keys: reviewRequired,
      invalid_reference_memory_keys: invalidReferenceKeys,
      curation_time_utc: nowIso,
      absolute_datetime_required: true,
      allowed_categories: [...MEMORY_CATEGORIES],
    });
    const raw = rawResult?.value ?? rawResult;
    const curated = validateCuratorResponse(raw, curationAssessment);
    const { candidate, diff } = buildCandidateArtifacts({
      dreamId: id,
      employeeId,
      assessment: curationAssessment,
      currentItems: memory.items,
      curated,
      modelId,
      nowIso,
    });
    updateDreamJob(root, employeeId, id, job => ({
      ...job,
      state: "VALIDATING",
    }));

    let candidateEval = null;
    let evalError = null;
    if (typeof evaluateCandidate === "function") {
      try {
        candidateEval = normalizedEvalProof(
          await evaluateCandidate(candidate.items)
        );
      } catch (error) {
        evalError = error?.message || String(error);
      }
    }
    const baselineProof = normalizedEvalProof(baseline);
    const checks = {
      schema_ok: true,
      provenance_ok: true,
      safety_ok: candidate.items.every(
        item =>
          item.sensitive !== true &&
          item.ephemeral !== true &&
          !SECRET_PATTERN.test(item.text)
      ),
      critic_ok:
        candidate.items.length > 0 &&
        new Set(candidate.items.map(stableMemoryKey)).size ===
          candidate.items.length,
    };
    const blockers = activationBlockers({
      baseHash: candidate.base_memory_hash,
      candidateHash: candidate.candidate_memory_hash,
      baseline: baselineProof,
      candidateEval,
      approved: false,
    });
    const validation = {
      contract: DREAM_VALIDATION_CONTRACT,
      dream_run_id: id,
      employee_id: employeeId,
      validated_at: nowIso,
      checks,
      baseline: baselineProof,
      candidate_eval: candidateEval,
      eval_error: evalError,
      activation: {
        eligible: blockers.length === 0,
        blockers,
        next_step: blockers.includes("baseline_missing")
          ? `运行 crew eval ${employeeId} 生成真实基线`
          : blockers.includes("candidate_eval_required") || evalError
            ? `EvalProvider 未就绪（available / missing_credentials / authentication_failed / rate_limited / unavailable）：${evalError || "重新生成候选评测"}`
            : "人工审批候选 diff",
      },
    };
    if (Object.values(checks).some(value => value !== true)) {
      updateDreamJob(root, employeeId, id, job => ({
        ...job,
        state: "FAILED",
      }));
      return {
        ok: false,
        dreamId: id,
        reason: "candidate validation failed",
        validation,
      };
    }
    writeArtifactIdempotent(
      dreamCandidateMemoryPath(root, employeeId, id),
      candidate,
      root
    );
    writeArtifactIdempotent(
      dreamCandidateDiffPath(root, employeeId, id),
      diff,
      root
    );
    writeArtifactIdempotent(
      dreamCandidateValidationPath(root, employeeId, id),
      validation,
      root
    );
    const evalSummary =
      candidateEval && baselineProof
        ? {
            score: candidateEval.score,
            baseline_score: baselineProof.score,
            passed: !blockers.some(
              blocker =>
                blocker.startsWith("candidate_") ||
                blocker.startsWith("baseline_")
            ),
          }
        : null;
    const job = updateDreamJob(root, employeeId, id, current => ({
      ...current,
      state: "REVIEW_REQUIRED",
      candidate_memory_hash: candidate.candidate_memory_hash,
      cost: {
        ...current.cost,
        actual_usd: Number.isFinite(rawResult?.actual_cost_usd)
          ? rawResult.actual_cost_usd
          : null,
      },
      diff,
      validation: { ...checks, eval: evalSummary },
      summary: curated.summary,
    }));
    return {
      ok: true,
      dreamId: id,
      job,
      candidate,
      diff,
      validation,
      summary: curated.summary,
    };
  } catch (error) {
    try {
      updateDreamJob(root, employeeId, id, job => ({
        ...job,
        state: "FAILED",
      }));
    } catch {}
    return { ok: false, dreamId: id, reason: error?.message || String(error) };
  }
}

export function inspectDreamJob(root, employeeId, dreamId = null) {
  try {
    const jobs = join(dreamDir(root, employeeId), "jobs");
    if (!existsSync(jobs)) return { ok: false, reason: "no_dream_jobs" };
    const names = readdirSync(jobs).filter(name => name.endsWith(".json"));
    const target = dreamId
      ? `${dreamId}.json`
      : names
          .map(name => {
            try {
              return {
                name,
                createdAt:
                  Date.parse(
                    readJsonArtifact(join(jobs, name), root).created_at
                  ) || 0,
              };
            } catch {
              return { name, createdAt: 0 };
            }
          })
          .sort(
            (a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)
          )
          .at(-1)?.name;
    if (!target || !names.includes(target))
      return { ok: false, reason: "dream_job_not_found" };
    const job = readJsonArtifact(join(jobs, target), root);
    const id = job.dream_id;
    const readOptional = path =>
      existsSync(path) ? readJsonArtifact(path, root) : null;
    return {
      ok: true,
      job,
      candidate: readOptional(dreamCandidateMemoryPath(root, employeeId, id)),
      diff: readOptional(dreamCandidateDiffPath(root, employeeId, id)),
      validation: readOptional(
        dreamCandidateValidationPath(root, employeeId, id)
      ),
      approval: readOptional(dreamApprovalPath(root, employeeId, id)),
    };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

/**
 * Project the latest substantive, persisted Dream transaction into a restart-safe morning card.
 * Counts come only from immutable diff/validation/approval/job artifacts; absence stays explicit.
 */
export function buildDreamMorningReport(root, employeeId, dreamId = null) {
  try {
    let inspected = dreamId
      ? inspectDreamJob(root, employeeId, dreamId)
      : { ok: false, reason: "no_substantive_dream_jobs" };
    if (!dreamId) {
      const jobsDir = join(dreamDir(root, employeeId), "jobs");
      const candidates = existsSync(jobsDir)
        ? readdirSync(jobsDir)
            .filter(name => name.endsWith(".json"))
            .map(name => {
              try {
                const job = readJsonArtifact(join(jobsDir, name), root);
                const candidate = inspectDreamJob(
                  root,
                  employeeId,
                  job.dream_id
                );
                if (!candidate.ok) return null;
                const entries =
                  candidate.diff?.entries || candidate.job.diff?.entries || [];
                const substantive =
                  entries.length > 0 ||
                  candidate.validation ||
                  candidate.approval ||
                  ["FAILED", "REJECTED", "ACTIVE", "ROLLED_BACK"].includes(
                    candidate.job.state
                  );
                if (!substantive) return null;
                return {
                  inspected: candidate,
                  activityAt: Math.max(
                    Date.parse(candidate.approval?.decided_at) || 0,
                    Date.parse(candidate.validation?.validated_at) || 0,
                    Date.parse(candidate.job.created_at) || 0
                  ),
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort(
              (a, b) =>
                b.activityAt - a.activityAt ||
                b.inspected.job.dream_id.localeCompare(a.inspected.job.dream_id)
            )
        : [];
      if (candidates.length > 0) inspected = candidates[0].inspected;
    }
    if (!inspected.ok) return inspected;
    const entries =
      inspected.diff?.entries || inspected.job.diff?.entries || [];
    const count = op => entries.filter(entry => entry?.op === op).length;
    const resolvedMemoryKeys = new Set(
      entries
        .filter(entry => entry?.op !== "keep")
        .flatMap(entry => entry?.replaces || [])
        .map(String)
    );
    const blockers = Array.isArray(inspected.validation?.activation?.blockers)
      ? inspected.validation.activation.blockers.map(String)
      : [];
    const retirementCandidates = Array.isArray(
      inspected.job.skill_signals?.retirement_candidates
    )
      ? inspected.job.skill_signals.retirement_candidates
      : [];
    return {
      ok: true,
      report: {
        contract: DREAM_MORNING_REPORT_CONTRACT,
        dream_id: inspected.job.dream_id,
        employee_id: employeeId,
        state: inspected.job.state,
        source_created_at: inspected.job.created_at,
        summary: String(inspected.job.summary || ""),
        reviewed_count: entries.length,
        added_count: count("add"),
        merged_count: count("merge"),
        replaced_count: count("replace"),
        dropped_count: count("drop"),
        kept_count: count("keep"),
        resolved_memory_count: resolvedMemoryKeys.size,
        validation_blocker_count: blockers.length,
        skill_retirement_candidate_count: retirementCandidates.length,
        approved: inspected.approval?.decision === "approve",
        activated: inspected.job.state === "ACTIVE",
        candidate_eval_passed:
          inspected.validation?.candidate_eval?.verdict === "PASS",
      },
    };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

function approvalReceipt({
  dreamId,
  decision,
  decidedBy,
  decidedAt,
  baseHash,
  candidateHash,
}) {
  const value = {
    contract: DREAM_APPROVAL_CONTRACT,
    dream_run_id: dreamId,
    decision,
    decided_by: decidedBy,
    decided_at: decidedAt,
    base_memory_hash: baseHash,
    candidate_memory_hash: candidateHash,
  };
  return {
    ...value,
    receipt_sha256: canonicalHash(value).replace(/^sha256:/, ""),
  };
}

export function approveDreamCandidate(
  root,
  employeeId,
  dreamId,
  { decidedBy = "local-user", now = Date.now() } = {}
) {
  const inspected = inspectDreamJob(root, employeeId, dreamId);
  if (!inspected.ok) return inspected;
  if (inspected.approval?.decision === "approve") {
    return { ok: true, approval: inspected.approval, replayed: true };
  }
  if (inspected.job.state !== "REVIEW_REQUIRED") {
    return {
      ok: false,
      reason: `dream job is ${inspected.job.state}, not REVIEW_REQUIRED`,
    };
  }
  if (!inspected.candidate || !inspected.validation) {
    return { ok: false, reason: "candidate artifacts are incomplete" };
  }
  const approval = approvalReceipt({
    dreamId,
    decision: "approve",
    decidedBy,
    decidedAt: new Date(Number(now)).toISOString(),
    baseHash: inspected.job.base_memory_hash,
    candidateHash: inspected.job.candidate_memory_hash,
  });
  writeArtifactIdempotent(
    dreamApprovalPath(root, employeeId, dreamId),
    approval,
    root
  );
  updateDreamJob(root, employeeId, dreamId, job => ({ ...job, approval }));
  return { ok: true, approval };
}

export function rejectDreamCandidate(
  root,
  employeeId,
  dreamId,
  { decidedBy = "local-user", now = Date.now() } = {}
) {
  const inspected = inspectDreamJob(root, employeeId, dreamId);
  if (!inspected.ok) return inspected;
  if (inspected.approval?.decision === "reject") {
    return {
      ok: true,
      approval: inspected.approval,
      job: inspected.job,
      replayed: true,
    };
  }
  if (!["REVIEW_REQUIRED", "RECOMMENDED"].includes(inspected.job.state)) {
    return {
      ok: false,
      reason: `dream job cannot be rejected from ${inspected.job.state}`,
    };
  }
  const approval = approvalReceipt({
    dreamId,
    decision: "reject",
    decidedBy,
    decidedAt: new Date(Number(now)).toISOString(),
    baseHash: inspected.job.base_memory_hash,
    candidateHash: inspected.job.candidate_memory_hash,
  });
  writeArtifactIdempotent(
    dreamApprovalPath(root, employeeId, dreamId),
    approval,
    root
  );
  const job = updateDreamJob(root, employeeId, dreamId, current => ({
    ...current,
    state: "REJECTED",
    approval,
  }));
  return { ok: true, approval, job };
}

export function activateDreamCandidate(
  root,
  employeeId,
  dreamId,
  { now = Date.now() } = {}
) {
  const inspected = inspectDreamJob(root, employeeId, dreamId);
  if (!inspected.ok) return inspected;
  const { job, candidate, validation, approval } = inspected;
  if (job.state === "ACTIVE") {
    const activeMemory = loadMemory(root, employeeId);
    if (activeMemory.error)
      return {
        ok: false,
        reason: activeMemory.error,
        blockers: ["active_memory_unreadable"],
      };
    const activeHash = computeMemoryStateHash(
      activeMemory.items
    ).memory_state_hash;
    try {
      const certification = invalidateCertificationForMemoryChange(
        root,
        employeeId,
        activeHash,
        `Dream ${dreamId} active-memory replay check`,
        new Date(Number(now)).toISOString()
      );
      return { ok: true, activation: null, certification, job, replayed: true };
    } catch (error) {
      return {
        ok: false,
        reason: error?.message || String(error),
        blockers: ["certification_invalidation_failed"],
      };
    }
  }
  if (!candidate || !validation)
    return { ok: false, reason: "candidate artifacts are incomplete" };
  const blockers = activationBlockers({
    baseHash: job.base_memory_hash,
    candidateHash: job.candidate_memory_hash,
    baseline: validation.baseline,
    candidateEval: validation.candidate_eval,
    approved: approval?.decision === "approve",
  });
  const candidateHash = computeMemoryStateHash(
    candidate.items
  ).memory_state_hash;
  if (candidateHash !== job.candidate_memory_hash)
    blockers.push("candidate_hash_mismatch");
  const currentMemory = loadMemory(root, employeeId);
  if (currentMemory.error) blockers.push("active_memory_unreadable");
  const currentHash = computeMemoryStateHash(
    currentMemory.items
  ).memory_state_hash;
  const activeAlreadySwapped = currentHash === candidateHash;
  if (!activeAlreadySwapped && currentHash !== job.base_memory_hash) {
    blockers.push("base_memory_changed");
  }
  if (blockers.length) {
    return {
      ok: false,
      reason: "activation_blocked",
      blockers: [...new Set(blockers)],
      next_step: blockers.includes("baseline_missing")
        ? `运行 crew eval ${employeeId} 生成真实基线`
        : "修复阻塞项后重新审批",
    };
  }

  const activePath = memoryPath(root, employeeId);
  const activationId = `activation-${dreamId}-${candidateHash.replace(/^sha256:/, "").slice(0, 12)}`;
  const archivePath = dreamArchivePath(root, employeeId, job.base_memory_hash);
  const activationPath = dreamActivationPath(root, employeeId, activationId);
  const activation = existsSync(activationPath)
    ? readJsonArtifact(activationPath, root)
    : {
        contract: MEMORY_ACTIVATION_CONTRACT,
        activation_id: activationId,
        dream_run_id: dreamId,
        employee_id: employeeId,
        previous_memory_hash: job.base_memory_hash,
        activated_memory_hash: candidateHash,
        archived_to: archivePath,
        activated_at: new Date(Number(now)).toISOString(),
      };
  if (
    activation.contract !== MEMORY_ACTIVATION_CONTRACT ||
    activation.dream_run_id !== dreamId ||
    activation.employee_id !== employeeId ||
    activation.previous_memory_hash !== job.base_memory_hash ||
    activation.activated_memory_hash !== candidateHash ||
    activation.archived_to !== archivePath
  ) {
    return {
      ok: false,
      reason: "activation receipt identity mismatch",
      blockers: ["activation_receipt_invalid"],
    };
  }
  let certification = null;
  try {
    updateDreamJob(root, employeeId, dreamId, current => ({
      ...current,
      state: "ACTIVATING",
    }));
    withStateLock(
      `${activePath}.lock`,
      () => {
        const latest = loadMemory(root, employeeId);
        if (latest.error) throw new Error(latest.error);
        const latestHash = computeMemoryStateHash(
          latest.items
        ).memory_state_hash;
        if (latestHash === candidateHash) {
          if (!existsSync(activationPath)) {
            throw new Error(
              "active memory changed without an activation receipt"
            );
          }
          certification = invalidateCertificationForMemoryChange(
            root,
            employeeId,
            candidateHash,
            `Dream ${dreamId} activated a new memory state`,
            activation.activated_at
          );
          return;
        }
        if (latestHash !== job.base_memory_hash) {
          throw new Error("base memory changed during activation");
        }
        writeArtifactIdempotent(archivePath, latest.items, root);
        writeArtifactIdempotent(activationPath, activation, root);
        certification = invalidateCertificationForMemoryChange(
          root,
          employeeId,
          candidateHash,
          `Dream ${dreamId} activated a new memory state`,
          activation.activated_at
        );
        writeJsonAtomic(activePath, candidate.items, { root });
      },
      { root }
    );
    const updated = updateDreamJob(root, employeeId, dreamId, current => ({
      ...current,
      state: "ACTIVE",
    }));
    return { ok: true, activation, certification, job: updated };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || String(error),
      blockers: ["atomic_activation_failed"],
    };
  }
}

export function rollbackDreamActivation(
  root,
  employeeId,
  dreamId,
  { decidedBy = "local-user", now = Date.now() } = {}
) {
  const inspected = inspectDreamJob(root, employeeId, dreamId);
  if (!inspected.ok) return inspected;
  if (inspected.job.state === "ROLLED_BACK") {
    const activeMemory = loadMemory(root, employeeId);
    if (activeMemory.error)
      return {
        ok: false,
        reason: activeMemory.error,
        blockers: ["active_memory_unreadable"],
      };
    const activeHash = computeMemoryStateHash(
      activeMemory.items
    ).memory_state_hash;
    try {
      const certification = invalidateCertificationForMemoryChange(
        root,
        employeeId,
        activeHash,
        `Dream ${dreamId} rollback replay check`,
        new Date(Number(now)).toISOString()
      );
      return {
        ok: true,
        activation: null,
        rollback: null,
        certification,
        job: inspected.job,
        replayed: true,
      };
    } catch (error) {
      return {
        ok: false,
        reason: error?.message || String(error),
        blockers: ["certification_invalidation_failed"],
      };
    }
  }
  if (!new Set(["ACTIVE", "ROLLING_BACK"]).has(inspected.job.state)) {
    return {
      ok: false,
      reason: `dream job is ${inspected.job.state}, not ACTIVE`,
    };
  }
  const activations = join(dreamDir(root, employeeId), "activations");
  if (!existsSync(activations))
    return { ok: false, reason: "activation_receipt_missing" };
  const receiptName = readdirSync(activations)
    .filter(name => name.endsWith(".json"))
    .sort()
    .reverse()
    .find(name => {
      try {
        return (
          readJsonArtifact(join(activations, name), root).dream_run_id ===
          dreamId
        );
      } catch {
        return false;
      }
    });
  if (!receiptName) return { ok: false, reason: "activation_receipt_missing" };
  const activation = readJsonArtifact(join(activations, receiptName), root);
  const archive = readJsonArtifact(activation.archived_to, root);
  const activePath = memoryPath(root, employeeId);
  const rollbackPath = dreamApprovalPath(
    root,
    employeeId,
    `rollback-${activation.activation_id}`
  );
  const rollback = existsSync(rollbackPath)
    ? readJsonArtifact(rollbackPath, root)
    : approvalReceipt({
        dreamId,
        decision: "rollback",
        decidedBy,
        decidedAt: new Date(Number(now)).toISOString(),
        baseHash: activation.previous_memory_hash,
        candidateHash: activation.activated_memory_hash,
      });
  if (
    rollback.decision !== "rollback" ||
    rollback.dream_run_id !== dreamId ||
    rollback.base_memory_hash !== activation.previous_memory_hash ||
    rollback.candidate_memory_hash !== activation.activated_memory_hash
  ) {
    return {
      ok: false,
      reason: "rollback receipt identity mismatch",
      blockers: ["rollback_receipt_invalid"],
    };
  }
  if (
    computeMemoryStateHash(archive).memory_state_hash !==
    activation.previous_memory_hash
  ) {
    return {
      ok: false,
      reason: "archive hash does not match activation receipt",
      blockers: ["activation_archive_invalid"],
    };
  }
  let certification = null;
  try {
    updateDreamJob(root, employeeId, dreamId, current => ({
      ...current,
      state: "ROLLING_BACK",
    }));
    withStateLock(
      `${activePath}.lock`,
      () => {
        const latest = loadMemory(root, employeeId);
        if (latest.error) throw new Error(latest.error);
        const latestHash = computeMemoryStateHash(
          latest.items
        ).memory_state_hash;
        if (latestHash === activation.previous_memory_hash) {
          if (!existsSync(rollbackPath)) {
            throw new Error("memory was restored without a rollback receipt");
          }
          certification = invalidateCertificationForMemoryChange(
            root,
            employeeId,
            activation.previous_memory_hash,
            `Dream ${dreamId} rolled back to the previous memory state`,
            rollback.decided_at
          );
          return;
        }
        if (latestHash !== activation.activated_memory_hash) {
          throw new Error(
            "active memory changed after activation; rollback requires manual reconciliation"
          );
        }
        writeArtifactIdempotent(rollbackPath, rollback, root);
        certification = invalidateCertificationForMemoryChange(
          root,
          employeeId,
          activation.previous_memory_hash,
          `Dream ${dreamId} rolled back to the previous memory state`,
          rollback.decided_at
        );
        writeJsonAtomic(activePath, archive, { root });
      },
      { root }
    );
    const job = updateDreamJob(root, employeeId, dreamId, current => ({
      ...current,
      state: "ROLLED_BACK",
    }));
    return { ok: true, activation, rollback, certification, job };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || String(error),
      blockers: ["rollback_failed"],
    };
  }
}
