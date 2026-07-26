import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "../yaml.mjs";
import { computeCompatibility } from "../compatibility.mjs";
import hermesAdapter, {
  hermesAdapter as namedHermesAdapter,
} from "../adapters/hermes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(
  repoRoot,
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);

const whale = yaml.load(readFileSync(whalePackagePath, "utf8"));
const expertNames = [
  "ai-adoption-whale",
  "code-review-shrimp",
  "macao-networking-agent",
  "product-prd-crab",
  "zeneth",
];
const forbiddenExpandedTools = new Set([
  "patch",
  "skill_manage",
  "terminal",
  "write_file",
]);
const upstreamToolsetExpansion = {
  file: ["read_file", "write_file", "patch", "search_files"],
  skills: ["skills_list", "skill_view", "skill_manage"],
  terminal: ["terminal"],
};

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
  assert.match(
    compiled.files["AGENTS.md"],
    new RegExp(whale.role_contract.mission)
  );
  assert.match(
    compiled.files["AGENTS.md"],
    new RegExp(whale.role_contract.title)
  );
  assert.match(
    compiled.files["AGENTS.md"],
    /Playbooks are orchestration flows/
  );
}

{
  const withoutExplicitSkills = structuredClone(whale);
  delete withoutExplicitSkills.adapter_hints.Hermes.skills;
  assert.deepEqual(
    hermesAdapter.compile(withoutExplicitSkills).skills,
    [],
    "playbook ids must never be guessed as skill directories"
  );
  for (const skill of compiled.skills) {
    assert.match(skill.content, /^---\nname: [^\n]+\ndescription: Use when /);
  }
}

{
  assert.equal(typeof compiled.files["config.yaml"], "string");
  assert.doesNotMatch(compiled.files["config.yaml"], /web_search|web_fetch/);
  assert.doesNotMatch(compiled.files["config.yaml"], /openai|anthropic/i);

  const config = yaml.load(compiled.files["config.yaml"]);
  assert.ok(Array.isArray(config.toolsets));
  assert.ok(config.toolsets.includes("web"));
  assert.ok(!config.toolsets.includes("skills"));
  assert.ok(!config.toolsets.includes("search"));
  assert.ok(!config.toolsets.includes("browser"));
  assert.deepEqual(config.platform_toolsets.cli, ["web", "no_mcp"]);
  assert.equal(config.coding_context, "off");
  assert.deepEqual(config.plugins.enabled, []);
  assert.deepEqual(config.agent.disabled_toolsets, [
    "browser",
    "code_execution",
    "file",
    "skills",
    "terminal",
  ]);
  assert.deepEqual(config.approvals, { mode: "manual" });
  assert.equal(config.permissions, undefined);
  assert.equal(config.runtime, undefined);
  assert.equal(config.employee, undefined);
}

{
  const conditionalOnly = structuredClone(whale);
  conditionalOnly.tool_needs = {
    "web.search": { necessity: "required" },
    "web.fetch": { necessity: "conditional" },
    "browser.render": { necessity: "conditional" },
  };
  const config = yaml.load(
    hermesAdapter.compile(conditionalOnly).files["config.yaml"]
  );
  assert.deepEqual(config.toolsets, ["search"]);
  assert.deepEqual(config.platform_toolsets.cli, ["search", "no_mcp"]);

  conditionalOnly.tool_needs["web.fetch"].necessity = "required";
  const withFetch = yaml.load(
    hermesAdapter.compile(conditionalOnly).files["config.yaml"]
  );
  assert.deepEqual(withFetch.toolsets, ["web"]);
  assert.deepEqual(withFetch.platform_toolsets.cli, ["web", "no_mcp"]);
}

{
  const result = computeCompatibility(whale, hermesAdapter.capabilities());
  assert.equal(result.level, "L1", result.reasons.join("\n"));
  assert.deepEqual(hermesAdapter.computeLevel(whale), result);
}

{
  for (const expertName of expertNames) {
    const pkg = yaml.load(
      readFileSync(
        join(repoRoot, "experts", expertName, "crewclaw.employee.yaml"),
        "utf8"
      )
    );
    const config = yaml.load(hermesAdapter.compile(pkg).files["config.yaml"]);
    const resolved = new Set(
      config.toolsets.flatMap(
        toolset => upstreamToolsetExpansion[toolset] || []
      )
    );
    for (const forbidden of forbiddenExpandedTools) {
      assert.ok(
        !resolved.has(forbidden),
        `${expertName} unexpectedly resolves forbidden Hermes tool ${forbidden}`
      );
    }
  }

  const doctor = hermesAdapter.doctor(whale);
  assert.equal(doctor.status, "needs_attention");
  assert.equal(
    doctor.checks.find(check => check.id === "standalone_capability_boundary")
      ?.status,
    "fail"
  );
}

{
  const smoke = hermesAdapter.runSmokeTest(whale);
  assert.equal(smoke.id, "research-seed-2.1");
  assert.match(smoke.task, /Seed 2\.1/);
  assert.equal(smoke.runtime, "hermes");
  assert.equal(smoke.dry_run, true);
  assert.equal(smoke.runner, "hermes chat -q");
}

console.log("hermes-adapter.test.mjs passed");
