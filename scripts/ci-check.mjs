import { spawnSync } from "node:child_process";

// pnpm exposes its JS entrypoint while executing package scripts. Re-enter it through Node instead
// of spawning `pnpm.cmd`, which is not directly executable by child_process on Windows.
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  console.error(
    "ci-check must be launched with `pnpm run ci:check` (npm_execpath is missing)."
  );
  process.exit(2);
}
const gates = [
  "format:check",
  "check",
  "lint",
  "schema:check",
  "test:unit",
  "test:runtime",
  "test:rust",
  "test:conformance",
  "validate:all-experts",
  "rust:fmt:check",
  "rust:clippy",
  "build",
];

for (const gate of gates) {
  console.log(`\n=== CI gate: pnpm run ${gate} ===`);
  const result = spawnSync(process.execPath, [pnpmCli, "run", gate], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`Unable to run ${gate}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("\nAll deterministic CI gates passed.");
