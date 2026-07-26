import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNTIME_ENTRY, seedRuntimeTestTeam } from "./test-paths.mjs";

const ONE_MIB = 1024 * 1024;
const AGENT_ID = "ai-adoption-whale";

function fixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const root = join(base, "workspace");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  seedRuntimeTestTeam(root, [AGENT_ID]);
  return { base, root, outside };
}

function childEnv(root) {
  const env = {
    ...process.env,
    CREWCLAW_ROOT: root,
    CREW_MOCK: "1",
  };
  delete env.CREW_DISABLE_DOTENV;
  delete env.ZENMUX_API_KEY;
  delete env.ZENMUX_BASE_URL;
  delete env.HERMES_MODEL;
  return env;
}

function run(root, args) {
  return spawnSync(process.execPath, [RUNTIME_ENTRY, AGENT_ID, ...args], {
    cwd: root,
    env: childEnv(root),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function outputOf(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function assertUnsafe(result, expectedMessage, secret) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, outputOf(result));
  assert.match(result.stderr, expectedMessage);
  if (secret) assert.equal(outputOf(result).includes(secret), false);
}

function writeRegularEnv(root) {
  writeFileSync(
    join(root, ".env.local"),
    "ZENMUX_API_KEY=runtime-boundary-test-key\n"
  );
}

function regularDotenvAndInputRemainUsable() {
  const { base, root } = fixture("crew-runtime-input-regular-");
  try {
    writeRegularEnv(root);
    writeFileSync(join(root, "i"), "NORMAL_INPUT_MARKER\n");
    const result = run(root, ["--input", "i", "--json"]);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, outputOf(result));
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.agent, AGENT_ID);
    assert.match(parsed.content, /NORMAL_INPUT_MARKER/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function rejectsUnsafeDotenvEntries() {
  {
    const { base, root, outside } = fixture("crew-runtime-env-junction-");
    try {
      writeFileSync(join(outside, "secret.txt"), "DOTENV_JUNCTION_SECRET");
      symlinkSync(
        outside,
        join(root, ".env.local"),
        process.platform === "win32" ? "junction" : "dir"
      );
      assertUnsafe(
        run(root, ["task", "--json"]),
        /refusing unsafe \.env\.local/,
        "DOTENV_JUNCTION_SECRET"
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  {
    const { base, root, outside } = fixture("crew-runtime-env-hardlink-");
    try {
      const source = join(outside, "source.env");
      writeFileSync(source, "ZENMUX_API_KEY=DOTENV_HARDLINK_SECRET\n");
      linkSync(source, join(root, ".env.local"));
      assertUnsafe(
        run(root, ["task", "--json"]),
        /refusing unsafe \.env\.local/,
        "DOTENV_HARDLINK_SECRET"
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  {
    const { base, root } = fixture("crew-runtime-env-oversize-");
    try {
      writeFileSync(join(root, ".env.local"), Buffer.alloc(ONE_MIB + 1, 65));
      assertUnsafe(
        run(root, ["task", "--json"]),
        /refusing unsafe \.env\.local/
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
}

function rejectsOutsideInputWithoutExistenceOrContentDisclosure() {
  const { base, root, outside } = fixture("crew-runtime-input-outside-");
  try {
    writeRegularEnv(root);
    const secret = "OUTSIDE_INPUT_SECRET";
    const outsideFile = join(outside, "outside.txt");
    writeFileSync(outsideFile, secret);

    const traversalExisting = run(root, [
      "--input",
      "../outside/outside.txt",
      "--json",
    ]);
    const traversalMissing = run(root, [
      "--input",
      "../outside/missing.txt",
      "--json",
    ]);
    assertUnsafe(traversalExisting, /refusing unsafe --input file/, secret);
    assertUnsafe(traversalMissing, /refusing unsafe --input file/);
    assert.equal(traversalExisting.stderr, traversalMissing.stderr);

    const absoluteExisting = run(root, ["--input", outsideFile, "--json"]);
    const absoluteMissing = run(root, [
      "--input",
      join(outside, "missing-absolute.txt"),
      "--json",
    ]);
    assertUnsafe(absoluteExisting, /refusing unsafe --input file/, secret);
    assertUnsafe(absoluteMissing, /refusing unsafe --input file/);
    assert.equal(absoluteExisting.stderr, absoluteMissing.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function rejectsLinkedAndOversizedInput() {
  {
    const { base, root, outside } = fixture("crew-runtime-input-junction-");
    try {
      writeRegularEnv(root);
      const secret = "JUNCTION_INPUT_SECRET";
      writeFileSync(join(outside, "input.txt"), secret);
      symlinkSync(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir"
      );
      assertUnsafe(
        run(root, ["--input", "linked/input.txt", "--json"]),
        /refusing unsafe --input file/,
        secret
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  {
    const { base, root, outside } = fixture("crew-runtime-input-hardlink-");
    try {
      writeRegularEnv(root);
      const secret = "HARDLINK_INPUT_SECRET";
      const source = join(outside, "source.txt");
      writeFileSync(source, secret);
      linkSync(source, join(root, "linked.txt"));
      assertUnsafe(
        run(root, ["--input", "linked.txt", "--json"]),
        /refusing unsafe --input file/,
        secret
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  {
    const { base, root } = fixture("crew-runtime-input-oversize-");
    try {
      writeRegularEnv(root);
      writeFileSync(join(root, "large.txt"), Buffer.alloc(ONE_MIB + 1, 66));
      assertUnsafe(
        run(root, ["--input", "large.txt", "--json"]),
        /refusing unsafe --input file/
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
}

regularDotenvAndInputRemainUsable();
rejectsUnsafeDotenvEntries();
rejectsOutsideInputWithoutExistenceOrContentDisclosure();
rejectsLinkedAndOversizedInput();
console.log("runtime-input-boundary.test.mjs passed");
