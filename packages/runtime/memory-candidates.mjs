import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MEMORY_CATEGORIES } from "./memory-store.mjs";
import {
  readStateFileGuarded,
  resolveStatePath,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const MEMORY_CANDIDATE_CONTRACT = "crewclaw.memory-candidate/v1";
const SECRET_PATTERN =
  /(?:api[_-]?key|access[_-]?token|private[_-]?key|password)\s*[:=]\s*\S+/i;

function safeEmployeeId(value) {
  const text = String(value || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) {
    throw new TypeError("note_memory employee id 无效");
  }
  return text;
}

export function memoryCandidateDir(root, employeeId) {
  return join(
    root,
    ".crewclaw",
    "memory-candidates",
    safeEmployeeId(employeeId)
  );
}

export function writeMemoryCandidate(
  root,
  employeeId,
  item,
  { taskRunId, now = Date.now() } = {}
) {
  const category = String(item?.category || "").trim();
  const text = String(item?.text || "").trim();
  const confidence = String(item?.confidence || "").trim();
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw new TypeError("note_memory category 无效");
  }
  if (!text || text.length > 2000 || SECRET_PATTERN.test(text)) {
    throw new TypeError("note_memory text 为空、过长或疑似包含凭据");
  }
  if (!new Set(["medium", "high"]).has(confidence)) {
    throw new TypeError("note_memory confidence 必须是 medium 或 high");
  }
  if (!taskRunId || typeof taskRunId !== "string") {
    throw new TypeError("note_memory 缺少 taskRunId");
  }
  const validUntil = item?.valid_until
    ? new Date(String(item.valid_until)).toISOString()
    : null;
  const supersedes = item?.supersedes ? String(item.supersedes).trim() : null;
  const id = `candidate-${createHash("sha256")
    .update(`${safeEmployeeId(employeeId)}\n${taskRunId}\n${category}\n${text}`)
    .digest("hex")
    .slice(0, 20)}`;
  const record = {
    contract: MEMORY_CANDIDATE_CONTRACT,
    id,
    employee_id: safeEmployeeId(employeeId),
    source_task_id: taskRunId,
    category,
    text,
    confidence,
    status: "pending_review",
    created_at: new Date(Number(now)).toISOString(),
    ...(validUntil ? { valid_until: validUntil } : {}),
    ...(supersedes ? { supersedes } : {}),
  };
  const path = resolveStatePath(
    join(memoryCandidateDir(root, employeeId), `${id}-${randomUUID()}.json`),
    root
  );
  writeJsonAtomic(path, record, { root });
  return { ...record, path };
}

export function loadMemoryCandidates(
  root,
  employeeId,
  { maxFiles = 1000 } = {}
) {
  const dir = memoryCandidateDir(root, employeeId);
  if (!existsSync(dir)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  for (const name of readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .sort()
    .slice(0, maxFiles)) {
    try {
      const path = resolveStatePath(join(dir, name), root);
      const record = JSON.parse(
        readStateFileGuarded(path, { root, maxBytes: 64 * 1024 }).toString(
          "utf8"
        )
      );
      if (
        record?.contract !== MEMORY_CANDIDATE_CONTRACT ||
        record.employee_id !== employeeId ||
        record.status !== "pending_review" ||
        !MEMORY_CATEGORIES.includes(record.category) ||
        typeof record.text !== "string" ||
        !record.text.trim()
      ) {
        throw new Error("invalid memory candidate");
      }
      records.push(record);
    } catch (error) {
      errors.push({ file: name, reason: error?.message || String(error) });
    }
  }
  return { records, errors };
}
