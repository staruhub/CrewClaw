import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCompatibility } from "../compatibility.mjs";
import { loadEmployeePackage } from "../employee-package.mjs";
import openworkAdapter, {
  openworkAdapter as namedOpenworkAdapter,
} from "../adapters/openwork.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(
  repoRoot,
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error?.message || String(error)}`);
  }
}

const loaded = loadEmployeePackage(whalePackagePath);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;
const expectedBlueprintKeys = [
  "employee_card",
  "workspace_instructions",
  "tool_bindings",
  "permission_gateway_rules",
  "artifact_templates",
  "task_acceptance_rules",
  "workspace_memory",
  "reflection_job",
  "workspace_ui_layout",
];

await check("exports named and default adapter", () => {
  assert.equal(namedOpenworkAdapter, openworkAdapter);
});

await check("validate does not throw for whale fixture", () => {
  assert.doesNotThrow(() => openworkAdapter.validate(whale));
  const result = openworkAdapter.validate(whale);
  assert.equal(result.ok, true, result.errors?.join("\n"));
});

const blueprint = openworkAdapter.compile(whale);

await check("compile returns blueprint with exactly the 11.3 nine keys", () => {
  assert.deepEqual(
    Object.keys(blueprint).sort(),
    expectedBlueprintKeys.toSorted()
  );
});

await check(
  "tool_bindings includes abstract web-search without vendor names",
  () => {
    const serialized = JSON.stringify(blueprint.tool_bindings);
    assert.match(serialized, /web-search/);
    assert.doesNotMatch(
      serialized,
      /tavily|playwright|bash|curl|selenium|puppeteer|serper|openai|anthropic/i
    );
  }
);

await check("permission rules keep P0 auto-allow and P4 deny-safe", () => {
  const rules = blueprint.permission_gateway_rules;
  assert.equal(
    rules.tiers.P0.auto_allow,
    true,
    "P0 read-public must auto-allow"
  );
  assert.equal(
    rules.tiers.P0.approval_required,
    false,
    "P0 read-public must not require approval"
  );
  assert.ok(
    rules.tiers.P4.auto_allow === false ||
      rules.tiers.P4.default_action === "deny",
    "P4 must not be auto-allowed"
  );
  assert.notEqual(
    rules.tiers.P4.auto_allow,
    true,
    "P4 auto_allow must never be true"
  );
});

await check("computeCompatibility returns L4 for OpenWork capabilities", () => {
  const result = computeCompatibility(whale, openworkAdapter.capabilities());
  assert.equal(result.level, "L4", result.reasons.join("\n"));
});

await check("runSmokeTest is dry-run Seed 2.1 eval trial", () => {
  const smoke = openworkAdapter.runSmokeTest(whale);
  assert.equal(smoke.dry_run, true);
  assert.match(
    `${smoke.id} ${smoke.task} ${smoke.seed} ${smoke.name}`,
    /Seed 2\.1|seed-2\.1/i
  );
});

const failed = results.filter(result => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
