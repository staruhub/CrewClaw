import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { sha256Id, stableJson } from "./certification.mjs";
import { computeMemoryStateHash } from "./memory-hash.mjs";
import { loadMemory } from "./memory-store.mjs";
import {
  readStateFileGuarded,
  removeStateFileGuarded,
  removeStateTreeGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const MEMORY_PACK_CONTRACT = "crewclaw.memory-pack/v1";
export const OFFBOARDING_RECEIPT_CONTRACT = "crewclaw.offboarding/v1";
export const OFFBOARDING_MODES = Object.freeze([
  "export_memory",
  "handoff",
  "purge",
]);

const SAFE_EMPLOYEE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEMORY_CATEGORIES = new Set([
  "user_prefs",
  "project_facts",
  "successful_toolchains",
  "failure_paths",
  "reliable_sources",
  "verified_sops",
]);
const RETAINED_AUDIT_SCOPES = Object.freeze([
  "team",
  "activity",
  "task_runs",
  "proofpacks",
  "kpi",
  "eval",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TEAM_FIELDS = new Set([
  "workspace_employee_id",
  "employee_id",
  "version",
  "package_sha256",
  "hire_source",
  "status",
  "hired_at",
  "fired_at",
  "permissions_granted",
]);

function codedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function assertEmployeeId(value, label = "employee id") {
  const text = String(value || "");
  if (!SAFE_EMPLOYEE_ID.test(text)) {
    throw codedError("OFFBOARDING_INVALID_REQUEST", `invalid ${label}`);
  }
  return text;
}

function canonicalOwnerLock(root, stateName) {
  return join(root, ".crewclaw", `.${stateName}.lock`);
}

function stateFile(root, ...segments) {
  return resolveStatePath(join(root, ".crewclaw", ...segments), root);
}

function readJsonFile(path, root) {
  return JSON.parse(readStateFileGuarded(path, { root }).toString("utf8"));
}

function readTeam(root) {
  const path = stateFile(root, "team.json");
  if (!existsSync(path)) return [];
  let team;
  try {
    team = readJsonFile(path, root);
  } catch (error) {
    throw codedError(
      "OFFBOARDING_TEAM_INVALID",
      "the local team file is unreadable or invalid",
      error
    );
  }
  if (!Array.isArray(team) || team.length > 1_024) {
    throw codedError(
      "OFFBOARDING_TEAM_INVALID",
      "the local team file must contain a bounded array"
    );
  }
  const activeCounts = new Map();
  for (const record of team) {
    if (
      !record ||
      typeof record !== "object" ||
      !SAFE_EMPLOYEE_ID.test(String(record.employee_id || "")) ||
      typeof record.workspace_employee_id !== "string" ||
      !record.workspace_employee_id ||
      typeof record.version !== "string" ||
      !record.version ||
      !["active", "warning", "broken", "fired"].includes(record.status) ||
      !ISO_DATETIME.test(String(record.hired_at || "")) ||
      !(
        record.fired_at === null ||
        ISO_DATETIME.test(String(record.fired_at || ""))
      ) ||
      !Array.isArray(record.permissions_granted) ||
      record.permissions_granted.some(
        permission => typeof permission !== "string" || !permission
      ) ||
      (record.package_sha256 !== undefined &&
        record.package_sha256 !== null &&
        !/^[a-f0-9]{64}$/.test(record.package_sha256)) ||
      (record.hire_source !== undefined &&
        !["website", "cli", "eval_harness"].includes(record.hire_source)) ||
      Object.keys(record).some(key => !TEAM_FIELDS.has(key))
    ) {
      throw codedError(
        "OFFBOARDING_TEAM_INVALID",
        "the local team file does not match the roster contract"
      );
    }
    if (record.status === "active") {
      activeCounts.set(
        record.employee_id,
        (activeCounts.get(record.employee_id) || 0) + 1
      );
    }
  }
  if ([...activeCounts.values()].some(count => count > 1)) {
    throw codedError(
      "OFFBOARDING_TEAM_INVALID",
      "the local team file contains duplicate active employees"
    );
  }
  return team;
}

function activeEmployee(team, employeeId) {
  return team.find(
    record => record.employee_id === employeeId && record.status === "active"
  );
}

function writeTeam(root, team) {
  writeJsonAtomic(stateFile(root, "team.json"), team, { root });
}

function optionalString(value, label) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw codedError("OFFBOARDING_MEMORY_INVALID", `invalid memory ${label}`);
  }
  return value;
}

function isoDateTime(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !ISO_DATETIME.test(value)) {
    throw codedError("OFFBOARDING_MEMORY_INVALID", `invalid memory ${label}`);
  }
  return value;
}

function stringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== "string" || !item)
  ) {
    throw codedError("OFFBOARDING_MEMORY_INVALID", `invalid memory ${label}`);
  }
  return [...value];
}

function exportableMemoryItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError(
      "OFFBOARDING_MEMORY_INVALID",
      "memory item must be an object"
    );
  }
  const category = String(value.category || "");
  const text = String(value.text || "");
  const confidence = String(value.confidence || "");
  if (!MEMORY_CATEGORIES.has(category) || !text || text.length > 2_000) {
    throw codedError(
      "OFFBOARDING_MEMORY_INVALID",
      "invalid memory category or text"
    );
  }
  if (!["low", "medium", "high"].includes(confidence)) {
    throw codedError("OFFBOARDING_MEMORY_INVALID", "invalid memory confidence");
  }
  const status = value.status === undefined ? "active" : value.status;
  const sourceType =
    value.source_type === undefined ? "legacy" : value.source_type;
  if (!["active", "superseded", "archived"].includes(status)) {
    throw codedError("OFFBOARDING_MEMORY_INVALID", "invalid memory status");
  }
  if (!["legacy", "dream"].includes(sourceType)) {
    throw codedError(
      "OFFBOARDING_MEMORY_INVALID",
      "invalid memory source_type"
    );
  }
  const item = {
    category,
    text,
    confidence,
    status,
    source_type: sourceType,
    source_task_ids: stringArray(
      value.source_task_ids ?? [],
      "source_task_ids"
    ),
    evidence_ids: stringArray(value.evidence_ids ?? [], "evidence_ids"),
    created_by_model: optionalString(
      value.created_by_model ?? null,
      "created_by_model"
    ),
    dream_run_id: optionalString(value.dream_run_id ?? null, "dream_run_id"),
  };
  for (const [key, outputKey] of [
    ["savedAt", "savedAt"],
    ["valid_until", "valid_until"],
    ["supersedes", "supersedes"],
  ]) {
    if (value[key] !== undefined) {
      item[outputKey] =
        key === "supersedes"
          ? optionalString(value[key], key)
          : isoDateTime(value[key], key, { nullable: key === "valid_until" });
    }
  }
  for (const key of ["sensitive", "ephemeral"]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") {
        throw codedError("OFFBOARDING_MEMORY_INVALID", `invalid memory ${key}`);
      }
      item[key] = value[key];
    }
  }
  return item;
}

function contentPayload(value) {
  return { ...value, integrity: { ...value.integrity, content_hash: "" } };
}

export function verifyMemoryPack(pack) {
  const failures = [];
  if (pack?.contract !== MEMORY_PACK_CONTRACT)
    failures.push("contract mismatch");
  if (!SAFE_EMPLOYEE_ID.test(String(pack?.employee_id || "")))
    failures.push("employee id invalid");
  if (!Array.isArray(pack?.items) || pack?.item_count !== pack?.items?.length) {
    failures.push("item count mismatch");
  }
  if (!SHA256.test(String(pack?.memory_state_hash || ""))) {
    failures.push("memory state hash invalid");
  }
  if (!SHA256.test(String(pack?.provenance?.source_sha256 || ""))) {
    failures.push("source hash invalid");
  }
  const expected = sha256Id(stableJson(contentPayload(pack || {})));
  if (pack?.integrity?.content_hash !== expected)
    failures.push("content hash mismatch");
  return { ok: failures.length === 0, failures };
}

export function buildMemoryPack(
  root,
  employee,
  { offboardingId, exportedAt = new Date().toISOString() } = {}
) {
  const loaded = loadMemory(root, employee.employee_id);
  if (loaded.error) {
    throw codedError(
      "OFFBOARDING_MEMORY_INVALID",
      `active memory is unreadable: ${loaded.error}`
    );
  }
  const items = loaded.items.map(exportableMemoryItem);
  const memoryState = computeMemoryStateHash(items);
  const sourceSha = sha256Id(stableJson(items));
  const pack = {
    contract: MEMORY_PACK_CONTRACT,
    pack_id: `memory-pack-${sha256Id(`${offboardingId}\n${employee.workspace_employee_id}`).slice(-20)}`,
    employee_id: employee.employee_id,
    workspace_employee_id: employee.workspace_employee_id,
    exported_at: exportedAt,
    memory_state_hash: memoryState.memory_state_hash,
    item_count: items.length,
    items,
    provenance: { source: "active_memory", source_sha256: sourceSha },
    integrity: { content_hash: "" },
  };
  pack.integrity.content_hash = sha256Id(stableJson(contentPayload(pack)));
  const verification = verifyMemoryPack(pack);
  if (!verification.ok) {
    throw codedError(
      "OFFBOARDING_MEMORY_INVALID",
      `generated memory pack is invalid: ${verification.failures.join("; ")}`
    );
  }
  return pack;
}

function relativeStatePath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function writeFailure(root, directory, phase, error, now) {
  try {
    writeJsonAtomic(
      resolveStatePath(join(directory, "failure.json"), root),
      {
        contract: "crewclaw.offboarding-failure/v1",
        phase,
        failed_at: now(),
        code: String(error?.code || "OFFBOARDING_FAILED"),
        message: String(error?.message || error),
      },
      { root }
    );
  } catch {
    // Preserve the original failure; the caller must never see a false success.
  }
}

function appendActivity(root, employeeId, offboardingId, firedAt) {
  const path = stateFile(root, "activity.json");
  return withStateLock(
    canonicalOwnerLock(root, "activity.json"),
    () => {
      const entries = existsSync(path) ? readJsonFile(path, root) : [];
      if (!Array.isArray(entries) || entries.length >= 100_000) {
        throw new Error("activity ledger is invalid or full");
      }
      entries.push({
        ts: firedAt,
        action: "fire",
        employee: employeeId,
        offboarding_id: offboardingId,
      });
      writeJsonAtomic(path, entries, { root });
    },
    { root }
  );
}

function purgeEmployeeState(root, employeeId, workspaceEmployeeId) {
  const deleted = [];
  return withStateLock(
    canonicalOwnerLock(root, "team.json"),
    () => {
      const team = readTeam(root);
      if (activeEmployee(team, employeeId)) {
        throw codedError(
          "OFFBOARDING_PURGE_REHIRE_RACE",
          "purge refused because the employee is active again"
        );
      }
      const fired = team.find(
        record =>
          record.workspace_employee_id === workspaceEmployeeId &&
          record.employee_id === employeeId &&
          record.status === "fired"
      );
      if (!fired) {
        throw codedError(
          "OFFBOARDING_PURGE_EMPLOYMENT_MISMATCH",
          "purge refused because the fired employment record changed"
        );
      }

      try {
        const files = [
          ["memory", stateFile(root, "memory", `${employeeId}.json`)],
          ["skill_usage", stateFile(root, "skill-usage", `${employeeId}.json`)],
        ];
        for (const [scope, path] of files) {
          withStateLock(
            `${path}.lock`,
            () => removeStateFileGuarded(path, { root }),
            { root }
          );
          deleted.push(scope);
        }
        for (const [scope, path] of [
          [
            "memory_candidates",
            join(root, ".crewclaw", "memory-candidates", employeeId),
          ],
          ["dream", join(root, ".crewclaw", "dream", employeeId)],
        ]) {
          removeStateTreeGuarded(path, { root });
          deleted.push(scope);
        }
      } catch (error) {
        error.deletedScopes = [...deleted];
        throw error;
      }
      return deleted;
    },
    { root }
  );
}

function receiptPayload(receipt) {
  return { ...receipt, integrity: { ...receipt.integrity, content_hash: "" } };
}

export function verifyOffboardingReceipt(receipt) {
  const failures = [];
  if (receipt?.contract !== OFFBOARDING_RECEIPT_CONTRACT)
    failures.push("contract mismatch");
  if (
    receipt?.fire?.status !== "fired" ||
    receipt?.fire?.permissions_active !== false
  ) {
    failures.push("fire outcome invalid");
  }
  if (receipt?.billing?.status !== "not_applicable")
    failures.push("billing claim invalid");
  const expected = sha256Id(stableJson(receiptPayload(receipt || {})));
  if (receipt?.integrity?.content_hash !== expected)
    failures.push("content hash mismatch");
  return { ok: failures.length === 0, failures };
}

export function offboardEmployee(
  rootInput,
  employeeIdInput,
  {
    mode = "export_memory",
    successorEmployeeId = null,
    now = () => new Date().toISOString(),
    id = () => randomUUID(),
  } = {}
) {
  const root = resolve(rootInput);
  const employeeId = assertEmployeeId(employeeIdInput);
  if (!OFFBOARDING_MODES.includes(mode)) {
    throw codedError("OFFBOARDING_INVALID_REQUEST", "invalid offboarding mode");
  }
  if (successorEmployeeId !== null) {
    successorEmployeeId = assertEmployeeId(
      successorEmployeeId,
      "successor employee id"
    );
  }
  if (mode !== "handoff" && successorEmployeeId !== null) {
    throw codedError(
      "OFFBOARDING_INVALID_REQUEST",
      "a successor is only valid for handoff mode"
    );
  }

  const requestedAt = now();
  const offboardingId = `offboarding-${id()}`;
  const directory = join(root, ".crewclaw", "offboarding", offboardingId);
  const intentPath = resolveStatePath(join(directory, "intent.json"), root);
  let employee;
  withStateLock(
    canonicalOwnerLock(root, "team.json"),
    () => {
      employee = activeEmployee(readTeam(root), employeeId);
      if (!employee) {
        throw codedError(
          "OFFBOARDING_ACTIVE_EMPLOYEE_NOT_FOUND",
          `${employeeId} is not active in this crew`
        );
      }
      employee = structuredClone(employee);
    },
    { root }
  );
  writeJsonAtomic(
    intentPath,
    {
      contract: "crewclaw.offboarding-intent/v1",
      offboarding_id: offboardingId,
      employee_id: employeeId,
      workspace_employee_id: employee.workspace_employee_id,
      mode,
      successor_employee_id: successorEmployeeId,
      requested_at: requestedAt,
      state: "prepared",
    },
    { root }
  );

  let pack = null;
  let handoff = null;
  try {
    if (mode === "export_memory" || mode === "handoff") {
      pack = buildMemoryPack(root, employee, {
        offboardingId,
        exportedAt: now(),
      });
      writeJsonAtomic(
        resolveStatePath(join(directory, "memory-pack.json"), root),
        pack,
        {
          root,
        }
      );
    }
    if (mode === "handoff") {
      handoff = {
        contract: "crewclaw.offboarding-handoff/v1",
        draft_id: `handoff-${id()}`,
        employee_id: employeeId,
        workspace_employee_id: employee.workspace_employee_id,
        successor_employee_id: successorEmployeeId,
        memory_pack_id: pack.pack_id,
        created_at: now(),
        state: "draft",
        next_action: "open_market_with_prefilled_role_contract",
        integrity: { content_hash: "" },
      };
      handoff.integrity.content_hash = sha256Id(
        stableJson(contentPayload(handoff))
      );
      writeJsonAtomic(
        resolveStatePath(join(directory, "handoff.json"), root),
        handoff,
        {
          root,
        }
      );
    }
  } catch (error) {
    writeFailure(root, directory, "prepare", error, now);
    throw error;
  }

  let fired;
  try {
    withStateLock(
      canonicalOwnerLock(root, "team.json"),
      () => {
        const team = readTeam(root);
        const active = activeEmployee(team, employeeId);
        if (
          !active ||
          active.workspace_employee_id !== employee.workspace_employee_id
        ) {
          throw codedError(
            "OFFBOARDING_EMPLOYMENT_CHANGED",
            "the active employment changed after offboarding preparation"
          );
        }
        const firedAt = now();
        fired = { ...active, status: "fired", fired_at: firedAt };
        writeTeam(
          root,
          team.map(record =>
            record.workspace_employee_id === active.workspace_employee_id
              ? fired
              : record
          )
        );
      },
      { root }
    );
  } catch (error) {
    writeFailure(root, directory, "fire", error, now);
    throw error;
  }

  const warnings = [];
  let partial = false;
  try {
    appendActivity(root, employeeId, offboardingId, fired.fired_at);
  } catch (error) {
    partial = true;
    warnings.push(`Activity ledger append failed: ${error?.message || error}`);
  }

  const purgeResult = {
    requested: mode === "purge",
    status: mode === "purge" ? "purged" : "not_requested",
    deleted_scopes: [],
    retained_audit_scopes: [...RETAINED_AUDIT_SCOPES],
    media_sanitization: "not_performed",
  };
  if (mode === "purge") {
    warnings.push(
      "Logical application-state purge was performed; storage media sanitization was not performed."
    );
    try {
      purgeResult.deleted_scopes = purgeEmployeeState(
        root,
        employeeId,
        employee.workspace_employee_id
      );
    } catch (error) {
      partial = true;
      purgeResult.status = "failed";
      purgeResult.deleted_scopes = Array.isArray(error?.deletedScopes)
        ? error.deletedScopes
        : [];
      warnings.push(`Logical purge failed: ${error?.message || error}`);
    }
  }

  const receipt = {
    contract: OFFBOARDING_RECEIPT_CONTRACT,
    offboarding_id: offboardingId,
    employee_id: employeeId,
    workspace_employee_id: employee.workspace_employee_id,
    requested_at: requestedAt,
    completed_at: now(),
    outcome: partial ? "partial" : "completed",
    export_memory: {
      requested: Boolean(pack),
      status: pack ? "exported" : "not_requested",
      pack_id: pack?.pack_id ?? null,
      pack_sha256: pack?.integrity.content_hash ?? null,
      relative_path: pack
        ? relativeStatePath(root, join(directory, "memory-pack.json"))
        : null,
    },
    handoff: {
      requested: Boolean(handoff),
      status: handoff ? "drafted" : "not_requested",
      draft_id: handoff?.draft_id ?? null,
      successor_employee_id: handoff?.successor_employee_id ?? null,
    },
    fire: {
      status: "fired",
      fired_at: fired.fired_at,
      permissions_active: false,
    },
    purge: purgeResult,
    billing: {
      status: "not_applicable",
      reason: "local_runtime_has_no_billing_executor",
    },
    warnings,
    integrity: { content_hash: "" },
  };
  receipt.integrity.content_hash = sha256Id(
    stableJson(receiptPayload(receipt))
  );
  const verification = verifyOffboardingReceipt(receipt);
  if (!verification.ok) {
    const error = codedError(
      "OFFBOARDING_RECEIPT_INVALID",
      `generated offboarding receipt is invalid: ${verification.failures.join("; ")}`
    );
    writeFailure(root, directory, "receipt", error, now);
    throw error;
  }
  const receiptPath = resolveStatePath(join(directory, "receipt.json"), root);
  writeJsonAtomic(receiptPath, receipt, { root });
  return {
    receipt,
    receipt_path: receiptPath,
    memory_pack: pack,
    handoff,
    employee: fired,
    team: readTeam(root),
  };
}
