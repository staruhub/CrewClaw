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
const whalePath = path.resolve(here, "..", "..", "..", "experts", "ai-adoption-whale", "crewclaw.employee.yaml");
const loaded = loadEmployeePackage(whalePath);
assert.ok(loaded.ok, "whale package loads + validates: " + (loaded.errors || []).join("; "));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewdeploy-"));
const r = deployToOpenWork(loaded.package, { root });
assert.ok(r.ok, "deploy succeeds for a valid package");
assert.ok(fs.existsSync(r.blueprintPath), "writes a real OpenWork blueprint file");
const manifestPath = path.join(r.dir, "deploy.manifest.json");
assert.ok(fs.existsSync(manifestPath), "writes a deploy manifest");
assert.match(r.level, /^L[0-4]$/, "computes a compatibility level (L0–L4)");
assert.equal(r.level, "L4", "the whale package targets OpenWork L4");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(manifest.id, "ai-adoption-whale", "manifest carries the employee id (from identity)");
assert.ok(Array.isArray(manifest.blueprint_keys) && manifest.blueprint_keys.length > 0, "blueprint has keys");

// an incomplete package fails validation cleanly (no throw)
const bad = deployToOpenWork({ identity: { id: "x" } }, { root });
assert.equal(bad.ok, false, "an incomplete package fails validation cleanly");
assert.ok(Array.isArray(bad.errors) && bad.errors.length > 0, "reports what's missing");

fs.rmSync(root, { recursive: true, force: true });
console.log("deploy tests passed");
