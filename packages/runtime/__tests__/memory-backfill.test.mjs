import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backfillEmployeeMemory,
  backfillMemoryItem,
} from "../memory-backfill.mjs";
import { computeMemoryStateHash } from "../memory-hash.mjs";
import { loadMemory } from "../memory-store.mjs";

const root = mkdtempSync(join(tmpdir(), "crew-backfill-"));
const employeeId = "ai-adoption-whale";
const memoryDir = join(root, ".crewclaw", "memory");
mkdirSync(memoryDir, { recursive: true });
const file = join(memoryDir, `${employeeId}.json`);

const legacyItems = [
  {
    category: "reliable_sources",
    text: "https://www.volcengine.com/product/ark",
    confidence: "high",
    savedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    category: "verified_sops",
    text: "研究任务先过 Search Provider preflight 再开工",
    confidence: "medium",
    savedAt: "2026-07-02T00:00:00.000Z",
  },
];

try {
  writeFileSync(file, `${JSON.stringify(legacyItems, null, 2)}\n`);
  const beforeRecall = loadMemory(root, employeeId).items;
  const beforeHash = computeMemoryStateHash(beforeRecall).memory_state_hash;

  // First run: backfills every item, creates exactly one backup.
  const first = backfillEmployeeMemory(root, employeeId);
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.backfilled, 2);
  assert.ok(
    first.backup && readFileSync(first.backup, "utf8").includes("volcengine")
  );

  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.length, 2);
  for (const [index, item] of after.entries()) {
    // additive only: every original field survives untouched, order preserved
    assert.equal(item.category, legacyItems[index].category);
    assert.equal(item.text, legacyItems[index].text);
    assert.equal(item.confidence, legacyItems[index].confidence);
    assert.equal(item.savedAt, legacyItems[index].savedAt);
    // v2 lifecycle fields, honest legacy provenance
    assert.equal(item.status, "active");
    assert.equal(item.source_type, "legacy");
    assert.deepEqual(item.source_task_ids, []);
    assert.deepEqual(item.evidence_ids, []);
    assert.equal(item.created_by_model, null);
    assert.equal(item.dream_run_id, null);
  }

  // Recall content/order and the memory state hash are unchanged by the backfill.
  const afterRecall = loadMemory(root, employeeId).items;
  assert.deepEqual(
    afterRecall.map(item => [item.category, item.text]),
    beforeRecall.map(item => [item.category, item.text]),
    "recall order and content must be unchanged"
  );
  assert.equal(
    computeMemoryStateHash(afterRecall).memory_state_hash,
    beforeHash,
    "backfill must not move the memory state hash"
  );

  // Second run: idempotent — nothing changes, nothing is written, no new backup.
  const backupsBefore = readdirSync(memoryDir).filter(name =>
    name.includes(".bak")
  ).length;
  const contentBefore = readFileSync(file, "utf8");
  const second = backfillEmployeeMemory(root, employeeId);
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(
    readFileSync(file, "utf8"),
    contentBefore,
    "second run must not rewrite the file"
  );
  const backupsAfter = readdirSync(memoryDir).filter(name =>
    name.includes(".bak")
  ).length;
  assert.equal(
    backupsAfter,
    backupsBefore,
    "second run must not create another backup"
  );

  // Item-level helper is pure and additive.
  const { item: filled, changed } = backfillMemoryItem({
    category: "user_prefs",
    text: "x",
    confidence: "high",
  });
  assert.equal(changed, true);
  assert.equal(filled.source_type, "legacy");
  const { changed: again } = backfillMemoryItem(filled);
  assert.equal(again, false);

  // Missing memory file is a no-op, not an error.
  const missing = backfillEmployeeMemory(root, "nobody");
  assert.equal(missing.ok, true);
  assert.equal(missing.changed, false);

  console.log("memory-backfill.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
