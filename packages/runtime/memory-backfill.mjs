// M0.5 — legacy memory backfill to the crewclaw.memory-item/v2 lifecycle fields.
//
//   pnpm run memory:backfill            # all employees with a memory file
//   pnpm run memory:backfill <slug>     # one employee
//
// Guarantees (tested in __tests__/memory-backfill.test.mjs):
//   - Idempotent: a second run changes nothing and writes nothing.
//   - Additive only: existing fields, item order, and recall content are untouched — v2 fields
//     are appended with legacy values (empty provenance is honest: we never invent TaskRun or
//     Evidence sources for pre-Dream entries).
//   - A timestamped backup of the original file is written before the first mutation.
//   - Old runtimes keep working: extra JSON fields are ignored by every v1 reader.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  resolveStatePath,
  readStateFileGuarded,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

const LEGACY_DEFAULTS = Object.freeze({
  status: "active",
  source_type: "legacy",
  source_task_ids: Object.freeze([]),
  evidence_ids: Object.freeze([]),
  created_by_model: null,
  dream_run_id: null,
});

function memoryDir(root) {
  return join(root, ".crewclaw", "memory");
}

function memoryFile(root, employeeId) {
  const safe = String(employeeId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return resolveStatePath(join(memoryDir(root), `${safe}.json`), root);
}

export function backfillMemoryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { item, changed: false };
  }
  let changed = false;
  const next = { ...item };
  for (const [key, value] of Object.entries(LEGACY_DEFAULTS)) {
    if (next[key] === undefined) {
      next[key] = Array.isArray(value) ? [...value] : value;
      changed = true;
    }
  }
  return { item: next, changed };
}

export function backfillEmployeeMemory(root, employeeId) {
  const file = memoryFile(root, employeeId);
  if (!existsSync(file)) {
    return { ok: true, employeeId, changed: false, reason: "no memory file" };
  }

  return withStateLock(
    `${file}.lock`,
    () => {
      const raw = readStateFileGuarded(file, { root }).toString("utf8");
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) {
        return { ok: false, employeeId, changed: false, reason: "memory file is not an array" };
      }

      let changedCount = 0;
      const next = items.map(entry => {
        const { item, changed } = backfillMemoryItem(entry);
        if (changed) changedCount += 1;
        return item;
      });

      if (changedCount === 0) {
        return { ok: true, employeeId, changed: false, items: items.length };
      }

      const backup = `${file}.pre-v2-${Date.now()}.bak`;
      copyFileSync(file, backup);
      writeJsonAtomic(file, next, { root });
      return {
        ok: true,
        employeeId,
        changed: true,
        items: items.length,
        backfilled: changedCount,
        backup,
      };
    },
    { root }
  );
}

export function backfillAllEmployees(root) {
  const dir = memoryDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .map(name => backfillEmployeeMemory(root, name.replace(/\.json$/, "")));
}

function main() {
  const root = process.env.CREWCLAW_ROOT
    ? resolve(process.env.CREWCLAW_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const target = process.argv[2];
  const results = target
    ? [backfillEmployeeMemory(root, target)]
    : backfillAllEmployees(root);
  for (const result of results) {
    const detail = result.changed
      ? `backfilled ${result.backfilled}/${result.items} items (backup: ${result.backup})`
      : (result.reason ?? "already v2 — no changes");
    console.log(`${result.ok ? "ok " : "ERR"} ${result.employeeId}: ${detail}`);
  }
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
