import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeCompatibility } from "../compatibility.mjs";
import { loadEmployeePackage } from "../employee-package.mjs";
import openworkAdapter, {
  openworkAdapter as namedOpenworkAdapter,
} from "../adapters/openwork.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const loaded = loadEmployeePackage(
  join(repoRoot, "experts", "ai-adoption-whale", "crewclaw.employee.yaml")
);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;

assert.equal(namedOpenworkAdapter, openworkAdapter);
assert.equal(openworkAdapter.validate(whale).ok, true);

const capabilities = openworkAdapter.capabilities();
assert.equal(capabilities.detected, false);
assert.equal(capabilities.probed, false);
assert.equal(
  computeCompatibility(whale, capabilities).level,
  "L0",
  "an unconfigured private OpenWork runtime must never claim observed capability"
);

const detection = openworkAdapter.detect();
assert.equal(detection.ok, false);
assert.equal(detection.status, "contract_required");
assert.match(detection.reason, /owner's OpenWork contract/i);

const blueprint = openworkAdapter.compile(whale);
assert.deepEqual(Object.keys(blueprint).sort(), [
  "artifact_templates",
  "employee_card",
  "permission_gateway_rules",
  "reflection_job",
  "task_acceptance_rules",
  "tool_bindings",
  "workspace_instructions",
  "workspace_memory",
  "workspace_ui_layout",
]);
assert.equal(blueprint.permission_gateway_rules.tiers.P0.auto_allow, true);
assert.equal(
  blueprint.permission_gateway_rules.tiers.P4.default_action,
  "deny"
);
assert.doesNotMatch(
  JSON.stringify(blueprint.tool_bindings),
  /tavily|playwright|bash|curl|selenium|puppeteer|serper|openai|anthropic/i
);

assert.deepEqual(openworkAdapter.install(whale), {
  ok: false,
  reason: "openwork_contract_unconfigured",
});
const smoke = openworkAdapter.runSmokeTest(whale);
assert.equal(smoke.ok, false);
assert.equal(smoke.dry_run, true);
assert.equal(smoke.reason, "openwork_contract_unconfigured");
assert.equal(openworkAdapter.doctor(whale).observed_level, "L0");
assert.equal(openworkAdapter.collectEvents().ok, false);
assert.equal(openworkAdapter.collectArtifacts().ok, false);

const implementation = readFileSync(
  join(repoRoot, "packages", "runtime", "adapters", "openwork.mjs"),
  "utf8"
);
assert.doesNotMatch(
  implementation,
  /@opencode-ai|global\.health|different-ai|\.opencode\/skills/,
  "the owner's OpenWork adapter must not inherit contracts from an unrelated public project"
);

console.log("openwork-adapter.test.mjs passed");
