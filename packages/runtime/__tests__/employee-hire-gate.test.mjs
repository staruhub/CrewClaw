import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadWorkspaceCapabilityGrants,
  requireActiveWorkspaceEmployee,
} from "../employee-tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runtime = join(here, "..", "run.mjs");
const roots = [];

async function workspace(team) {
  const root = await mkdtemp(join(tmpdir(), "crewclaw-hire-gate-"));
  roots.push(root);
  if (team !== undefined) {
    await mkdir(join(root, ".crewclaw"), { recursive: true });
    await writeFile(
      join(root, ".crewclaw", "team.json"),
      typeof team === "string" ? team : `${JSON.stringify(team)}\n`
    );
  }
  return root;
}

try {
  const absent = await workspace();
  assert.throws(
    () =>
      requireActiveWorkspaceEmployee({
        root: absent,
        employeeId: "product-prd-crab",
      }),
    error => error?.code === "employee_not_hired"
  );

  const fired = await workspace([
    {
      employee_id: "product-prd-crab",
      status: "fired",
      permissions_granted: [],
    },
  ]);
  assert.throws(
    () =>
      requireActiveWorkspaceEmployee({
        root: fired,
        employeeId: "product-prd-crab",
      }),
    error => error?.code === "employee_not_hired"
  );

  const invalid = await workspace("{not-json");
  assert.throws(
    () =>
      requireActiveWorkspaceEmployee({
        root: invalid,
        employeeId: "product-prd-crab",
      }),
    error => error?.code === "team_invalid"
  );

  const active = await workspace([
    {
      workspace_employee_id: "workspace-product-prd-crab",
      employee_id: "product-prd-crab",
      version: "1.0.0",
      status: "active",
      hired_at: "2026-07-14T00:00:00Z",
      fired_at: null,
      permissions_granted: ["capability:source.verify"],
      package_sha256: "a".repeat(64),
      hire_source: "website",
    },
  ]);
  const snapshot = requireActiveWorkspaceEmployee({
    root: active,
    employeeId: "product-prd-crab",
  });
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.warning, null);
  assert.deepEqual(snapshot.grants, ["source.verify"]);
  assert.equal(snapshot.employee.package_sha256, "a".repeat(64));

  const legacy = await workspace([
    {
      employee_id: "product-prd-crab",
      status: "active",
      permissions_granted: [],
    },
  ]);
  assert.match(
    loadWorkspaceCapabilityGrants({
      root: legacy,
      employeeId: "product-prd-crab",
    }).warning,
    /legacy record/
  );

  const direct = spawnSync(
    process.execPath,
    [runtime, "product-prd-crab", "write a PRD"],
    {
      cwd: join(here, "..", "..", ".."),
      env: {
        ...process.env,
        CREWCLAW_ROOT: absent,
        CREW_DISABLE_DOTENV: "1",
        ZENMUX_API_KEY: "must-not-be-used",
      },
      encoding: "utf8",
      timeout: 15_000,
    }
  );
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /not hired and active/);
  assert.doesNotMatch(direct.stderr, /ZENMUX_API_KEY/);
} finally {
  await Promise.all(
    roots.map(root => rm(root, { recursive: true, force: true }))
  );
}
