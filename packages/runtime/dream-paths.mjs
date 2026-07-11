// M0.4 — the on-disk contract for Dream/Reflect artifacts. Path helpers ONLY: nothing in M0
// writes these directories yet (M1-M4 land together). Freezing the layout now means every later
// milestone, test, and external tool agrees on where artifacts live.
//
//   .crewclaw/
//     reflections/<employee>/<task-id>.json        immutable task work logs (crewclaw.reflect/v1)
//     dream/<employee>/jobs/<dream-run-id>.json    dream job records (crewclaw.dream-job/v1)
//     dream/<employee>/candidates/<dream-run-id>/  candidate-memory.json + diff.json + validation.json
//     dream/<employee>/approvals/<dream-run-id>.json
//     dream/<employee>/activations/<activation-id>.json
//     dream/<employee>/archives/<memory-state-hash>.json  pre-activation snapshots (rollback)
//
// Boundaries (enforced by M1-M4 code, documented here as the single source):
//   - reflections are append-only and never edited after write;
//   - candidates are NEVER read by recall — only an approved activation swaps the active store;
//   - the active store stays at .crewclaw/memory/<employee>.json (existing format);
//   - every mutation goes through state-lock (withStateLock + writeJsonAtomic).
import { join } from "node:path";

import { resolveStatePath } from "./state-lock.mjs";

function safeSegment(value, label) {
  const text = String(value ?? "");
  if (!/^[a-zA-Z0-9._:-]+$/.test(text) || text.includes("..")) {
    throw new Error(`${label} contains unsafe path characters: ${text}`);
  }
  return text;
}

export function reflectionsDir(root, employeeId) {
  return join(
    root,
    ".crewclaw",
    "reflections",
    safeSegment(employeeId, "employeeId")
  );
}

export function reflectionPath(root, employeeId, taskId) {
  return resolveStatePath(
    join(
      reflectionsDir(root, employeeId),
      `${safeSegment(taskId, "taskId")}.json`
    ),
    root
  );
}

export function dreamDir(root, employeeId) {
  return join(
    root,
    ".crewclaw",
    "dream",
    safeSegment(employeeId, "employeeId")
  );
}

export function dreamJobPath(root, employeeId, dreamRunId) {
  return resolveStatePath(
    join(
      dreamDir(root, employeeId),
      "jobs",
      `${safeSegment(dreamRunId, "dreamRunId")}.json`
    ),
    root
  );
}

export function dreamCandidateDir(root, employeeId, dreamRunId) {
  return join(
    dreamDir(root, employeeId),
    "candidates",
    safeSegment(dreamRunId, "dreamRunId")
  );
}

export function dreamCandidateMemoryPath(root, employeeId, dreamRunId) {
  return resolveStatePath(
    join(
      dreamCandidateDir(root, employeeId, dreamRunId),
      "candidate-memory.json"
    ),
    root
  );
}

export function dreamCandidateDiffPath(root, employeeId, dreamRunId) {
  return resolveStatePath(
    join(dreamCandidateDir(root, employeeId, dreamRunId), "diff.json"),
    root
  );
}

export function dreamCandidateValidationPath(root, employeeId, dreamRunId) {
  return resolveStatePath(
    join(dreamCandidateDir(root, employeeId, dreamRunId), "validation.json"),
    root
  );
}

export function dreamApprovalPath(root, employeeId, dreamRunId) {
  return resolveStatePath(
    join(
      dreamDir(root, employeeId),
      "approvals",
      `${safeSegment(dreamRunId, "dreamRunId")}.json`
    ),
    root
  );
}

export function dreamActivationPath(root, employeeId, activationId) {
  return resolveStatePath(
    join(
      dreamDir(root, employeeId),
      "activations",
      `${safeSegment(activationId, "activationId")}.json`
    ),
    root
  );
}

export function dreamArchivePath(root, employeeId, memoryStateHash) {
  // archive files are keyed by the hash of the store they snapshot; strip the sha256: prefix
  const hex = String(memoryStateHash ?? "").replace(/^sha256:/, "");
  return resolveStatePath(
    join(
      dreamDir(root, employeeId),
      "archives",
      `${safeSegment(hex, "memoryStateHash")}.json`
    ),
    root
  );
}
