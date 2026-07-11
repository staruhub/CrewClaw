import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  readStateFileGuarded,
  resolveStatePath,
  writeJsonAtomic,
} from "./state-lock.mjs";

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
  "archived",
];

export const LEGAL_TRANSITIONS = {
  created: ["planned", "failed"],
  planned: ["waiting_permission", "running_tool", "failed"],
  waiting_permission: ["running_tool", "failed", "rejected"],
  running_tool: [
    "extracting_evidence",
    "running_tool",
    "waiting_permission",
    "failed",
  ],
  extracting_evidence: ["drafting_artifact", "running_tool", "failed"],
  drafting_artifact: ["grading", "failed"],
  grading: ["delivered", "revision_needed", "failed"],
  revision_needed: ["running_tool", "drafting_artifact", "failed"],
  delivered: ["accepted", "rejected", "revision_needed", "failed"],
  accepted: ["archived"],
  rejected: ["archived", "running_tool"],
  failed: ["archived"],
  archived: [],
};

function runsDir(root) {
  return join(root, ".crewclaw", "runs");
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function runFile(root, id) {
  return resolveStatePath(join(runsDir(root), safeId(id) + ".json"), root);
}

export function newTaskRun({ employeeId, goal, taskId }) {
  const now = new Date().toISOString();
  return {
    id: taskId || `task_${randomUUID()}`,
    employee_id: employeeId,
    user_goal: goal,
    status: "created",
    events: [],
    tool_invocations: [],
    artifact: null,
    started_at: now,
    updated_at: now,
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
    timestamp: new Date().toISOString(),
  };
  run.events.push(event);
  return event;
}

export function saveTaskRun(root, run) {
  try {
    const path = runFile(root, run.id);
    writeJsonAtomic(path, run, { root });
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadTaskRun(root, id) {
  try {
    const path = runFile(root, id);
    if (!existsSync(path)) return { ok: false };
    const run = JSON.parse(
      readStateFileGuarded(path, { root }).toString("utf8")
    );
    return { ok: true, run };
  } catch {
    return { ok: false };
  }
}

export function computeEffective(run) {
  return run.status === "accepted";
}

// Runtime completion is a protocol boundary, not a presentation hint.  Keep the
// decision pure so every caller and its tests use the same truth table:
//
//   persisted artifact + valid grading -> delivered
//   artifact persistence failure       -> failed
//   grading rejection / missing section -> revision_needed
//
// In particular, an artifact id is only returned when persistence succeeded;
// callers can safely assign `run.artifact` from this result without creating a
// dangling reference.
export function evaluateCompletionGate({
  artifactId,
  artifactSaved = false,
  artifactPath,
  artifactError,
  gradingPassed = false,
  gradingFeedback,
  gradingError,
  missingSections = [],
} = {}) {
  const persistedArtifactId =
    artifactSaved === true &&
    typeof artifactId === "string" &&
    artifactId.trim().length > 0 &&
    typeof artifactPath === "string" &&
    artifactPath.trim().length > 0
      ? artifactId
      : null;
  const persisted = persistedArtifactId !== null;
  const missing = Array.isArray(missingSections)
    ? missingSections.filter(Boolean)
    : [];

  if (!persisted) {
    const detail = artifactError ? `: ${artifactError}` : "";
    return {
      valid: false,
      nextState: "failed",
      artifactId: null,
      deliverable: null,
      gaps: ["artifact_not_persisted"],
      reason: `交付物落盘失败${detail}`,
    };
  }

  if (gradingError) {
    return {
      valid: false,
      nextState: "failed",
      artifactId: persistedArtifactId,
      deliverable: artifactPath || null,
      gaps: ["grading_unavailable"],
      reason: `验收执行失败: ${gradingError}`,
    };
  }

  if (gradingPassed !== true || missing.length > 0) {
    const reasons = [];
    if (gradingPassed !== true)
      reasons.push(gradingFeedback || "验收规则未通过");
    if (missing.length > 0) reasons.push(`缺少必需章节: ${missing.join("、")}`);
    return {
      valid: false,
      nextState: "revision_needed",
      artifactId: persistedArtifactId,
      deliverable: artifactPath || null,
      gaps: missing.length > 0 ? missing : ["grading_rejected"],
      reason: reasons.join("；"),
    };
  }

  return {
    valid: true,
    nextState: "delivered",
    artifactId: persistedArtifactId,
    deliverable: artifactPath || null,
    gaps: [],
    reason: gradingFeedback || "",
  };
}
