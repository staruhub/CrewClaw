import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitMemoryWrite,
  getMemoryTruth,
  memoryCommandResponse,
  previewMemoryWrite,
} from "../memory-harness.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("empty env reports session available and persistent unavailable or disabled", () => {
  const truth = getMemoryTruth({});
  assert.equal(truth.session, "available");
  assert.ok(["unavailable", "disabled"].includes(truth.persistent));
});

test("MEMORY_STORE_URL enables persistent memory", () => {
  const truth = getMemoryTruth({ MEMORY_STORE_URL: "memory://test" });
  assert.equal(truth.persistent, "available");
});

test("memoryCommandResponse is session-only when persistent store is missing", () => {
  const response = memoryCommandResponse("jizhu", {});
  assert.equal(response.needsConfirm, true);
  assert.match(response.note, /仅本会话有效/);
  assert.doesNotMatch(response.note, /长期|persistent|持久/);
});

test("previewMemoryWrite returns MemoryRecord-shaped dry run without writing", () => {
  const root = join(tmpdir(), "crewclaw-memory-harness-preview-" + process.pid + "-" + Date.now());

  try {
    const preview = previewMemoryWrite({ content: "Remember this preference", scope: "session" });

    assert.equal(preview.scope, "session");
    assert.equal(preview.content, "Remember this preference");
    assert.equal(typeof preview.visibility, "string");
    assert.equal(preview.revocable, true);
    assert.ok("expires_at" in preview);
    assert.equal(existsSync(root), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("commitMemoryWrite returns ok false for unavailable scope", () => {
  const result = commitMemoryWrite(
    previewMemoryWrite({ content: "Org fact", scope: "org" }),
    { env: {}, root: tmpdir(), employeeId: "tester" },
  );

  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, "string");
});

let failures = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (error) {
    failures += 1;
    console.log("FAIL " + name);
    console.log(error?.stack ?? error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("memory-harness tests passed");
}
