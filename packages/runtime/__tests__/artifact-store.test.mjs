import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  loadArtifact,
  markAccepted,
  newArtifact,
  saveArtifact,
} from "../artifact-store.mjs";

const root = join(
  os.tmpdir(),
  "crewclaw-artifact-store-test-" + process.pid + "-" + Date.now()
);
const linkedRoot = mkdtempSync(
  join(os.tmpdir(), "crewclaw-artifact-store-link-")
);
const outside = mkdtempSync(
  join(os.tmpdir(), "crewclaw-artifact-store-outside-")
);

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
  assert.equal(
    readdirSync(join(root, ".crewclaw", "artifacts")).some(file =>
      file.includes(".tmp-")
    ),
    false,
    "artifact store leaves no partial temp files"
  );

  const partial = newArtifact({
    taskId: "task_partial",
    title: "Partial",
    content: "must be rolled back",
  });
  mkdirSync(join(root, ".crewclaw", "artifacts", `${partial.id}.json`), {
    recursive: true,
  });
  const partialResult = saveArtifact(root, partial);
  assert.equal(partialResult.ok, false);
  assert.equal(
    readdirSync(join(root, ".crewclaw", "artifacts")).includes(
      `${partial.id}.md`
    ),
    false,
    "metadata failure rolls back the published Markdown half"
  );

  mkdirSync(join(linkedRoot, ".crewclaw"), { recursive: true });
  writeFileSync(join(outside, "sentinel.txt"), "outside stays unchanged");
  symlinkSync(
    outside,
    join(linkedRoot, ".crewclaw", "artifacts"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const escaped = newArtifact({
    taskId: "task_escape",
    title: "Escape",
    content: "must not be written",
  });
  const rejected = saveArtifact(linkedRoot, escaped);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "artifact_link_component");
  assert.deepEqual(readdirSync(outside), ["sentinel.txt"]);
  assert.equal(
    loadArtifact(linkedRoot, escaped.id).code,
    "artifact_link_component"
  );

  console.log("artifact-store.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(linkedRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
