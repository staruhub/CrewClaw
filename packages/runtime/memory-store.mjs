import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveStatePath,
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

export const MEMORY_CATEGORIES = [
  "user_prefs",
  "project_facts",
  "successful_toolchains",
  "failure_paths",
  "reliable_sources",
  "verified_sops",
];

function sanitizeEmployeeId(employeeId) {
  return String(employeeId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function memoryDir(root) {
  return join(root, ".crewclaw", "memory");
}

function memoryFile(root, employeeId) {
  return resolveStatePath(
    join(memoryDir(root), sanitizeEmployeeId(employeeId) + ".json"),
    root
  );
}

function readMemoryArray(file, root) {
  if (!existsSync(file)) return [];
  const data = JSON.parse(
    readStateFileGuarded(file, { root }).toString("utf8")
  );
  return Array.isArray(data) ? data : [];
}

export function shouldRecord(item) {
  if (!item) return false;
  if (!MEMORY_CATEGORIES.includes(item.category)) return false;
  if (item.sensitive === true) return false;
  if (item.confidence === "low") return false;
  if (item.ephemeral === true) return false;
  if (typeof item.text !== "string") return false;
  if (item.text.trim() === "") return false;
  return true;
}

export function addMemory(root, employeeId, item) {
  if (!shouldRecord(item)) return { ok: false, skipped: true };

  try {
    const file = memoryFile(root, employeeId);
    return withStateLock(
      `${file}.lock`,
      () => {
        const items = readMemoryArray(file, root);
        const keyCategory = item.category;
        const keyText = item.text.trim().toLowerCase();
        const duplicate = items.some(existing => {
          return (
            existing?.category === keyCategory &&
            String(existing?.text ?? "")
              .trim()
              .toLowerCase() === keyText
          );
        });

        if (duplicate) {
          return { ok: true, skipped: true, count: items.length };
        }
        items.push({ ...item, savedAt: new Date().toISOString() });
        writeJsonAtomic(file, items, { root });
        return { ok: true, skipped: false, count: items.length };
      },
      { root }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadMemory(root, employeeId) {
  try {
    const file = memoryFile(root, employeeId);
    if (!existsSync(file)) return { ok: false, items: [] };
    const items = readMemoryArray(file, root);
    return { ok: true, items, savedAt: items[items.length - 1]?.savedAt };
  } catch (error) {
    return { ok: false, items: [], error: error?.message ?? String(error) };
  }
}

export function summarizeForPrompt(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const lines = [];
  for (const category of MEMORY_CATEGORIES) {
    const categoryItems = items.filter(
      item =>
        item?.category === category &&
        typeof item.text === "string" &&
        item.text.trim()
    );
    if (categoryItems.length === 0) continue;
    lines.push(category + ":");
    for (const item of categoryItems) {
      lines.push("- " + item.text.trim());
    }
  }

  return lines.join(String.fromCharCode(10));
}
