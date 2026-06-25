import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  return join(memoryDir(root), sanitizeEmployeeId(employeeId) + ".json");
}

function readMemoryArray(file) {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8"));
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
    mkdirSync(memoryDir(root), { recursive: true });
    const file = memoryFile(root, employeeId);
    const items = readMemoryArray(file);
    const keyCategory = item.category;
    const keyText = item.text.trim().toLowerCase();
    const exists = items.some((existing) => {
      return existing?.category === keyCategory && String(existing?.text ?? "").trim().toLowerCase() === keyText;
    });

    if (!exists) {
      items.push({ ...item, savedAt: new Date().toISOString() });
      writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
    }

    return { ok: true, count: items.length };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadMemory(root, employeeId) {
  try {
    const file = memoryFile(root, employeeId);
    if (!existsSync(file)) return { ok: false, items: [] };
    const items = readMemoryArray(file);
    return { ok: true, items, savedAt: items[items.length - 1]?.savedAt };
  } catch (error) {
    return { ok: false, items: [], error: error?.message ?? String(error) };
  }
}

export function summarizeForPrompt(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const lines = [];
  for (const category of MEMORY_CATEGORIES) {
    const categoryItems = items.filter((item) => item?.category === category && typeof item.text === "string" && item.text.trim());
    if (categoryItems.length === 0) continue;
    lines.push(category + ":");
    for (const item of categoryItems) {
      lines.push("- " + item.text.trim());
    }
  }

  return lines.join(String.fromCharCode(10));
}
