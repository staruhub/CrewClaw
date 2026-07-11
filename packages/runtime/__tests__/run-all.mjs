// Deterministic runtime gate. Every *.test.mjs and every *-smoke.mjs is included unless a test is
// explicitly classified as machine-dependent in runtime-test-manifest.mjs. Portable deterministic
// e2e scripts are listed there too, so changing a suffix cannot silently turn a test green.

import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETERMINISTIC_E2E,
  LIVE_TESTS,
  validateRuntimeTestInventory,
} from "./runtime-test-manifest.mjs";
import { runRuntimeScripts } from "./runtime-test-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const inventory = readdirSync(here)
  .filter(file => file.endsWith(".mjs"))
  .sort();
const liveNames = new Set(LIVE_TESTS.map(test => test.file));
const files = [
  ...inventory.filter(
    file =>
      (file.endsWith(".test.mjs") || file.endsWith("-smoke.mjs")) &&
      !liveNames.has(file)
  ),
  ...DETERMINISTIC_E2E,
]
  .filter((file, index, all) => all.indexOf(file) === index)
  .sort();

validateRuntimeTestInventory(inventory, files);

console.log(
  `Runtime deterministic gate: ${files.length} scripts; ${LIVE_TESTS.length} machine/live scripts are NOT executed here.`
);
console.log("Live prerequisites: pnpm run test:runtime:live:list");

const result = runRuntimeScripts(files, {
  directory: here,
  env: { ...process.env, CREW_MOCK: "1" },
  envForFile(file, baseEnv) {
    if (!DETERMINISTIC_E2E.includes(file)) return baseEnv;
    // These scripts own their deterministic mock server or contain no model call. CREW_MOCK would
    // replace their scenario response and make the test assert against unrelated canned output.
    const isolated = { ...baseEnv };
    delete isolated.CREW_MOCK;
    return isolated;
  },
  label: "Runtime deterministic tests",
});
process.exit(result.ok ? 0 : 1);
