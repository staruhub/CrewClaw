import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readKpi, recordTaskOutcome } from "../kpi.mjs";
import { loadMemory } from "../memory-store.mjs";
import { readSpend } from "../spend.mjs";
import {
  classifyStateLockEntry,
  MAX_STATE_FILE_BYTES,
  withStateLock,
  writeJsonAtomic,
  writeStateFileAtomic,
} from "../state-lock.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const kpiUrl = pathToFileURL(resolve(here, "../kpi.mjs")).href;
const spendUrl = pathToFileURL(resolve(here, "../spend.mjs")).href;
const memoryUrl = pathToFileURL(resolve(here, "../memory-store.mjs")).href;
const root = mkdtempSync(join(tmpdir(), "crew-state-lock-"));

function child(code, args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, ...args],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stderr = "";
    proc.stderr.on("data", chunk => {
      stderr += chunk;
    });
    proc.on("error", reject);
    proc.on("close", status => {
      if (status === 0) resolvePromise();
      else reject(new Error(`child exited ${status}: ${stderr}`));
    });
  });
}

try {
  const lockEntry = ({ nlink, file = true, symlink = false }) => ({
    nlink,
    isFile: () => file,
    isSymbolicLink: () => symlink,
  });
  assert.equal(classifyStateLockEntry(lockEntry({ nlink: 1 })), "active");
  assert.equal(
    classifyStateLockEntry(lockEntry({ nlink: 0 })),
    "delete-pending",
    "Windows delete-pending locks must be retried as contention"
  );
  for (const unsafe of [
    lockEntry({ nlink: 2 }),
    lockEntry({ nlink: -1 }),
    lockEntry({ nlink: 1, file: false }),
    lockEntry({ nlink: 1, symlink: true }),
  ]) {
    assert.equal(classifyStateLockEntry(unsafe), "unsafe");
  }

  const ownershipLock = join(root, ".crewclaw", "ownership.lock");
  withStateLock(
    ownershipLock,
    () => {
      assert.throws(
        () =>
          withStateLock(ownershipLock, () => null, {
            root,
            timeoutMs: 35,
            staleMs: 1,
          }),
        /state lock timeout/,
        "a live owner must not be stolen merely because its lock is old"
      );
    },
    { root, staleMs: 1 }
  );
  assert.equal(
    withStateLock(ownershipLock, () => "reacquired", { root }),
    "reacquired",
    "the owner removes its own lock on release"
  );

  mkdirSync(dirname(ownershipLock), { recursive: true });
  writeFileSync(
    ownershipLock,
    `${JSON.stringify({ token: "dead-owner", pid: 2_147_483_647 })}\n`
  );
  utimesSync(ownershipLock, new Date(0), new Date(0));
  assert.equal(
    withStateLock(ownershipLock, () => "recovered", {
      root,
      staleMs: 1,
    }),
    "recovered",
    "a stale lock whose process no longer exists is reclaimed"
  );

  const atomicFile = join(root, ".crewclaw", "atomic.json");
  writeJsonAtomic(atomicFile, { generation: "old" }, { root });
  const oldState = readFileSync(atomicFile, "utf8");
  assert.throws(
    () =>
      writeJsonAtomic(
        atomicFile,
        { payload: "x".repeat(9 * 1024 * 1024) },
        { root }
      ),
    new RegExp(`exceeds ${MAX_STATE_FILE_BYTES}-byte limit`),
    "oversized JSON must fail before replacing a readable old state"
  );
  assert.equal(readFileSync(atomicFile, "utf8"), oldState);

  if (process.platform === "win32") {
    chmodSync(atomicFile, 0o444);
    assert.throws(
      () => writeJsonAtomic(atomicFile, { generation: "new" }, { root }),
      /atomic state replace failed; existing state was preserved/,
      "a Windows replace failure must not fall back to truncating the old file"
    );
    assert.equal(readFileSync(atomicFile, "utf8"), oldState);
    chmodSync(atomicFile, 0o600);
  } else {
    assert.equal(
      statSync(atomicFile).mode & 0o777,
      0o600,
      "new atomic state files use owner-only permissions"
    );
  }
  assert.equal(
    readdirSync(dirname(atomicFile)).some(name => name.endsWith(".tmp")),
    false,
    "atomic writes clean every same-directory temporary file"
  );
  writeJsonAtomic(atomicFile, { generation: "new" }, { root });
  assert.deepEqual(JSON.parse(readFileSync(atomicFile, "utf8")), {
    generation: "new",
  });

  const reportFile = join(root, ".crewclaw", "runs", "atomic.report.md");
  writeStateFileAtomic(reportFile, "# durable report\n", { root });
  const oldReport = readFileSync(reportFile, "utf8");
  assert.equal(oldReport, "# durable report\n");
  assert.throws(
    () =>
      writeStateFileAtomic(reportFile, Buffer.alloc(9 * 1024 * 1024), {
        root,
      }),
    /state file is empty or exceeds 8388608-byte limit/,
    "the reusable byte writer enforces the same limit as guarded reads"
  );
  assert.equal(
    readFileSync(reportFile, "utf8"),
    oldReport,
    "an oversized report cannot replace the prior artifact"
  );

  const count = 16;
  await Promise.all(
    Array.from({ length: count }, () =>
      child(
        `const {recordTaskOutcome}=await import(${JSON.stringify(kpiUrl)});` +
          "if(!recordTaskOutcome(process.argv[1],'parallel',{accepted:true,cost:0.25}))process.exit(2);",
        [root]
      )
    )
  );
  const kpi = readKpi(root, "parallel");
  assert.equal(
    kpi.tasks,
    count,
    "parallel KPI writers must not lose task increments"
  );
  assert.equal(
    kpi.accepted,
    count,
    "parallel KPI writers must not lose accepted increments"
  );
  assert.equal(kpi.total_cost, count * 0.25);

  await Promise.all(
    Array.from({ length: count }, () =>
      child(
        `const {recordSpend}=await import(${JSON.stringify(spendUrl)});` +
          "const r=recordSpend(process.argv[1],3,0.25,'2099-01');" +
          "if(!r.persisted){console.error(r.error);process.exit(2);}",
        [root]
      )
    )
  );
  assert.equal(
    readSpend(root, "2099-01").total,
    count * 0.25,
    "parallel spend writers must not lose increments"
  );

  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      child(
        `const {addMemory}=await import(${JSON.stringify(memoryUrl)});` +
          "const r=addMemory(process.argv[1],'parallel',{category:'project_facts',text:process.argv[2]});" +
          "if(!r.ok){console.error(r.error);process.exit(2);}",
        [root, `parallel fact ${index}`]
      )
    )
  );
  assert.equal(
    loadMemory(root, "parallel").items.length,
    count,
    "parallel memory writers must not lose distinct accepted facts"
  );

  const escapeRoot = mkdtempSync(join(tmpdir(), "crew-state-escape-"));
  const outside = mkdtempSync(join(tmpdir(), "crew-state-outside-"));
  mkdirSync(join(escapeRoot, ".crewclaw"), { recursive: true });
  symlinkSync(
    outside,
    join(escapeRoot, ".crewclaw", "kpi"),
    process.platform === "win32" ? "junction" : "dir"
  );
  assert.equal(
    recordTaskOutcome(escapeRoot, "escaped", {
      accepted: true,
      cost: 1,
    }),
    null,
    "state writers reject a KPI directory junction outside the workspace"
  );
  assert.equal(
    existsSync(join(outside, "escaped.json")),
    false,
    "no state file is created through the junction"
  );
  rmSync(escapeRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
} finally {
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 50,
    retryDelay: 50,
  });
}

console.log("state-lock.test.mjs passed");
