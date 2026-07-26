import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  readLatestCertificationCredential,
  sha256Id,
  stableJson,
  verifyCertificationCredential,
} from "./certification.mjs";
import { loadEmployeeSpec } from "./eval-runner.mjs";
import { readKpi, readKpiLedger } from "./kpi.mjs";
import { computeMemoryStateHash } from "./memory-hash.mjs";
import { loadMemory } from "./memory-store.mjs";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const EMPLOYEE_PROOFPACK_CONTRACT = "crewclaw.employee-proof-pack/v1";

const SAFE_AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sourceHash(kind, ref, value, visibility) {
  return {
    kind,
    ref: visibility === "internal" ? ref : null,
    sha256: sha256Id(Buffer.isBuffer(value) ? value : stableJson(value)),
  };
}

function taskEvidence(root, employeeId, ledger, visibility) {
  const receipts = [];
  const hashes = [];
  for (const outcome of ledger?.outcomes || []) {
    if (outcome.task_kind !== "formal") continue;
    const proofPath = resolveStatePath(
      join(root, ".crewclaw", "runs", `${outcome.task_run_id}.proofpack.json`),
      root,
      { mustExist: false }
    );
    if (!existsSync(proofPath)) continue;
    try {
      const bytes = readStateFileGuarded(proofPath, { root });
      const proof = JSON.parse(bytes.toString("utf8"));
      if (proof.task_run_id !== outcome.task_run_id) continue;
      const rawDecision = proof.user_approval?.decision;
      const decision =
        rawDecision === "accept" || rawDecision === "reject"
          ? rawDecision
          : "none";
      const proofpackHash = sha256Id(bytes);
      receipts.push({
        task_run_id: outcome.task_run_id,
        decision,
        proofpack_hash: proofpackHash,
      });
      hashes.push(
        sourceHash(
          "task_proofpack",
          `.crewclaw/runs/${outcome.task_run_id}.proofpack.json`,
          bytes,
          visibility
        )
      );
    } catch {
      // Invalid task receipts are omitted and surfaced by the aggregate mismatch warning.
    }
  }
  return {
    projection: {
      verified_proofpacks: receipts.length,
      accepted_receipts: receipts.filter(
        receipt => receipt.decision === "accept"
      ).length,
      task_receipts: visibility === "internal" ? receipts : [],
    },
    hashes,
  };
}

function latestDreamActivation(root, employeeId, visibility) {
  try {
    const directory = resolveStatePath(
      join(root, ".crewclaw", "dream", employeeId, "activations"),
      root,
      { mustExist: false }
    );
    if (!existsSync(directory)) return null;
    const candidates = readdirSync(directory)
      .filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      .map(name => {
        const path = resolveStatePath(join(directory, name), root, {
          mustExist: true,
        });
        const bytes = readStateFileGuarded(path, { root });
        const activation = JSON.parse(bytes.toString("utf8"));
        return { name, bytes, activation };
      })
      .filter(
        item =>
          item.activation?.contract === "crewclaw.memory-activation/v1" &&
          item.activation?.employee_id === employeeId &&
          typeof item.activation?.activated_at === "string"
      )
      .sort((left, right) =>
        right.activation.activated_at.localeCompare(
          left.activation.activated_at
        )
      );
    if (!candidates.length) return null;
    const latest = candidates[0];
    return {
      activation: latest.activation,
      hash: sourceHash(
        "dream_activation",
        `.crewclaw/dream/${employeeId}/activations/${latest.name}`,
        latest.bytes,
        visibility
      ),
    };
  } catch {
    return null;
  }
}

function employeeState({ packageStatus, credential, fieldStatus }) {
  const labStatus = credential?.effective_status || "untested";
  const derivedLevel =
    fieldStatus === "proven"
      ? "C3"
      : labStatus === "certified"
        ? "C2"
        : packageStatus === "validated"
          ? "C1"
          : "C0";
  return {
    contract: "crewclaw.good-employee-state/v1",
    package_status: packageStatus,
    lab_status: labStatus,
    field_status: fieldStatus,
    derived_level: derivedLevel,
    ...(derivedLevel === "C2"
      ? {}
      : {
          reason:
            "Level is derived from currently verifiable package, lab, and field evidence.",
        }),
  };
}

function credentialProjection(credential) {
  if (!credential) return null;
  const baseCredential = { ...credential };
  delete baseCredential.effective_status;
  delete baseCredential.status_receipt;
  const verification = verifyCertificationCredential(baseCredential);
  return {
    credential_id: credential.credential_id,
    effective_status: credential.effective_status,
    subject_hash: credential.subject_hash,
    memory_state_hash: credential.memory_state_hash,
    profile_id: credential.profile.id,
    profile_version: credential.profile.version,
    issued_at: credential.issued_at,
    expires_at: credential.expires_at,
    signed: Boolean(credential.issuer?.signature),
    verified: verification.ok,
    sample_size: credential.sample_size,
    success_rate: credential.metrics.success_rate,
    success_confidence_low: credential.metrics.success_confidence_low,
    correct_stop_rate: credential.metrics.correct_stop_rate,
    evidence_coverage: credential.metrics.evidence_coverage,
    permission_violations: credential.hard_gates.permission_violations,
    safety_violations: credential.hard_gates.safety_violations,
    proof_pack_hash: credential.proof_pack_hash,
  };
}

function kpiProjection(summary) {
  return {
    contract: summary.contract,
    tasks: summary.tasks,
    successful: summary.successful,
    accepted: summary.accepted,
    auto_accepted: summary.auto_accepted,
    correctly_blocked: summary.correctly_blocked,
    rejected: summary.rejected,
    failed: summary.failed,
    chat_turns: summary.chat_turns,
    total_cost: summary.total_cost,
    cost_currency: summary.cost_currency,
    average_duration_ms: summary.average_duration_ms,
    evidence_coverage: summary.evidence_coverage,
    permission_violations: summary.permission_violations,
    safety_violations: summary.safety_violations,
    legacy_unclassified_tasks: summary.legacy_unclassified_tasks,
  };
}

function proofPayload(pack) {
  return { ...pack, integrity: { ...pack.integrity, content_hash: "" } };
}

export function verifyEmployeeProofPack(pack) {
  const failures = [];
  if (pack?.contract !== EMPLOYEE_PROOFPACK_CONTRACT)
    failures.push("contract mismatch");
  if (!SAFE_AGENT_ID.test(String(pack?.employee_id || "")))
    failures.push("employee id invalid");
  if (!Array.isArray(pack?.integrity?.source_hashes))
    failures.push("source hashes missing");
  const expected = sha256Id(stableJson(proofPayload(pack || {})));
  if (pack?.integrity?.content_hash !== expected)
    failures.push("content hash mismatch");
  if (pack?.certification?.effective_status === "certified") {
    if (!pack.certification.signed || !pack.certification.verified)
      failures.push("certified projection is not signed and verified");
  }
  return { ok: failures.length === 0, failures };
}

export function buildEmployeeProofPack(
  root,
  employeeId,
  {
    specRoot = root,
    visibility = "public",
    generatedAt = new Date().toISOString(),
  } = {}
) {
  if (!SAFE_AGENT_ID.test(String(employeeId || "")))
    throw new Error("invalid employee id");
  if (!["public", "internal"].includes(visibility))
    throw new Error("invalid proof pack visibility");
  const subject = loadEmployeeSpec(specRoot, employeeId);
  const ledger = readKpiLedger(root, employeeId);
  const kpi = readKpi(root, employeeId);
  const warnings = [];
  if (!ledger) warnings.push("KPI ledger is missing or invalid.");
  if (kpi.legacy_unclassified_tasks > 0)
    warnings.push(
      "Legacy task counters are unclassified and excluded from formal-task metrics."
    );
  const activeMemory = loadMemory(root, employeeId);
  const memoryState = computeMemoryStateHash(activeMemory.items);
  let credential = readLatestCertificationCredential(root, employeeId, {
    expectedSubjectHash: subject.subjectHash,
    expectedMemoryStateHash: memoryState.memory_state_hash,
  });
  if (activeMemory.error) {
    warnings.push(`Active memory is unreadable: ${activeMemory.error}`);
    if (credential?.effective_status === "certified")
      credential = { ...credential, effective_status: "stale" };
  }
  if (credential && credential.effective_status !== "certified")
    warnings.push(
      `Latest certification is ${credential.effective_status}; C2 is not active.`
    );
  const policy = subject.certificationPolicy;
  const packageStatus =
    policy?.package_status === "draft" ? "draft" : "validated";
  // Field status is never accepted from a self-authored package. A future field-evidence
  // authority can promote this only by adding a verified field credential.
  const fieldStatus = "insufficient";
  if (policy?.field_status && policy.field_status !== fieldStatus)
    warnings.push(
      "Self-authored field status was not promoted without field evidence."
    );
  const tasks = taskEvidence(root, employeeId, ledger, visibility);
  if (tasks.projection.verified_proofpacks < kpi.accepted + kpi.auto_accepted)
    warnings.push(
      "Some accepted KPI settlements do not have a readable matching Task ProofPack."
    );
  const dream = latestDreamActivation(root, employeeId, visibility);
  const sourceHashes = [...tasks.hashes];
  if (ledger)
    sourceHashes.unshift(
      sourceHash("kpi", `.crewclaw/kpi/${employeeId}.json`, ledger, visibility)
    );
  if (credential)
    sourceHashes.push(
      sourceHash(
        "certification",
        `.crewclaw/certification/${employeeId}/credentials/${credential.credential_id}.json`,
        credential,
        visibility
      )
    );
  if (dream) sourceHashes.push(dream.hash);
  const pack = {
    contract: EMPLOYEE_PROOFPACK_CONTRACT,
    employee_id: employeeId,
    generated_at: generatedAt,
    visibility,
    employee_state: employeeState({ packageStatus, credential, fieldStatus }),
    certification: credentialProjection(credential),
    kpi: kpiProjection(kpi),
    task_evidence: tasks.projection,
    dream: dream
      ? {
          activation_id: dream.activation.activation_id,
          activated_at: dream.activation.activated_at,
          activated_memory_hash: dream.activation.activated_memory_hash,
          recertification_required:
            credential?.effective_status !== "certified",
        }
      : null,
    integrity: { source_hashes: sourceHashes, content_hash: "" },
    warnings,
  };
  pack.integrity.content_hash = sha256Id(stableJson(proofPayload(pack)));
  const verification = verifyEmployeeProofPack(pack);
  if (!verification.ok)
    throw new Error(
      `generated employee proof pack is invalid: ${verification.failures.join("; ")}`
    );
  return pack;
}

export function persistEmployeeProofPack(root, pack) {
  const verification = verifyEmployeeProofPack(pack);
  if (!verification.ok)
    return { written: false, reason: verification.failures.join("; ") };
  const directory = join(
    root,
    ".crewclaw",
    "proofpacks",
    "employees",
    pack.employee_id
  );
  const immutablePath = resolveStatePath(
    join(
      directory,
      `${pack.visibility}-${pack.integrity.content_hash.slice(-20)}.json`
    ),
    root
  );
  const latestPath = resolveStatePath(
    join(directory, `${pack.visibility}-latest.json`),
    root
  );
  return withStateLock(
    `${latestPath}.lock`,
    () => {
      if (existsSync(immutablePath)) {
        const prior = JSON.parse(
          readStateFileGuarded(immutablePath, { root }).toString("utf8")
        );
        if (stableJson(prior) !== stableJson(pack))
          return { written: false, reason: "proof pack hash conflict" };
      } else {
        writeJsonAtomic(immutablePath, pack, { root });
      }
      writeJsonAtomic(latestPath, pack, { root });
      return { written: true, path: immutablePath, latest_path: latestPath };
    },
    { root }
  );
}
