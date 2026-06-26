import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmployeePackage } from "../employee-package.mjs";
import { compatibilityDoctor, onboardingDoctor, packageDoctor, runtimeDoctor } from "../doctor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(repoRoot, "experts", "ai-adoption-whale", "crewclaw.employee.yaml");

function assertDoctorShape(result) {
  assert.ok(["healthy", "warning", "broken"].includes(result.status));
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.every((check) => typeof check.name === "string"));
  assert.ok(result.checks.every((check) => typeof check.ok === "boolean"));
  assert.ok(result.checks.every((check) => typeof check.detail === "string"));
  assert.ok(Array.isArray(result.missing));
  assert.ok(typeof result.impact === "string");
  assert.ok(Array.isArray(result.fixes));
  assert.equal(typeof result.allow_degrade, "boolean");
  assert.ok(result.degraded_level === null || /^L[0-4]$/.test(result.degraded_level));
}

function statusRank(status) {
  return { broken: 0, warning: 1, healthy: 2 }[status];
}

const loaded = loadEmployeePackage(whalePackagePath);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;

{
  const result = packageDoctor(whale);
  assertDoctorShape(result);
  assert.equal(result.status, "healthy");
  assert.equal(result.allow_degrade, false);
}

{
  const result = packageDoctor({
    identity: { id: "missing-required-fields" },
    tool_needs: {},
  });
  assertDoctorShape(result);
  assert.equal(result.status, "broken");
  assert.match(result.checks.map((check) => check.detail).join("\n"), /Missing required field/i);
  assert.ok(result.missing.some((item) => /补齐/.test(item)));
}

{
  const result = onboardingDoctor(whale, {});
  assertDoctorShape(result);
  assert.ok(["warning", "broken"].includes(result.status));
  assert.ok(result.checks.some((check) => check.name === "tool.web.search" && !check.ok));
  assert.match(result.checks.map((check) => check.detail).join("\n"), /missing_key/);
  assert.ok(result.fixes.some((fix) => /Tavily|Firecrawl|Exa|SearXNG/.test(fix)));
  assert.equal(result.allow_degrade, true);
  assert.equal(result.degraded_level, "L0");
}

{
  const emptyEnvResult = onboardingDoctor(whale, {});
  const tavilyResult = onboardingDoctor(whale, { TAVILY_API_KEY: "test-key" });
  assertDoctorShape(tavilyResult);
  assert.ok(statusRank(tavilyResult.status) > statusRank(emptyEnvResult.status));
  assert.ok(tavilyResult.checks.some((check) => check.name === "tool.web.search" && check.ok));
}

{
  const result = compatibilityDoctor(whale, { tools: false });
  assertDoctorShape(result);
  assert.equal(result.degraded_level, "L0");
  assert.equal(result.allow_degrade, true);
  assert.ok(["warning", "broken"].includes(result.status));
  assert.ok(result.checks.some((check) => !check.ok && /downgrade/i.test(check.detail)));
  assert.ok(result.missing.some((item) => /Runtime|capability|工具/.test(item)));
}

{
  const result = runtimeDoctor({
    tool_failures: [],
    cost: 12,
    budget: 10,
    stuck: false,
    evidence_count: 1,
  });
  assertDoctorShape(result);
  assert.equal(result.status, "warning");
  assert.ok(result.checks.some((check) => check.name === "runtime.cost_budget" && !check.ok));
  assert.ok(result.checks.some((check) => check.name === "runtime.evidence_count" && !check.ok));
  assert.ok(result.fixes.some((fix) => /预算|budget|成本|模型/.test(fix)));
  assert.ok(result.fixes.some((fix) => /证据|evidence|来源/.test(fix)));
}

console.log("doctor.test.mjs passed");
