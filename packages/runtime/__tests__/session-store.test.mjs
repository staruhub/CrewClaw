import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sanitizeForSave,
  saveSession,
  loadSession,
} from "../session-store.mjs";

const history = [
  { role: "user", content: "q1" },
  {
    role: "user",
    content: [
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "data:abc" } },
    ],
  },
  { role: "assistant", content: "答1" },
  { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
  { role: "tool", tool_call_id: "c1", content: "ls 输出" },
];

const WORKER = fileURLToPath(
  new URL("./fixtures/state-store-worker.mjs", import.meta.url)
);

function runSessionWorker(root, agentId, workerHistory) {
  const payload = Buffer.from(JSON.stringify(workerHistory)).toString(
    "base64url"
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WORKER, "session", root, agentId, payload],
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

function assertSanitizeForSave() {
  const out = sanitizeForSave(history);

  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { role: "user", content: "q1" });
  assert.equal(out[1].role, "user");
  assert.ok(out[1].content.includes("看图"));
  assert.ok(out[1].content.includes("省略"));
  assert.ok(out[1].content.includes("图片"));
  assert.deepEqual(out[2], { role: "assistant", content: "答1" });
  assert.equal(
    out.some(item => item.role === "tool"),
    false
  );
  assert.equal(
    out.some(item => Object.hasOwn(item, "tool_calls")),
    false
  );
}

async function assertSaveLoadRoundTrip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-test-"));
  const agentId = `test-agent-${process.pid}`;

  try {
    const saved = saveSession(root, agentId, history);
    assert.equal(saved.ok, true);
    assert.equal(saved.count, 3);

    const loaded = loadSession(root, agentId);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.messages, sanitizeForSave(history));
    assert.equal(typeof loaded.savedAt, "string");

    const sessionPath = path.join(root, ".sessions", `${agentId}.json`);
    const sessionBeforeOversize = fs.readFileSync(sessionPath, "utf8");
    const oversizedSession = saveSession(root, agentId, [
      { role: "user", content: "x".repeat(9 * 1024 * 1024) },
    ]);
    assert.equal(oversizedSession.ok, false);
    assert.match(
      oversizedSession.error,
      /state JSON exceeds 8388608-byte limit/,
      "a 9 MiB session returns an explicit bounded-state failure"
    );
    assert.equal(
      fs.readFileSync(sessionPath, "utf8"),
      sessionBeforeOversize,
      "an oversized session save preserves the previous transcript"
    );
    assert.deepEqual(loadSession(root, agentId).messages, loaded.messages);

    const missing = loadSession(root, `missing-agent-xyz-${process.pid}`);
    assert.equal(missing.ok, false);
    assert.equal(
      saveSession(root, "../aliased-agent", history).ok,
      false,
      "unsafe agent ids cannot alias a session filename"
    );
    assert.equal(loadSession(root, "../aliased-agent").ok, false);

    const corruptPath = path.join(root, ".sessions", "corrupt-agent.json");
    fs.writeFileSync(
      corruptPath,
      JSON.stringify({
        agentId: "corrupt-agent",
        savedAt: new Date().toISOString(),
        messages: [{ role: "tool", content: "untrusted tool transcript" }],
      })
    );
    assert.equal(
      loadSession(root, "corrupt-agent").ok,
      false,
      "structurally invalid session state fails closed"
    );

    const parallelAgent = "parallel-agent";
    const snapshots = Array.from({ length: 12 }, (_, index) => [
      { role: "user", content: `question-${index}` },
      { role: "assistant", content: `answer-${index}` },
    ]);
    const results = await Promise.all(
      snapshots.map(snapshot => runSessionWorker(root, parallelAgent, snapshot))
    );
    assert.equal(
      results.every(result => result.ok),
      true
    );
    const parallel = loadSession(root, parallelAgent);
    assert.equal(parallel.ok, true);
    assert.ok(
      snapshots.some(
        snapshot =>
          JSON.stringify(sanitizeForSave(snapshot)) ===
          JSON.stringify(parallel.messages)
      ),
      "parallel whole-session saves never expose a torn or mixed JSON snapshot"
    );

    const junctionRoot = path.join(root, "junction-root");
    const outsideSessions = path.join(root, "outside-sessions");
    fs.mkdirSync(junctionRoot);
    fs.mkdirSync(outsideSessions);
    fs.symlinkSync(
      outsideSessions,
      path.join(junctionRoot, ".sessions"),
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.equal(saveSession(junctionRoot, "escape", history).ok, false);
    assert.equal(loadSession(junctionRoot, "escape").ok, false);
    assert.deepEqual(fs.readdirSync(outsideSessions), []);

    const hardRoot = path.join(root, "hardlink-root");
    const hardDir = path.join(hardRoot, ".sessions");
    fs.mkdirSync(hardDir, { recursive: true });
    const outsideSession = path.join(root, "outside-session.json");
    const hardSession = path.join(hardDir, "linked-agent.json");
    fs.writeFileSync(
      outsideSession,
      JSON.stringify({ messages: [{ role: "user", content: "outside" }] })
    );
    fs.linkSync(outsideSession, hardSession);
    const outsideBefore = fs.readFileSync(outsideSession, "utf8");
    assert.equal(loadSession(hardRoot, "linked-agent").ok, false);
    assert.equal(saveSession(hardRoot, "linked-agent", history).ok, false);
    assert.equal(fs.readFileSync(outsideSession, "utf8"), outsideBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assertSanitizeForSave();
await assertSaveLoadRoundTrip();
console.log("session-store.test.mjs passed");
