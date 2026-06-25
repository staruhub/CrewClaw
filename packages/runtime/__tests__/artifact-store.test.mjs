import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { loadArtifact, markAccepted, newArtifact, saveArtifact } from "../artifact-store.mjs";

const root = join(os.tmpdir(), "crewclaw-artifact-store-test-" + process.pid + "-" + Date.now());

try {
  const a = newArtifact({ taskId: "task_1", title: "T", content: "# body" });
  assert.equal(a.accepted, false);
  assert.equal(a.status, "delivered");

  const saved = saveArtifact(root, a);
  assert.equal(saved.ok, true);

  const loaded = loadArtifact(root, a.id);
  assert.equal(loaded.artifact.title, "T");

  const accepted = markAccepted(root, a.id);
  assert.equal(accepted.artifact.accepted, true);

  const loadedAfterAccept = loadArtifact(root, a.id);
  assert.equal(loadedAfterAccept.artifact.status, "accepted");

  console.log("artifact-store.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
