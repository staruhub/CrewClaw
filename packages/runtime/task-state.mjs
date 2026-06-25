import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TASK_STATES = [
  "created",
  "planned",
  "waiting_permission",
  "running_tool",
  "extracting_evidence",
  "drafting_artifact",
  "grading",
  "revision_needed",
  "delivered",
  "accepted",
  "rejected",
  "failed",
  "archived"
];

export const LEGAL_TRANSITIONS = {
  created: ["planned", "failed"],
  planned: ["waiting_permission", "running_tool", "failed"],
  waiting_permission: ["running_tool", "failed", "rejected"],
  running_tool: ["extracting_evidence", "running_tool", "waiting_permission", "failed"],
  extracting_evidence: ["drafting_artifact", "running_tool", "failed"],
  drafting_artifact: ["grading", "failed"],
  grading: ["delivered", "revision_needed", "failed"],
  revision_needed: ["running_tool", "drafting_artifact", "failed"],
  delivered: ["accepted", "rejected"],
  accepted: ["archived"],
  rejected: ["archived", "running_tool"],
  failed: ["archived"],
  archived: []
};

function runsDir(root) {
  return join(root, ".crewclaw", "runs");
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function runFile(root, id) {
  return join(runsDir(root), safeId(id) + ".json");
}

export function newTaskRun({ employeeId, goal, taskId }) {
  const now = new Date().toISOString();
  return {
    id: taskId || "task_" + Date.now(),
    employee_id: employeeId,
    user_goal: goal,
    status: "created",
    events: [],
    tool_invocations: [],
    artifact: null,
    started_at: now,
    updated_at: now
  };
}

export function transition(run, toState) {
  const allowed = LEGAL_TRANSITIONS[run.status] || [];
  if (!allowed.includes(toState)) {
    throw new Error("illegal transition " + run.status + " -> " + toState);
  }
  run.status = toState;
  run.updated_at = new Date().toISOString();
  addEvent(run, { type: "state_changed", summary: "-> " + toState });
  return run;
}

export function addEvent(run, { type, summary, tool_name, status }) {
  const event = {
    id: "evt_" + (run.events.length + 1),
    task_id: run.id,
    type,
    summary: summary || "",
    tool_name: tool_name || null,
    status: status || null,
    timestamp: new Date().toISOString()
  };
  run.events.push(event);
  return event;
}

export function saveTaskRun(root, run) {
  try {
    mkdirSync(runsDir(root), { recursive: true });
    const path = runFile(root, run.id);
    writeFileSync(path, JSON.stringify(run, null, 2), "utf8");
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadTaskRun(root, id) {
  try {
    const path = runFile(root, id);
    if (!existsSync(path)) return { ok: false };
    const run = JSON.parse(readFileSync(path, "utf8"));
    return { ok: true, run };
  } catch {
    return { ok: false };
  }
}

export function computeEffective(run) {
  return run.status === "accepted";
}
