// M1 — deterministic Reflect: an immutable crewclaw.reflect/v1 work log per TaskRun. No model
// call: it records only what verifiably happened, so it is cheap and cannot hallucinate. The
// cross-task judgment ("what should we do next time") belongs to Dream (M3), never here.
//
// Runtime validation is hand-rolled (the runtime is plain Node — no TS loader for the Zod schema
// in contracts/dream.ts). A vitest drift guard (reflect.test.mjs cross-checks buildReflection
// output against the real ReflectionSchema) keeps this mirror honest.
//
// buildReflection is PURE (caller supplies createdAt + evidenceIds); writeReflection is an
// idempotent, lock-guarded atomic write (safe under crash-replay settlement — same content is a
// no-op, divergent content is rejected as corruption).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { reflectionPath } from "./dream-paths.mjs";
import {
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const REFLECT_CONTRACT = "crewclaw.reflect/v1";

const OUTCOMES = new Set([
  "accepted",
  "rejected",
  "revision_needed",
  "failed",
  "blocked",
]);
// Only these verification sources make a failure "verified" (worth distilling later).
const VERIFICATIONS = new Set([
  "doctor_confirmed",
  "outcome_grader",
  "deterministic_test",
]);
const REFLECTION_KEYS = new Set([
  "contract",
  "task_id",
  "employee_id",
  "outcome",
  "output_valid",
  "accepted_artifact_ids",
  "evidence_ids",
  "verified_failures",
  "user_feedback",
  "tool_stats",
  "cost_usd",
  "duration_ms",
  "created_at",
  // Runtime-only provenance added after frozen-contract validation. It is persisted deliberately
  // and is the sole extension accepted when records are read back from disk.
  "legacy_committed",
]);
const VERIFIED_FAILURE_KEYS = new Set(["code", "tool", "verification"]);
const TOOL_STAT_KEYS = new Set(["tool_name", "status", "decision"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

function canonicalHash(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function feedbackBool(userFeedback) {
  if (userFeedback === "useful") return true;
  if (userFeedback === "not_useful") return false;
  return null;
}

// Structural mirror of ReflectionSchema (contracts/dream.ts) — checks the frozen shape without a
// TS toolchain. Throws on violation so corrupt or schema-invalid records cannot reach Dream.
export function assertReflectionShape(r) {
  const bad = msg => {
    throw new Error(`invalid reflection: ${msg}`);
  };
  const nonEmptyString = value => typeof value === "string" && value.length > 0;
  const stringArray = (value, label) => {
    if (!Array.isArray(value) || value.some(item => !nonEmptyString(item)))
      bad(label);
  };
  const strictKeys = (value, allowed, label) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))
    )
      bad(label);
  };

  strictKeys(r, REFLECTION_KEYS, "record");
  if (r.contract !== REFLECT_CONTRACT) bad("contract");
  if (!nonEmptyString(r.task_id)) bad("task_id");
  if (!nonEmptyString(r.employee_id)) bad("employee_id");
  if (!OUTCOMES.has(r.outcome)) bad("outcome");
  if (typeof r.output_valid !== "boolean") bad("output_valid");
  stringArray(r.accepted_artifact_ids, "accepted_artifact_ids");
  stringArray(r.evidence_ids, "evidence_ids");
  if (!Array.isArray(r.verified_failures)) bad("verified_failures");
  for (const f of r.verified_failures) {
    strictKeys(f, VERIFIED_FAILURE_KEYS, "verified_failure");
    if (!nonEmptyString(f.code)) bad("verified_failure.code");
    if (f.tool !== undefined && !nonEmptyString(f.tool))
      bad("verified_failure.tool");
    if (!VERIFICATIONS.has(f.verification))
      bad("verified_failure.verification");
  }
  strictKeys(r.user_feedback, new Set(["useful"]), "user_feedback");
  if (!(
    r.user_feedback.useful === null ||
    typeof r.user_feedback.useful === "boolean"
  ))
    bad("user_feedback.useful");
  if (r.tool_stats !== undefined) {
    if (!Array.isArray(r.tool_stats)) bad("tool_stats");
    for (const stat of r.tool_stats) {
      strictKeys(stat, TOOL_STAT_KEYS, "tool_stat");
      if (!nonEmptyString(stat.tool_name)) bad("tool_stat.tool_name");
      if (stat.status !== undefined && !nonEmptyString(stat.status))
        bad("tool_stat.status");
      if (stat.decision !== undefined && !nonEmptyString(stat.decision))
        bad("tool_stat.decision");
    }
  }
  if (
    r.cost_usd !== undefined &&
    (!Number.isFinite(r.cost_usd) || r.cost_usd < 0)
  )
    bad("cost_usd");
  if (
    r.duration_ms !== undefined &&
    (!Number.isInteger(r.duration_ms) || r.duration_ms < 0)
  )
    bad("duration_ms");
  if (
    !nonEmptyString(r.created_at) ||
    !ISO_UTC.test(r.created_at) ||
    Number.isNaN(Date.parse(r.created_at))
  )
    bad("created_at");
  if (
    r.legacy_committed !== undefined &&
    typeof r.legacy_committed !== "boolean"
  )
    bad("legacy_committed");
}

/**
 * Pure. Assemble a validated crewclaw.reflect/v1 record from a settled TaskRun. Throws if the
 * result violates the frozen schema.
 */
export function buildReflection(
  run,
  {
    evidenceIds = [],
    verifiedFailures = [],
    legacyCommitted = false,
    createdAt,
  } = {}
) {
  if (!run || typeof run !== "object" || !run.id || !run.employee_id) {
    throw new Error("reflect requires a settled TaskRun with id + employee_id");
  }
  const outcome = String(run.status);
  const reflection = {
    contract: REFLECT_CONTRACT,
    task_id: String(run.id),
    employee_id: String(run.employee_id),
    outcome,
    output_valid: run.output_valid === true,
    accepted_artifact_ids:
      outcome === "accepted" && run.artifact ? [String(run.artifact)] : [],
    evidence_ids: (Array.isArray(evidenceIds) ? evidenceIds : []).map(String),
    verified_failures: (Array.isArray(verifiedFailures) ? verifiedFailures : [])
      .filter(f => f && VERIFICATIONS.has(f.verification))
      .map(f => ({
        code: String(f.code),
        ...(f.tool ? { tool: String(f.tool) } : {}),
        verification: f.verification,
      })),
    user_feedback: { useful: feedbackBool(run.user_feedback) },
    created_at: createdAt || run.updated_at || new Date(0).toISOString(),
  };
  if (Array.isArray(run.tool_invocations) && run.tool_invocations.length) {
    reflection.tool_stats = run.tool_invocations.slice(0, 100).map(t => ({
      tool_name: String(t?.tool_name ?? "unknown"),
      ...(t?.status ? { status: String(t.status) } : {}),
      ...(t?.decision ? { decision: String(t.decision) } : {}),
    }));
  }
  if (Number.isFinite(run.cost)) reflection.cost_usd = Math.max(0, run.cost);
  const dur = Date.parse(run.updated_at) - Date.parse(run.started_at);
  if (Number.isFinite(dur) && dur >= 0) reflection.duration_ms = dur;

  assertReflectionShape(reflection);

  // legacy_committed is a runtime provenance field (not in the frozen wire schema) appended after
  // validation: was this experience already written to active memory by the legacy path? M3
  // preprocessing excludes these so a flag flip cannot double-absorb the same lesson.
  reflection.legacy_committed = legacyCommitted === true;
  return reflection;
}

/**
 * Idempotent atomic write. Returns {ok, written, path, reason?}. A byte-identical reflection is a
 * no-op success (crash-replay safe); a divergent one for the same task is rejected as corruption.
 */
export function writeReflection(root, reflection) {
  assertReflectionShape(reflection);
  const path = reflectionPath(root, reflection.employee_id, reflection.task_id);
  return withStateLock(
    `${path}.lock`,
    () => {
      if (existsSync(path)) {
        const existing = JSON.parse(
          readStateFileGuarded(path, { root }).toString("utf8")
        );
        if (canonicalHash(existing) === canonicalHash(reflection)) {
          return { ok: true, written: false, path };
        }
        return {
          ok: false,
          written: false,
          path,
          reason:
            "reflection already exists with different content (corruption?)",
        };
      }
      writeJsonAtomic(path, reflection, { root });
      return { ok: true, written: true, path };
    },
    { root }
  );
}

/**
 * Trusted-pool admission (M1.3). Only accepted / grader-passed / deterministic-test-passed /
 * explicit-preference / evidence-backed verified-root-cause reflections may feed Dream. Mock,
 * unaccepted, low-confidence, and sensitive reflections are refused.
 */
export function isTrustedReflection(reflection) {
  try {
    assertReflectionShape(reflection);
  } catch {
    return false;
  }
  if (reflection.mock === true) return false;
  if (reflection.sensitive === true || reflection.ephemeral === true)
    return false;
  if (reflection.confidence === "low") return false;
  // Accepted + valid output is the primary trust signal.
  if (reflection.outcome === "accepted" && reflection.output_valid === true)
    return true;
  // A verified failure path (doctor/grader/test confirmed) with evidence is also admissible —
  // it teaches the employee what NOT to do.
  if (
    Array.isArray(reflection.verified_failures) &&
    reflection.verified_failures.length > 0 &&
    Array.isArray(reflection.evidence_ids) &&
    reflection.evidence_ids.length > 0
  ) {
    return true;
  }
  return false;
}
