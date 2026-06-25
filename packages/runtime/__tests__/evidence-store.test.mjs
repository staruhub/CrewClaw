import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { addEvidence, assembleSources, loadEvidence, newEvidenceCard, verifySourceType } from "../evidence-store.mjs";

const root = join(os.tmpdir(), "crewclaw-evidence-store-test-" + process.pid + "-" + Date.now());

try {
  assert.equal(verifySourceType("https://duckduckgo.com/html/?q=x"), "search");
  assert.equal(verifySourceType("https://github.com/a/b"), "community");
  assert.equal(verifySourceType("https://www.volcengine.com/product/ark"), "official");

  const card = newEvidenceCard({
    field: "provider",
    value: "Volcengine Ark",
    sourceUrl: "https://www.volcengine.com/product/ark",
    confidence: "high",
  });
  assert.equal(card.field, "provider");
  assert.equal(card.source_type, "official");

  const added = addEvidence(root, "task/run:1", card);
  assert.equal(added.ok, true);
  assert.equal(added.count, 1);

  const loaded = loadEvidence(root, "task/run:1");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.cards.length, 1);

  const addedAgain = addEvidence(root, "task/run:1", card);
  assert.equal(addedAgain.ok, true);
  assert.equal(addedAgain.count, 1);

  const loadedAgain = loadEvidence(root, "task/run:1");
  assert.equal(loadedAgain.cards.length, 1);

  assert.deepEqual(
    assembleSources([{ source_url: "a" }, { source_url: "a" }, { source_url: "b" }]),
    ["a", "b"],
  );

  console.log("evidence-store.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
