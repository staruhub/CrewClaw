import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_TESTS } from "./runtime-test-manifest.mjs";
import { runRuntimeScripts } from "./runtime-test-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function printPrerequisites() {
  console.log(
    "Runtime live/machine test inventory (NOT executed by deterministic CI):"
  );
  for (const test of LIVE_TESTS)
    console.log(
      `- ${test.file}: ${test.requires}${test.env?.length ? `; env=${test.env.join(",")}` : ""}`
    );
  console.log("\nExecution prerequisites:");
  console.log(
    "- declared public fixture URLs must resolve only to public addresses"
  );
  console.log(
    "- loopback mock-model ports and child processes must be allowed"
  );
  console.log(
    "- set CREW_RUNTIME_LIVE=1 to acknowledge these non-hermetic requirements"
  );
  console.log(
    "Missing prerequisites are an error, never a skipped/pass result."
  );
}

printPrerequisites();
for (const test of LIVE_TESTS) {
  if (!existsSync(resolve(here, test.file))) {
    console.error(`Live test is missing: ${test.file}`);
    process.exit(2);
  }
}
if (process.argv.includes("--list")) process.exit(0);
if (process.env.CREW_RUNTIME_LIVE !== "1") {
  console.error(
    "\nRefusing to run: set CREW_RUNTIME_LIVE=1 after verifying the prerequisites above."
  );
  process.exit(2);
}
for (const test of LIVE_TESTS) {
  for (const name of test.env || []) {
    if (!process.env[name]) {
      console.error(
        `\nLive prerequisite not met for ${test.file}: ${name} is missing.`
      );
      process.exit(2);
    }
  }
}

const result = runRuntimeScripts(
  LIVE_TESTS.map(test => test.file),
  {
    directory: here,
    env: process.env,
    label: "Runtime live/machine tests",
  }
);
process.exit(result.ok ? 0 : 1);
