import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const GROWTH_CYCLE_CONTRACT = "crewclaw.growth-cycle/v1";

const STATES = new Set([
  "RECOMMENDED",
  "REVISION_REQUIRED",
  "APPROVED",
  "QUEUED",
  "RUNNING",
  "AWAITING_DELIVERY_APPROVAL",
  "DELIVERED",
  "REJECTED",
  "EVALUATED",
  "LEARNED",
  "NEXT_RECOMMENDED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
]);

const ALLOWED = Object.freeze({
  RECOMMENDED: ["APPROVED", "REVISION_REQUIRED", "CANCELLED"],
  REVISION_REQUIRED: ["APPROVED", "CANCELLED"],
  APPROVED: ["QUEUED", "BLOCKED"],
  QUEUED: ["RUNNING", "BLOCKED", "CANCELLED"],
  RUNNING: [
    "AWAITING_DELIVERY_APPROVAL",
    "DELIVERED",
    "REJECTED",
    "FAILED",
    "CANCELLED",
  ],
  AWAITING_DELIVERY_APPROVAL: ["DELIVERED", "REJECTED", "FAILED", "CANCELLED"],
  DELIVERED: ["EVALUATED"],
  REJECTED: ["EVALUATED", "REVISION_REQUIRED"],
  EVALUATED: ["LEARNED"],
  LEARNED: ["NEXT_RECOMMENDED"],
  NEXT_RECOMMENDED: [],
  BLOCKED: ["QUEUED", "CANCELLED"],
  FAILED: ["REVISION_REQUIRED", "CANCELLED"],
  CANCELLED: [],
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function safeId(value, label) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9._:-]+$/.test(id) || id.includes("..")) {
    throw new Error(`invalid ${label}`);
  }
  return id;
}

function file(root, employeeId, cycleId) {
  return resolveStatePath(
    join(
      root,
      ".crewclaw",
      "growth",
      safeId(employeeId, "employee id"),
      `${safeId(cycleId, "growth cycle id")}.json`
    ),
    root
  );
}

function assertRecord(record) {
  if (!record || typeof record !== "object")
    throw new Error("growth cycle must be an object");
  if (record.contract !== GROWTH_CYCLE_CONTRACT)
    throw new Error("unsupported growth cycle contract");
  for (const key of ["cycle_id", "employee_id", "dream_id", "goal"]) {
    if (typeof record[key] !== "string" || !record[key])
      throw new Error(`growth cycle is missing ${key}`);
  }
  if (!new Set(["next_task", "dream_revision"]).has(record.kind))
    throw new Error("invalid growth cycle kind");
  if (!STATES.has(record.state)) throw new Error("invalid growth cycle state");
  if (
    !record.context ||
    !Array.isArray(record.context.task_run_ids) ||
    !Array.isArray(record.context.evidence_ids) ||
    !/^sha256:[a-f0-9]{64}$/.test(record.context.history_hash)
  ) {
    throw new Error("invalid growth cycle context");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(record.plan_hash))
    throw new Error("invalid growth cycle plan hash");
  if (!Array.isArray(record.transitions) || record.transitions.length === 0)
    throw new Error("growth cycle must contain transitions");
  return record;
}

function read(root, employeeId, cycleId) {
  const path = file(root, employeeId, cycleId);
  if (!existsSync(path)) return null;
  const record = JSON.parse(
    readStateFileGuarded(path, { root }).toString("utf8")
  );
  assertRecord(record);
  if (record.employee_id !== employeeId || record.cycle_id !== cycleId) {
    throw new Error("growth cycle identity mismatch");
  }
  return record;
}

function transitionRecord(
  record,
  to,
  { event, idempotencyKey, taskRunId, detail, now = Date.now() } = {}
) {
  if (!STATES.has(to)) throw new Error(`unknown growth state ${to}`);
  const key = String(idempotencyKey || "");
  if (!key) throw new Error("growth transition requires idempotency key");
  const prior = record.transitions.find(item => item.idempotency_key === key);
  if (prior) {
    if (prior.to !== to) throw new Error("growth idempotency key conflict");
    return { record, replayed: true };
  }
  if (!(ALLOWED[record.state] || []).includes(to)) {
    throw new Error(`illegal growth transition ${record.state} -> ${to}`);
  }
  const at = new Date(Number(now)).toISOString();
  const next = {
    ...record,
    state: to,
    task_run_id: taskRunId ?? record.task_run_id,
    transitions: [
      ...record.transitions,
      {
        idempotency_key: key,
        event: String(event || "growth.transition"),
        from: record.state,
        to,
        at,
        task_run_id: taskRunId ?? record.task_run_id,
        detail: detail ? String(detail) : null,
      },
    ],
    updated_at: at,
  };
  return { record: assertRecord(next), replayed: false };
}

function mutate(root, employeeId, cycleId, operation) {
  const path = file(root, employeeId, cycleId);
  return withStateLock(
    `${path}.lock`,
    () => {
      const current = read(root, employeeId, cycleId);
      if (!current) throw new Error("growth cycle not found");
      const result = operation(current);
      if (!result.replayed) writeJsonAtomic(path, result.record, { root });
      return { ok: true, ...result };
    },
    { root }
  );
}

export function recommendGrowthCycle(
  root,
  {
    employeeId,
    dreamId,
    kind = "next_task",
    goal,
    taskRunIds = [],
    evidenceIds = [],
    kpi = {},
    evaluation = null,
    now = Date.now(),
  } = {}
) {
  const cycleId = `growth-${safeId(dreamId, "dream id")}-${kind === "dream_revision" ? "revision" : "next"}`;
  const path = file(root, employeeId, cycleId);
  const context = {
    task_run_ids: [...new Set(taskRunIds.map(String))].sort(),
    evidence_ids: [...new Set(evidenceIds.map(String))].sort(),
    kpi: kpi && typeof kpi === "object" ? kpi : {},
    evaluation:
      evaluation && typeof evaluation === "object" ? evaluation : null,
  };
  context.history_hash = hash(context);
  const planHash = hash({ employeeId, dreamId, kind, goal, context });
  return withStateLock(
    `${path}.lock`,
    () => {
      const existing = read(root, employeeId, cycleId);
      if (existing) {
        if (existing.plan_hash !== planHash)
          throw new Error("growth cycle plan changed for an existing id");
        return { ok: true, record: existing, replayed: true };
      }
      const at = new Date(Number(now)).toISOString();
      const state =
        kind === "dream_revision" ? "REVISION_REQUIRED" : "RECOMMENDED";
      const record = assertRecord({
        contract: GROWTH_CYCLE_CONTRACT,
        cycle_id: cycleId,
        employee_id: employeeId,
        dream_id: dreamId,
        kind,
        state,
        goal: String(goal || "").trim(),
        context,
        plan_hash: planHash,
        approved_by: null,
        approved_at: null,
        task_run_id: null,
        outcome: null,
        transitions: [
          {
            idempotency_key: `recommend:${planHash}`,
            event:
              kind === "dream_revision"
                ? "dream.revision_task_created"
                : "dream.next_task_ready",
            from: null,
            to: state,
            at,
            task_run_id: null,
            detail: null,
          },
        ],
        created_at: at,
        updated_at: at,
      });
      writeJsonAtomic(path, record, { root });
      return { ok: true, record, replayed: false };
    },
    { root }
  );
}

export function inspectGrowthCycle(root, employeeId, cycleId) {
  try {
    const record = read(root, employeeId, cycleId);
    return record
      ? { ok: true, record }
      : { ok: false, reason: "growth_cycle_not_found" };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

export function inspectLatestGrowthCycle(root, employeeId) {
  try {
    const directory = join(
      root,
      ".crewclaw",
      "growth",
      safeId(employeeId, "employee id")
    );
    if (!existsSync(directory))
      return { ok: false, reason: "growth_cycle_not_found" };
    const records = readdirSync(directory)
      .filter(name => name.endsWith(".json"))
      .map(name => read(root, employeeId, name.slice(0, -5)))
      .filter(Boolean)
      .sort(
        (left, right) =>
          Date.parse(left.updated_at) - Date.parse(right.updated_at) ||
          left.cycle_id.localeCompare(right.cycle_id)
      );
    const record = records.at(-1);
    return record
      ? { ok: true, record }
      : { ok: false, reason: "growth_cycle_not_found" };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

export function approveGrowthCycle(
  root,
  employeeId,
  cycleId,
  { decidedBy = "local-user", now = Date.now() } = {}
) {
  return mutate(root, employeeId, cycleId, current => {
    const transitioned = transitionRecord(current, "APPROVED", {
      event: "dream.next_task_approved",
      idempotencyKey: `approve:${current.plan_hash}`,
      now,
    });
    if (transitioned.replayed) return transitioned;
    return {
      ...transitioned,
      record: {
        ...transitioned.record,
        approved_by: String(decidedBy),
        approved_at: new Date(Number(now)).toISOString(),
      },
    };
  });
}

export function queueGrowthCycle(root, employeeId, cycleId, options = {}) {
  return mutate(root, employeeId, cycleId, current =>
    transitionRecord(current, "QUEUED", {
      event: "dream.next_task_queued",
      idempotencyKey: `queue:${current.plan_hash}`,
      now: options.now,
    })
  );
}

export function startGrowthCycle(
  root,
  employeeId,
  cycleId,
  taskRunId,
  options = {}
) {
  const safeTaskRunId = safeId(taskRunId, "task run id");
  return mutate(root, employeeId, cycleId, current =>
    transitionRecord(current, "RUNNING", {
      event: "dream.next_task_started",
      idempotencyKey: `start:${safeTaskRunId}`,
      taskRunId: safeTaskRunId,
      now: options.now,
    })
  );
}

export function awaitGrowthDelivery(
  root,
  employeeId,
  cycleId,
  taskRunId,
  options = {}
) {
  return mutate(root, employeeId, cycleId, current =>
    transitionRecord(current, "AWAITING_DELIVERY_APPROVAL", {
      event: "dream.next_task_delivery_ready",
      idempotencyKey: `delivery:${safeId(taskRunId, "task run id")}`,
      taskRunId,
      now: options.now,
    })
  );
}

export function settleGrowthCycle(
  root,
  employeeId,
  cycleId,
  outcome,
  { taskRunId, now = Date.now(), detail } = {}
) {
  const outcomeState = {
    accepted: "DELIVERED",
    rejected: "REJECTED",
    revision_needed: "REJECTED",
    failed: "FAILED",
    cancelled: "CANCELLED",
  }[outcome];
  if (!outcomeState) throw new Error("invalid growth outcome");
  return mutate(root, employeeId, cycleId, current => {
    const transitioned = transitionRecord(current, outcomeState, {
      event: "dream.next_task_settled",
      idempotencyKey: `settle:${taskRunId || current.task_run_id}:${outcome}`,
      taskRunId: taskRunId || current.task_run_id,
      detail,
      now,
    });
    return {
      ...transitioned,
      record: { ...transitioned.record, outcome },
    };
  });
}

export function learnGrowthCycle(
  root,
  employeeId,
  cycleId,
  { now = Date.now(), detail = "Task outcome evaluated and persisted" } = {}
) {
  const initial = inspectGrowthCycle(root, employeeId, cycleId);
  if (!initial.ok) return initial;
  if (["LEARNED", "NEXT_RECOMMENDED"].includes(initial.record.state)) {
    return {
      ok: true,
      record: initial.record,
      evaluated: initial.record,
      replayed: true,
    };
  }
  const evaluated =
    initial.record.state === "EVALUATED"
      ? { ok: true, record: initial.record, replayed: true }
      : mutate(root, employeeId, cycleId, current =>
          transitionRecord(current, "EVALUATED", {
            event: "dream.next_task_evaluated",
            idempotencyKey: `evaluate:${current.task_run_id}:${current.outcome}`,
            detail,
            now,
          })
        );
  const learned = mutate(root, employeeId, cycleId, current =>
    transitionRecord(current, "LEARNED", {
      event: "dream.next_task_learned",
      idempotencyKey: `learn:${current.task_run_id}:${current.outcome}`,
      detail:
        "Reflection and KPI are now eligible for the next Dream assessment",
      now: Number(now) + 1,
    })
  );
  return { ...learned, evaluated: evaluated.record };
}

export function markGrowthNextRecommended(
  root,
  employeeId,
  cycleId,
  { nextDreamId, now = Date.now() } = {}
) {
  return mutate(root, employeeId, cycleId, current =>
    transitionRecord(current, "NEXT_RECOMMENDED", {
      event: "dream.next_cycle_recommended",
      idempotencyKey: `next-dream:${safeId(nextDreamId, "dream id")}`,
      detail: `Next Dream recommendation: ${nextDreamId}`,
      now,
    })
  );
}

export function recoverGrowthCycle(
  root,
  employeeId,
  cycleId,
  { loadTaskRun } = {}
) {
  const inspected = inspectGrowthCycle(root, employeeId, cycleId);
  if (!inspected.ok) return inspected;
  const record = inspected.record;
  let current = record;
  let recovered = false;
  if (
    ["RUNNING", "AWAITING_DELIVERY_APPROVAL"].includes(current.state) &&
    current.task_run_id &&
    typeof loadTaskRun === "function"
  ) {
    const loaded = loadTaskRun(current.task_run_id);
    const status = loaded?.status || loaded?.run?.status;
    const outcome = {
      accepted: "accepted",
      rejected: "rejected",
      revision_needed: "revision_needed",
      failed: "failed",
      cancelled: "cancelled",
    }[status];
    if (outcome) {
      current = settleGrowthCycle(root, employeeId, cycleId, outcome, {
        taskRunId: current.task_run_id,
        detail: "Recovered terminal TaskRun after restart",
      }).record;
      recovered = true;
    }
  }
  if (["DELIVERED", "REJECTED", "EVALUATED"].includes(current.state)) {
    current = learnGrowthCycle(root, employeeId, cycleId, {
      detail: "Recovered evaluation and learning after restart",
    }).record;
    recovered = true;
  }
  return { ok: true, record: current, recovered };
}
