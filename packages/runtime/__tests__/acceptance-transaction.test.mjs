import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureArtifactFingerprint,
  persistProofPackDurably,
  verifyArtifactFingerprint,
  writeJsonDurably,
} from "../acceptance-transaction.mjs";
import { MAX_STATE_FILE_BYTES } from "../state-lock.mjs";

const WORKER = fileURLToPath(
  new URL("./fixtures/state-store-worker.mjs", import.meta.url)
);

function runProofPackWorker(root, taskRunId, pack) {
  const payload = Buffer.from(JSON.stringify(pack)).toString("base64url");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WORKER, "proofpack", root, taskRunId, payload],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
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

const root = mkdtempSync(join(tmpdir(), "crewclaw-acceptance-tx-"));
try {
  const artifactPath = join(root, "artifact.md");
  writeFileSync(artifactPath, "# immutable review bytes\n");
  const fingerprint = captureArtifactFingerprint(artifactPath);
  assert.equal(fingerprint.ok, true);
  assert.match(fingerprint.sha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyArtifactFingerprint(fingerprint).ok, true);

  writeFileSync(artifactPath, "# changed after review\n");
  const changed = verifyArtifactFingerprint(fingerprint);
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "artifact_changed");

  const pack = { task_run_id: "task-1", artifacts: [{ path: artifactPath }] };
  const persisted = persistProofPackDurably({
    root,
    taskRunId: "task-1",
    pack,
  });
  assert.equal(persisted.ok, true);
  assert.deepEqual(JSON.parse(readFileSync(persisted.path, "utf8")), pack);
  assert.equal(
    persistProofPackDurably({ root, taskRunId: "task-1", pack }).existing,
    true,
    "recovery may retry the exact same durable ProofPack"
  );
  assert.equal(
    persistProofPackDurably({
      root,
      taskRunId: "task-1",
      pack: { ...pack, changed: true },
    }).code,
    "proofpack_conflict",
    "an existing acceptance receipt is immutable"
  );
  assert.equal(
    persistProofPackDurably({
      root,
      taskRunId: "../task-aliased",
      pack: { task_run_id: "../task-aliased" },
    }).code,
    "proofpack_invalid",
    "unsafe task ids cannot alias a sanitized ProofPack filename"
  );
  assert.equal(
    existsSync(
      join(root, ".crewclaw", "runs", "___task-aliased.proofpack.json")
    ),
    false
  );

  const escapeRoot = join(root, "escape-workspace");
  const outside = join(root, "outside-runs");
  mkdirSync(join(escapeRoot, ".crewclaw"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(
    outside,
    join(escapeRoot, ".crewclaw", "runs"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const escaped = persistProofPackDurably({
    root: escapeRoot,
    taskRunId: "task-escape",
    pack: { task_run_id: "task-escape" },
  });
  assert.equal(escaped.ok, false, "runs junction must fail closed");
  assert.equal(
    existsSync(join(outside, "task-escape.proofpack.json")),
    false,
    "ProofPack is never written outside the workspace"
  );

  const hardRoot = join(root, "hardlink-workspace");
  const hardRuns = join(hardRoot, ".crewclaw", "runs");
  mkdirSync(hardRuns, { recursive: true });
  const outsidePack = join(root, "outside-proofpack.json");
  const hardPack = join(hardRuns, "task-hard.proofpack.json");
  writeFileSync(outsidePack, '{"outside":true}\n');
  linkSync(outsidePack, hardPack);
  const outsideBefore = readFileSync(outsidePack, "utf8");
  assert.equal(
    persistProofPackDurably({
      root: hardRoot,
      taskRunId: "task-hard",
      pack: { task_run_id: "task-hard" },
    }).ok,
    false,
    "final ProofPack hardlink is rejected"
  );
  assert.equal(readFileSync(outsidePack, "utf8"), outsideBefore);

  const parallelRoot = join(root, "parallel-workspace");
  mkdirSync(parallelRoot);
  const parallelPack = {
    task_run_id: "task-parallel",
    approval: { decision: "accept", at: 1 },
  };
  const parallelResults = await Promise.all(
    Array.from({ length: 12 }, () =>
      runProofPackWorker(parallelRoot, "task-parallel", parallelPack)
    )
  );
  assert.equal(
    parallelResults.every(result => result.ok),
    true,
    "idempotent parallel writers all observe one durable ProofPack"
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(parallelRoot, ".crewclaw", "runs", "task-parallel.proofpack.json"),
        "utf8"
      )
    ),
    parallelPack
  );

  const conflicting = await Promise.all([
    runProofPackWorker(parallelRoot, "task-conflict", {
      task_run_id: "task-conflict",
      winner: "left",
    }),
    runProofPackWorker(parallelRoot, "task-conflict", {
      task_run_id: "task-conflict",
      winner: "right",
    }),
  ]);
  assert.equal(conflicting.filter(result => result.ok).length, 1);
  assert.equal(
    conflicting.filter(result => result.code === "proofpack_conflict").length,
    1,
    "a conflicting parallel receipt never overwrites the winner"
  );

  const oversizedValue = { padding: "x".repeat(MAX_STATE_FILE_BYTES) };
  const existingOversizedTarget = join(root, "oversized-existing.json");
  writeFileSync(existingOversizedTarget, '{"trusted":true}', "utf8");
  const oversizedExisting = writeJsonDurably(
    existingOversizedTarget,
    oversizedValue,
    { root }
  );
  assert.equal(oversizedExisting.code, "durable_write_too_large");
  assert.equal(
    readFileSync(existingOversizedTarget, "utf8"),
    '{"trusted":true}',
    "an oversized durable write cannot replace an existing final file"
  );

  const oversizedPackPath = join(
    root,
    ".crewclaw",
    "runs",
    "task-oversized.proofpack.json"
  );
  const oversizedPack = persistProofPackDurably({
    root,
    taskRunId: "task-oversized",
    pack: { task_run_id: "task-oversized", ...oversizedValue },
  });
  assert.equal(oversizedPack.code, "proofpack_not_persisted");
  assert.equal(
    existsSync(oversizedPackPath),
    false,
    "an oversized ProofPack leaves no unreadable final file"
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("acceptance-transaction tests passed");
