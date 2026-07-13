import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import {
  addEvidence,
  assembleSources,
  loadEvidence,
  newEvidenceCard,
  verifySourceType,
} from "../evidence-store.mjs";

const WORKER = fileURLToPath(
  new URL("./fixtures/state-store-worker.mjs", import.meta.url)
);

function runWorker(root, id) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, "evidence", root, id], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.once("error", reject);
    child.once("close", code => {
      if (code !== 0) return reject(new Error(stderr || `worker exit ${code}`));
      resolve(JSON.parse(stdout));
    });
  });
}

const root = mkdtempSync(join(os.tmpdir(), "crewclaw-evidence-store-test-"));

try {
  assert.equal(verifySourceType("https://duckduckgo.com/html/?q=x"), "search");
  assert.equal(verifySourceType("https://github.com/a/b"), "community");
  assert.equal(
    verifySourceType("https://www.volcengine.com/product/ark"),
    "unknown",
    "an arbitrary public URL is not promoted to official without employee/task context"
  );
  assert.equal(
    verifySourceType("https://www.volcengine.com/product/ark", {
      officialDomains: ["volcengine.com"],
    }),
    "official"
  );
  assert.equal(
    verifySourceType("https://docs.volcengine.com/ark", {
      officialDomains: ["https://volcengine.com"],
    }),
    "official",
    "an explicitly declared official domain wins over a generic docs heuristic"
  );
  assert.equal(
    verifySourceType("https://evilvolcengine.com/product/ark", {
      officialDomains: ["volcengine.com"],
    }),
    "unknown",
    "official-domain matching is hostname-boundary safe"
  );

  const card = newEvidenceCard({
    field: "provider",
    value: "Volcengine Ark",
    sourceUrl: "https://www.volcengine.com/product/ark",
    officialDomains: ["volcengine.com"],
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

  const evidencePath = join(
    root,
    ".crewclaw",
    "runs",
    "task_run_1.evidence.json"
  );
  const evidenceBeforeOversize = readFileSync(evidencePath, "utf8");
  const oversizedEvidence = addEvidence(root, "task/run:1", {
    field: "oversized",
    value: "x".repeat(9 * 1024 * 1024),
    source_url: "https://example.com/oversized",
  });
  assert.equal(oversizedEvidence.ok, false);
  assert.match(
    oversizedEvidence.error,
    /state JSON exceeds 8388608-byte limit/,
    "a 9 MiB evidence update returns an explicit bounded-state failure"
  );
  assert.equal(
    readFileSync(evidencePath, "utf8"),
    evidenceBeforeOversize,
    "an oversized evidence update preserves the previous document"
  );
  assert.equal(loadEvidence(root, "task/run:1").cards.length, 1);

  assert.deepEqual(
    assembleSources([
      { source_url: "a" },
      { source_url: "a" },
      { source_url: "b" },
    ]),
    ["a", "b"]
  );

  const parallelRoot = join(root, "parallel-root");
  mkdirSync(parallelRoot);
  const workerResults = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      runWorker(parallelRoot, String(index))
    )
  );
  assert.equal(
    workerResults.every(result => result.ok),
    true,
    "all cross-process evidence updates persist"
  );
  const parallel = loadEvidence(parallelRoot, "concurrent-task");
  assert.equal(parallel.ok, true);
  assert.equal(parallel.cards.length, 16, "parallel additions lose no cards");
  assert.equal(new Set(parallel.cards.map(item => item.field)).size, 16);

  const malformedRoot = join(root, "malformed-root");
  const malformedRuns = join(malformedRoot, ".crewclaw", "runs");
  const malformedPath = join(malformedRuns, "malformed-task.evidence.json");
  mkdirSync(malformedRuns, { recursive: true });
  writeFileSync(malformedPath, '{"cards":[]}', "utf8");
  assert.equal(
    loadEvidence(malformedRoot, "malformed-task").ok,
    false,
    "a structurally invalid evidence document fails closed"
  );
  assert.equal(
    addEvidence(malformedRoot, "malformed-task", card).ok,
    false,
    "an update cannot erase malformed existing evidence"
  );
  assert.equal(readFileSync(malformedPath, "utf8"), '{"cards":[]}');

  const junctionRoot = join(root, "junction-root");
  const outsideRuns = join(root, "outside-runs");
  mkdirSync(join(junctionRoot, ".crewclaw"), { recursive: true });
  mkdirSync(outsideRuns);
  symlinkSync(
    outsideRuns,
    join(junctionRoot, ".crewclaw", "runs"),
    process.platform === "win32" ? "junction" : "dir"
  );
  assert.equal(
    addEvidence(junctionRoot, "escape", card).ok,
    false,
    "runs parent junction is rejected"
  );
  assert.deepEqual(readdirSync(outsideRuns), []);
  assert.equal(
    loadEvidence(junctionRoot, "escape").ok,
    false,
    "junction-backed evidence cannot be read"
  );

  const hardRoot = join(root, "hardlink-root");
  const hardRuns = join(hardRoot, ".crewclaw", "runs");
  mkdirSync(hardRuns, { recursive: true });
  const outsideEvidence = join(root, "outside-evidence.json");
  const hardEvidence = join(hardRuns, "hard-task.evidence.json");
  writeFileSync(outsideEvidence, "[]\n", "utf8");
  linkSync(outsideEvidence, hardEvidence);
  assert.equal(
    loadEvidence(hardRoot, "hard-task").ok,
    false,
    "final hardlink is rejected on read"
  );
  assert.equal(
    addEvidence(hardRoot, "hard-task", card).ok,
    false,
    "final hardlink is rejected on update"
  );
  assert.equal(readFileSync(outsideEvidence, "utf8"), "[]\n");

  console.log("evidence-store.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
