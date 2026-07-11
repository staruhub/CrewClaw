#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../../..");
const manifest = resolve(root, "crates/crewclaw-cli/Cargo.toml");
const targetRoot = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : resolve(root, "crates/crewclaw-cli/target");
const executableName =
  process.platform === "win32" ? "crewclaw-cli.exe" : "crewclaw-cli";
const releaseBinary = resolve(targetRoot, "release", executableName);
const debugBinary = resolve(targetRoot, "debug", executableName);
const binary = existsSync(releaseBinary)
  ? releaseBinary
  : existsSync(debugBinary)
    ? debugBinary
    : null;
const command = binary ?? "cargo";
const args = binary
  ? process.argv.slice(2)
  : [
      "run",
      "--quiet",
      "--manifest-path",
      manifest,
      "--",
      ...process.argv.slice(2),
    ];

const child = spawn(command, args, {
  cwd: root,
  env: {
    ...process.env,
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "0",
    CREWCLAW_ROOT: process.env.CREWCLAW_ROOT ?? root,
  },
  stdio: "inherit",
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

child.on("exit", (code, signal) => {
  if (signal === "SIGINT") {
    process.exit(130);
  }
  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error(`Error: ${error.message}`);
  process.exit(127);
});
