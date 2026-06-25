import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldRecord, addMemory, loadMemory, summarizeForPrompt } from "../memory-store.mjs";

const root = join(tmpdir(), "crewclaw-memory-store-test-" + process.pid + "-" + Date.now());

try {
  assert.equal(shouldRecord({ category: "project_facts", text: "x" }), true);
  assert.equal(shouldRecord({ category: "project_facts", text: "x", sensitive: true }), false);
  assert.equal(shouldRecord({ category: "nope", text: "x" }), false);
  assert.equal(shouldRecord({ category: "project_facts", text: "x", confidence: "low" }), false);

  const id = "employee:one";
  addMemory(root, id, { category: "project_facts", text: "fact A" });
  const loaded = loadMemory(root, id);
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].text, "fact A");

  const deduped = addMemory(root, id, { category: "project_facts", text: "fact A" });
  assert.equal(deduped.count, 1);

  const summary = summarizeForPrompt(loaded.items);
  assert.equal(typeof summary, "string");
  assert.equal(summary.includes("fact A"), true);
} finally {
  rmSync(root, { force: true, recursive: true });
}
