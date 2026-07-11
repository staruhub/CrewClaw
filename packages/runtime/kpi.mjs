// kpi.mjs — v0.17 P2 C1: cumulative per-employee KPI persisted across sessions/processes.
//
// The TUI's EMPLOYEE panel already shows a real "本会话" (this-session) KPI section derived
// purely from the current process's event timeline. That resets to zero every launch. This
// module adds the cross-session counterpart: `.crewclaw/kpi/<agentId>.json` accumulates
// tasks/accepted/total_cost/first_hired_ts across every session run against that root, so a
// second `crew chat <expert>` invocation on the same project sees the first session's numbers.
//
// Scope (matches what the engine can honestly know): "accepted" increments only on a real
// approval.accepted event (a deliverable the user explicitly accepted) — the same signal the
// session-scoped panel already uses for its "accept" counter. "tasks" increments on every
// task.completed emission (chat turns included), mirroring the session panel's own definition
// (task_meta is attached to every completed/blocked/rejected task head, not just deliverables).
// There is no "reject" action in this codebase today (route.mjs only models accept/revise/
// reveal) — a revised task simply isn't terminal yet, so it doesn't touch this file.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveStatePath,
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

function kpiDir(root) {
  return join(root, ".crewclaw", "kpi");
}

function kpiPath(root, agentId) {
  return resolveStatePath(join(kpiDir(root), `${agentId}.json`), root);
}

function defaultKpi() {
  return { tasks: 0, accepted: 0, total_cost: 0, first_hired_ts: null };
}

function readKpiDocument(root, agentId) {
  try {
    if (!agentId) return { ...defaultKpi(), applied_task_ids: [] };
    const file = kpiPath(root, agentId);
    if (!existsSync(file)) return { ...defaultKpi(), applied_task_ids: [] };
    const parsed = JSON.parse(
      readStateFileGuarded(file, { root }).toString("utf8")
    );
    return {
      tasks: Number.isFinite(parsed.tasks) ? parsed.tasks : 0,
      accepted: Number.isFinite(parsed.accepted) ? parsed.accepted : 0,
      total_cost: Number.isFinite(parsed.total_cost) ? parsed.total_cost : 0,
      first_hired_ts: Number.isFinite(parsed.first_hired_ts)
        ? parsed.first_hired_ts
        : null,
      applied_task_ids: Array.isArray(parsed.applied_task_ids)
        ? parsed.applied_task_ids.filter(id => typeof id === "string")
        : [],
    };
  } catch {
    return { ...defaultKpi(), applied_task_ids: [] };
  }
}

/** Read the cumulative KPI for `agentId` under `root`. Missing/corrupt file → honest zeros. */
export function readKpi(root, agentId) {
  const { applied_task_ids: _ignored, ...publicKpi } = readKpiDocument(
    root,
    agentId
  );
  return publicKpi;
}

/**
 * Record one terminal task outcome for `agentId`, incrementing the persisted cumulative KPI.
 * Best-effort (same posture as writeProofPack in jsonl-bridge.mjs): a write failure must not
 * crash the session — KPI is a nice-to-have dashboard, not the task's source of truth.
 */
export function recordTaskOutcome(
  root,
  agentId,
  { accepted = false, cost = 0, ts, taskRunId } = {}
) {
  if (!agentId) return null;
  try {
    const file = kpiPath(root, agentId);
    return withStateLock(
      `${file}.lock`,
      () => {
        const cur = readKpiDocument(root, agentId);
        if (taskRunId && cur.applied_task_ids.includes(taskRunId)) {
          const { applied_task_ids: _ignored, ...publicKpi } = cur;
          return publicKpi;
        }
        const next = {
          tasks: cur.tasks + 1,
          accepted: cur.accepted + (accepted ? 1 : 0),
          total_cost:
            Math.round((cur.total_cost + (Number(cost) || 0)) * 1e6) / 1e6,
          first_hired_ts: cur.first_hired_ts ?? ts ?? Date.now(),
          applied_task_ids: taskRunId
            ? [...cur.applied_task_ids, taskRunId]
            : cur.applied_task_ids,
        };
        writeJsonAtomic(file, next, { root });
        const { applied_task_ids: _ignored, ...publicKpi } = next;
        return publicKpi;
      },
      { root }
    );
  } catch (error) {
    if (process.env.CREW_STATE_LOCK_DEBUG === "1")
      console.error(`recordTaskOutcome: ${error?.stack || error}`);
    return null;
  }
}
