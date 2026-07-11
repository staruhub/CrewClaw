import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmployeePackage } from "../employee-package.mjs";
import { computeCompatibility } from "../compatibility.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(
  repoRoot,
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);

const loaded = loadEmployeePackage(whalePackagePath);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;

const capableRuntime = {
  tasks: true,
  tools: true,
  artifacts: true,
  search: true,
  browser: true,
  evidence: true,
  artifact: true,
  shell: true,
  file: true,
  capabilities: [
    "web.search",
    "web.extract",
    "web.fetch_extract",
    "source.verify",
    "evidence.create",
    "artifact.report",
    "browser.render",
    "shell.run",
  ],
};

{
  const result = computeCompatibility(whale, capableRuntime);
  assert.match(result.level, /^L[2-4]$/);
  assert.deepEqual(result, computeCompatibility(whale, capableRuntime));
}

{
  const result = computeCompatibility(whale, { tools: false });
  assert.equal(result.level, "L0");
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length > 0);
  assert.deepEqual(result, computeCompatibility(whale, { tools: false }));
}

console.log("compatibility.test.mjs passed");
