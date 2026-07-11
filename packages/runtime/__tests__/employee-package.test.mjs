import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEmployeePackage,
  validateEmployeePackage,
} from "../employee-package.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(
  repoRoot,
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);
const tmpRoot = join(
  process.cwd(),
  ".employee-package-test-" + process.pid + "-" + Date.now()
);

function writePackage(name, yaml) {
  mkdirSync(tmpRoot, { recursive: true });
  const filePath = join(tmpRoot, name);
  writeFileSync(filePath, yaml, "utf8");
  return filePath;
}

function validPackageYaml({
  permissionLevel = "P1",
  compatibilityLevel = "L4",
} = {}) {
  return `
identity:
  id: test-employee
  name: Test Employee
role_contract:
  responsibilities:
    - Research public information.
soul:
  style: Evidence first.
deliverables:
  - report
tool_needs:
  web.search:
    necessity: required
    permission: readonly
permission_policy:
  default_level: ${permissionLevel}
eval_suite:
  smoke_tests:
    - id: smoke
      task: Validate evidence.
outcome_rubric:
  - verified_sources
compatibility_targets:
  OpenWork: ${compatibilityLevel}
`.trimStart();
}

try {
  {
    const result = loadEmployeePackage(whalePackagePath);
    assert.equal(result.ok, true);
    assert.equal(result.package.identity.id, "ai-adoption-whale");
  }

  {
    const result = validateEmployeePackage({
      identity: { id: "bad-tools" },
      role_contract: { responsibilities: ["Research"] },
      soul: { style: "Direct" },
      deliverables: ["report"],
      tool_needs: { tavily: { necessity: "required", permission: "readonly" } },
      permission_policy: { default_level: "P1" },
      eval_suite: { smoke_tests: [{ id: "smoke" }] },
      outcome_rubric: ["verified"],
      compatibility_targets: { OpenWork: "L4" },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider/i);
    assert.match(result.errors.join("\n"), /tavily/i);
  }

  {
    const result = validateEmployeePackage({
      role_contract: { responsibilities: ["Research"] },
      soul: { style: "Direct" },
      deliverables: ["report"],
      tool_needs: {
        "web.search": { necessity: "required", permission: "readonly" },
      },
      permission_policy: { default_level: "P1" },
      eval_suite: { smoke_tests: [{ id: "smoke" }] },
      outcome_rubric: ["verified"],
      compatibility_targets: { OpenWork: "L4" },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /identity/);
  }

  {
    const badPath = writePackage(
      "bad-levels.yaml",
      validPackageYaml({ permissionLevel: "P9", compatibilityLevel: "L9" })
    );
    const result = loadEmployeePackage(badPath);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /L9/);
    assert.match(result.errors.join("\n"), /P9/);
  }

  console.log("employee-package.test.mjs passed");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
