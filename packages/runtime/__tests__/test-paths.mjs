import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(RUNTIME_TEST_DIR, "../../..");
export const RUNTIME_ENTRY = join(REPO_ROOT, "packages", "runtime", "run.mjs");

const TEST_EMPLOYEES = [
  "ai-adoption-whale",
  "code-review-shrimp",
  "product-prd-crab",
  "macao-networking-agent",
  "zeneth",
];

export function seedRuntimeTestTeam(root, employeeIds = TEST_EMPLOYEES) {
  const stateRoot = join(root, ".crewclaw");
  mkdirSync(stateRoot, { recursive: true });
  const team = employeeIds.map(employeeId => ({
    workspace_employee_id: `test-${employeeId}`,
    employee_id: employeeId,
    version: "test-harness",
    status: "active",
    hired_at: "2026-01-01T00:00:00.000Z",
    fired_at: null,
    permissions_granted: [],
    package_sha256: null,
    hire_source: "eval_harness",
  }));
  writeFileSync(join(stateRoot, "team.json"), `${JSON.stringify(team)}\n`);
  return root;
}

export function createRuntimeTestRoot(prefix = "crew-runtime-test-") {
  return seedRuntimeTestTeam(mkdtempSync(join(tmpdir(), prefix)));
}
