export const DETERMINISTIC_E2E = [
  "e2e-gateway.mjs",
  "e2e-permission.mjs",
  "e2e-preflight.mjs",
  "e2e-render-provider.mjs",
  "e2e-render.mjs",
  "e2e-serp.mjs",
  "e2e-task.mjs",
  "e2e-tools.mjs",
  "e2e-vterm-stream.mjs",
];

// Browser-safe web_fetch intentionally cannot reach a loopback fixture. These two full-process JS
// shell scenarios therefore require an operator-controlled PUBLIC fixture URL. They are not skips
// and are never counted as passes; run-live refuses to execute without the explicit environment.
export const LIVE_TESTS = [
  {
    file: "e2e-budget.mjs",
    requires:
      "public JS-shell fixture + loopback mock-model port + child processes",
    env: ["CREW_LIVE_JS_SHELL_URL"],
  },
  {
    file: "e2e-jsshell.mjs",
    requires:
      "public JS-shell fixture + loopback mock-model port + child processes",
    env: ["CREW_LIVE_JS_SHELL_URL"],
  },
];

const INFRASTRUCTURE = new Set([
  "mock-model.mjs",
  "run-all.mjs",
  "run-live.mjs",
  "runtime-test-manifest.mjs",
  "runtime-test-runner.mjs",
  "test-paths.mjs",
  "vterm.mjs",
]);

export function validateRuntimeTestInventory(inventory, deterministicFiles) {
  const inventorySet = new Set(inventory);
  const deterministic = new Set(deterministicFiles);
  const live = new Set(LIVE_TESTS.map(test => test.file));
  const errors = [];

  for (const file of [...deterministic, ...live]) {
    if (!inventorySet.has(file))
      errors.push(`classified test does not exist: ${file}`);
  }
  for (const file of inventory.filter(name => name.endsWith("-smoke.mjs"))) {
    if (!deterministic.has(file))
      errors.push(`smoke test is not in the deterministic gate: ${file}`);
  }
  for (const file of inventory.filter(
    name => name.startsWith("e2e-") && name.endsWith(".mjs")
  )) {
    if (!deterministic.has(file) && !live.has(file))
      errors.push(`unclassified e2e script: ${file}`);
  }
  for (const file of deterministic) {
    if (live.has(file))
      errors.push(`test is both deterministic and live: ${file}`);
  }
  for (const file of inventory) {
    const looksRunnable =
      file.endsWith(".test.mjs") ||
      file.endsWith("-smoke.mjs") ||
      file.startsWith("e2e-");
    if (
      looksRunnable &&
      !deterministic.has(file) &&
      !live.has(file) &&
      !INFRASTRUCTURE.has(file)
    ) {
      errors.push(`runnable script is not classified: ${file}`);
    }
  }

  if (errors.length)
    throw new Error(
      `Runtime test inventory is invalid:\n- ${errors.join("\n- ")}`
    );
}
