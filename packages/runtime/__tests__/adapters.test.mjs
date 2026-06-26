import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmployeePackage } from "../employee-package.mjs";
import { defineAdapter } from "../adapters/adapter-interface.mjs";
import { genericPromptCardAdapter } from "../adapters/generic-prompt-card.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(repoRoot, "experts", "ai-adoption-whale", "crewclaw.employee.yaml");

const loaded = loadEmployeePackage(whalePackagePath);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;

{
  const result = genericPromptCardAdapter.validate(whale);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
}

{
  const promptCard = genericPromptCardAdapter.compile(whale);
  assert.equal(typeof promptCard, "string");
  assert.match(promptCard, /岗位/);
  assert.match(promptCard, /标准交付物/);
  assert.match(promptCard, /不计为有效任务/);
}

{
  const adapter = defineAdapter({});
  assert.deepEqual(adapter.detect(), { ok: false, reason: "not_supported" });
  assert.deepEqual(adapter.install(), { ok: false, reason: "not_supported" });
}

console.log("adapters.test.mjs passed");
