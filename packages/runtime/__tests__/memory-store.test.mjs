import assert from "node:assert/strict";
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
import {
  shouldRecord,
  addMemory,
  loadMemory,
  summarizeForPrompt,
} from "../memory-store.mjs";

const root = join(
  tmpdir(),
  "crewclaw-memory-store-test-" + process.pid + "-" + Date.now()
);

try {
  mkdirSync(root, { recursive: true });
  assert.equal(shouldRecord({ category: "project_facts", text: "x" }), true);
  assert.equal(
    shouldRecord({ category: "project_facts", text: "x", sensitive: true }),
    false
  );
  assert.equal(shouldRecord({ category: "nope", text: "x" }), false);
  assert.equal(
    shouldRecord({ category: "project_facts", text: "x", confidence: "low" }),
    false
  );

  const id = "employee:one";
  addMemory(root, id, { category: "project_facts", text: "fact A" });
  const loaded = loadMemory(root, id);
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].text, "fact A");

  const deduped = addMemory(root, id, {
    category: "project_facts",
    text: "fact A",
  });
  assert.equal(deduped.count, 1);
  assert.equal(deduped.skipped, true);

  const memoryPath = join(root, ".crewclaw", "memory", "employee_one.json");
  const memoryBeforeOversize = readFileSync(memoryPath, "utf8");
  const oversizedMemory = addMemory(root, id, {
    category: "project_facts",
    text: "x".repeat(9 * 1024 * 1024),
  });
  assert.equal(oversizedMemory.ok, false);
  assert.match(
    oversizedMemory.error,
    /state JSON exceeds 8388608-byte limit/,
    "a 9 MiB memory returns an explicit bounded-state failure"
  );
  assert.equal(
    readFileSync(memoryPath, "utf8"),
    memoryBeforeOversize,
    "an oversized memory update preserves the previous facts"
  );
  assert.equal(loadMemory(root, id).items.length, 1);

  const summary = summarizeForPrompt(loaded.items);
  assert.equal(typeof summary, "string");
  assert.equal(summary.includes("fact A"), true);

  const junctionRoot = mkdtempSync(join(tmpdir(), "crew-memory-junction-"));
  const junctionOutside = mkdtempSync(
    join(tmpdir(), "crew-memory-junction-outside-")
  );
  try {
    mkdirSync(join(junctionRoot, ".crewclaw"), { recursive: true });
    symlinkSync(
      junctionOutside,
      join(junctionRoot, ".crewclaw", "memory"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const escaped = addMemory(junctionRoot, "escaped", {
      category: "project_facts",
      text: "must stay inside",
    });
    assert.equal(escaped.ok, false);
    assert.equal(existsSync(join(junctionOutside, "escaped.json")), false);
  } finally {
    rmSync(junctionRoot, { recursive: true, force: true });
    rmSync(junctionOutside, { recursive: true, force: true });
  }

  const hardlinkRoot = mkdtempSync(join(tmpdir(), "crew-memory-hardlink-"));
  const hardlinkOutside = mkdtempSync(
    join(tmpdir(), "crew-memory-hardlink-outside-")
  );
  try {
    const dir = join(hardlinkRoot, ".crewclaw", "memory");
    const outsideFile = join(hardlinkOutside, "outside.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(outsideFile, "[]\n");
    linkSync(outsideFile, join(dir, "linked.json"));
    const linked = addMemory(hardlinkRoot, "linked", {
      category: "project_facts",
      text: "must not overwrite a hardlink",
    });
    assert.equal(linked.ok, false);
    assert.equal(
      readFileSync(outsideFile, "utf8"),
      "[]\n",
      "outside hardlink target remains unchanged"
    );
  } finally {
    rmSync(hardlinkRoot, { recursive: true, force: true });
    rmSync(hardlinkOutside, { recursive: true, force: true });
  }
} finally {
  rmSync(root, { force: true, recursive: true });
}
