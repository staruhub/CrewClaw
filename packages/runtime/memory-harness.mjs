import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addMemory, loadMemory } from "./memory-store.mjs";

const MEMORY_STORE_PATH = fileURLToPath(
  new URL("./memory-store.mjs", import.meta.url)
);
const DEFAULT_EMPLOYEE_ID = "crewclaw";
const DEFAULT_SCOPE = "session";
const DEFAULT_VISIBILITY = "private";
const DEFAULT_CATEGORY = "project_facts";

function isTruthyFlag(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

function memoryStoreWorks() {
  return (
    existsSync(MEMORY_STORE_PATH) &&
    typeof addMemory === "function" &&
    typeof loadMemory === "function"
  );
}

function normalizeScope(scope) {
  const normalized = String(scope ?? DEFAULT_SCOPE)
    .trim()
    .toLowerCase();
  if (["session", "workspace", "user", "org"].includes(normalized))
    return normalized;
  return DEFAULT_SCOPE;
}

function hasPersistentConfig(env = process.env) {
  return Boolean(env?.MEMORY_STORE_URL || env?.CREW_MEMORY_STORE_URL);
}

function persistentDisabled(env = process.env) {
  return (
    isTruthyFlag(env?.MEMORY_STORE_DISABLED) ||
    isTruthyFlag(env?.CREW_MEMORY_STORE_DISABLED)
  );
}

function scopeStatus(scope, truth) {
  if (scope === "session") return truth.session;
  if (scope === "workspace") return truth.workspace;
  if (scope === "user" || scope === "org") return truth.persistent;
  return "unavailable";
}

function makeMemoryId(scope) {
  const random = Math.random().toString(36).slice(2, 10);
  return "mem_" + scope + "_" + Date.now().toString(36) + "_" + random;
}

export function getMemoryTruth(env = process.env) {
  const storeAvailable = memoryStoreWorks();

  let persistent = "unavailable";
  if (persistentDisabled(env)) {
    persistent = "disabled";
  } else if (hasPersistentConfig(env)) {
    persistent = "available";
  }

  return {
    session: storeAvailable ? "available" : "unavailable",
    persistent,
    workspace: storeAvailable ? "available" : "unavailable",
  };
}

export function previewMemoryWrite({ content, scope } = {}) {
  return {
    scope: normalizeScope(scope),
    content: String(content ?? ""),
    visibility: DEFAULT_VISIBILITY,
    revocable: true,
    expires_at: null,
  };
}

export function commitMemoryWrite(record, opts = {}) {
  const env = opts.env ?? process.env;
  const truth = getMemoryTruth(env);
  const scope = normalizeScope(record?.scope);
  const status = scopeStatus(scope, truth);

  if (status !== "available") {
    return { ok: false, reason: "memory scope unavailable: " + scope };
  }

  const memoryRecord = {
    memory_id: record?.memory_id ?? makeMemoryId(scope),
    employee_id: record?.employee_id ?? opts.employeeId ?? DEFAULT_EMPLOYEE_ID,
    scope,
    content: String(record?.content ?? ""),
    source_task: record?.source_task ?? opts.sourceTask ?? null,
    created_at: record?.created_at ?? new Date().toISOString(),
    expires_at: record?.expires_at ?? null,
    visibility: record?.visibility ?? DEFAULT_VISIBILITY,
    revocable: record?.revocable ?? true,
  };

  const root = opts.root ?? process.cwd();
  const result = addMemory(root, memoryRecord.employee_id, {
    category: opts.category ?? DEFAULT_CATEGORY,
    text: memoryRecord.content,
    memoryRecord,
  });

  if (!result?.ok) {
    return { ok: false, reason: result?.error ?? "memory write rejected" };
  }

  return memoryRecord;
}

export function memoryCommandResponse(message, env = process.env) {
  const truth = getMemoryTruth(env);
  const needsConfirm = true;
  const text = String(message ?? "").trim();

  let note = "已识别记忆请求";
  if (text) note += "：" + text;

  if (truth.persistent === "available") {
    note += "。请确认后写入可撤销的 MemoryRecord。";
  } else {
    note += "。未配置跨会话记忆，记忆仅本会话有效。";
  }

  return { truth, needsConfirm, note };
}
