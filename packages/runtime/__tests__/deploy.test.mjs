// AC-010 OpenWork Handoff: deploying the whale's REAL employee package produces an OpenWork
// blueprint + manifest with a compatibility level. Model-free → runs without the API quota.
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployToOpenWork } from "../deploy.mjs";
import { loadEmployeePackage } from "../employee-package.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const whalePath = path.resolve(
  here,
  "..",
  "..",
  "..",
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);
const loaded = loadEmployeePackage(whalePath);
assert.ok(
  loaded.ok,
  "whale package loads + validates: " + (loaded.errors || []).join("; ")
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewdeploy-"));
const r = deployToOpenWork(loaded.package, { root });
assert.ok(r.ok, "deploy succeeds for a valid package");
assert.ok(
  fs.existsSync(r.blueprintPath),
  "writes a real OpenWork blueprint file"
);
const manifestPath = path.join(r.dir, "deploy.manifest.json");
assert.ok(fs.existsSync(manifestPath), "writes a deploy manifest");
assert.match(r.level, /^L[0-4]$/, "computes a compatibility level (L0–L4)");
assert.equal(r.level, "L4", "the whale package targets OpenWork L4");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(
  manifest.id,
  "ai-adoption-whale",
  "manifest carries the employee id (from identity)"
);
assert.ok(
  Array.isArray(manifest.blueprint_keys) && manifest.blueprint_keys.length > 0,
  "blueprint has keys"
);

// an incomplete package fails validation cleanly (no throw)
const bad = deployToOpenWork({ identity: { id: "x" } }, { root });
assert.equal(bad.ok, false, "an incomplete package fails validation cleanly");
assert.ok(
  Array.isArray(bad.errors) && bad.errors.length > 0,
  "reports what's missing"
);

const junctionRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "crewdeploy-junction-")
);
const junctionTarget = fs.mkdtempSync(
  path.join(os.tmpdir(), "crewdeploy-target-")
);
fs.mkdirSync(path.join(junctionRoot, ".crewclaw"), { recursive: true });
fs.symlinkSync(
  junctionTarget,
  path.join(junctionRoot, ".crewclaw", "deploy"),
  "junction"
);
assert.throws(
  () => deployToOpenWork(loaded.package, { root: junctionRoot }),
  /unsafe state path/,
  "a deploy parent junction cannot redirect generated files outside the workspace"
);
assert.deepEqual(
  fs.readdirSync(junctionTarget),
  [],
  "a rejected deploy writes nothing through the junction"
);

const hardlinkRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "crewdeploy-hardlink-")
);
const firstHardlinkDeploy = deployToOpenWork(loaded.package, {
  root: hardlinkRoot,
});
assert.equal(firstHardlinkDeploy.ok, true);
const outsideBlueprint = path.join(hardlinkRoot, "outside-blueprint.json");
fs.rmSync(firstHardlinkDeploy.blueprintPath);
fs.writeFileSync(outsideBlueprint, "do not replace\n");
fs.linkSync(outsideBlueprint, firstHardlinkDeploy.blueprintPath);
assert.throws(
  () => deployToOpenWork(loaded.package, { root: hardlinkRoot }),
  /final entry is not a safe file/,
  "a hardlinked deploy output is rejected before replacement"
);
assert.equal(
  fs.readFileSync(outsideBlueprint, "utf8"),
  "do not replace\n",
  "the other hardlink is not modified"
);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(junctionRoot, { recursive: true, force: true });
fs.rmSync(junctionTarget, { recursive: true, force: true });
fs.rmSync(hardlinkRoot, { recursive: true, force: true });
console.log("deploy tests passed");
