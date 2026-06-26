import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { computeCompatibility } from "../compatibility.mjs";
import hermesAdapter, { hermesAdapter as namedHermesAdapter } from "../adapters/hermes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(repoRoot, "experts", "ai-adoption-whale", "crewclaw.employee.yaml");

const whale = yaml.load(readFileSync(whalePackagePath, "utf8"));

assert.equal(namedHermesAdapter, hermesAdapter);

{
  const result = hermesAdapter.validate(whale);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.deepEqual(result.errors, []);
}

const compiled = hermesAdapter.compile(whale);

{
  assert.equal(typeof compiled.files["SOUL.md"], "string");
  assert.match(compiled.files["SOUL.md"], new RegExp(whale.identity.name));
}

{
  assert.equal(typeof compiled.files["AGENTS.md"], "string");
  assert.match(compiled.files["AGENTS.md"], new RegExp(whale.role_contract.mission));
  assert.match(compiled.files["AGENTS.md"], new RegExp(whale.role_contract.title));
}

{
  assert.equal(typeof compiled.files["config.yaml"], "string");
  assert.match(compiled.files["config.yaml"], /web_search/);
  assert.doesNotMatch(compiled.files["config.yaml"], /openai|anthropic/i);

  const config = yaml.load(compiled.files["config.yaml"]);
  assert.ok(config.toolsets.default.includes("web_search"));
}

{
  // PRD §14.2 safety: approval strictness must RISE with risk, never invert.
  const config = yaml.load(compiled.files["config.yaml"]);
  const tiers = config.permissions.tiers;
  assert.equal(tiers.P0.requires_approval, "never", "P0 (read public) auto-allows");
  assert.equal(tiers.P4.requires_approval, "deny", "P4 (high-risk) must default-deny, never auto-allow");
  assert.notEqual(tiers.P3.requires_approval, "never", "P3 (external side-effects) must not auto-allow");
}

{
  const result = computeCompatibility(whale, hermesAdapter.capabilities());
  assert.equal(result.level, "L3", result.reasons.join("\n"));
  assert.deepEqual(hermesAdapter.computeLevel(whale), result);
}

{
  const smoke = hermesAdapter.runSmokeTest(whale);
  assert.equal(smoke.id, "research-seed-2.1");
  assert.match(smoke.task, /Seed 2\.1/);
  assert.equal(smoke.runtime, "hermes");
  assert.equal(smoke.dry_run, true);
}

console.log("hermes-adapter.test.mjs passed");
