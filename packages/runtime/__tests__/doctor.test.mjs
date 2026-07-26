import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmployeePackage } from "../employee-package.mjs";
import {
  compatibilityDoctor,
  onboardingDoctor,
  packageDoctor,
  runtimeDoctor,
} from "../doctor.mjs";
import { parseMcpConfig } from "../mcp-client.mjs";
import { loadDotEnv } from "../run.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const whalePackagePath = join(
  repoRoot,
  "experts",
  "ai-adoption-whale",
  "crewclaw.employee.yaml"
);

function assertDoctorShape(result) {
  assert.ok(["healthy", "warning", "broken"].includes(result.status));
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.every(check => typeof check.name === "string"));
  assert.ok(result.checks.every(check => typeof check.ok === "boolean"));
  assert.ok(result.checks.every(check => typeof check.detail === "string"));
  assert.ok(Array.isArray(result.missing));
  assert.ok(typeof result.impact === "string");
  assert.ok(Array.isArray(result.fixes));
  assert.equal(typeof result.allow_degrade, "boolean");
  assert.ok(
    result.degraded_level === null || /^L[0-4]$/.test(result.degraded_level)
  );
}

function statusRank(status) {
  return { broken: 0, warning: 1, healthy: 2 }[status];
}

const loaded = loadEmployeePackage(whalePackagePath);
assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
const whale = loaded.package;
const TOOL_SCHEMAS = [
  "artifact_write",
  "web_search",
  "web_fetch",
  "browser_render",
].map(name => ({ function: { name } }));
const doctorOpts = { toolSchemas: TOOL_SCHEMAS };

{
  const workspaceRoot = mkdtempSync(join(tmpdir(), "crewclaw-doctor-dotenv-"));
  try {
    writeFileSync(
      join(workspaceRoot, ".env.local"),
      "TAVILY_API_KEY=workspace-doctor-key\nIGNORED=from-dotenv\n"
    );
    const env = { IGNORED: "explicit-env" };
    await loadDotEnv({ workspaceRoot, env });
    assert.equal(
      env.TAVILY_API_KEY,
      "workspace-doctor-key",
      "doctor can load the same workspace .env.local used by run"
    );
    assert.equal(env.IGNORED, "explicit-env", "dotenv never overrides env");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

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
  assert.match(
    result.checks.map(check => check.detail).join("\n"),
    /Missing required field/i
  );
  assert.ok(result.missing.some(item => /补齐/.test(item)));
}

{
  const result = onboardingDoctor(whale, {}, doctorOpts);
  assertDoctorShape(result);
  assert.ok(["warning", "broken"].includes(result.status));
  assert.ok(
    result.checks.some(check => check.name === "tool.web.search" && !check.ok)
  );
  assert.match(
    result.checks.map(check => check.detail).join("\n"),
    /missing_key/
  );
  assert.ok(result.fixes.some(fix => /Tavily|Firecrawl|Exa|SearXNG/.test(fix)));
  assert.equal(result.allow_degrade, true);
  assert.equal(result.degraded_level, "L0");
}

{
  const emptyEnvResult = onboardingDoctor(whale, {}, doctorOpts);
  const tavilyResult = onboardingDoctor(
    whale,
    { TAVILY_API_KEY: "test-key" },
    doctorOpts
  );
  assertDoctorShape(tavilyResult);
  assert.ok(
    statusRank(tavilyResult.status) > statusRank(emptyEnvResult.status)
  );
  assert.ok(
    tavilyResult.checks.some(
      check => check.name === "tool.web.search" && check.ok
    )
  );
}

{
  const noRuntimeSchemas = onboardingDoctor(
    whale,
    { TAVILY_API_KEY: "test-key" },
    { toolSchemas: [] }
  );
  assert.equal(noRuntimeSchemas.status, "broken");
  assert.ok(
    noRuntimeSchemas.checks.some(
      check =>
        check.name === "tool.web.search" &&
        !check.ok &&
        /未注册 web_search/.test(check.detail)
    ),
    "a configured provider must not bypass an unavailable employee runtime tool"
  );
}

{
  const mcpPackage = {
    ...whale,
    tool_needs: {
      "github.read": {
        necessity: "required",
        permission: "readonly",
        description:
          "Read repository contents through the configured MCP adapter",
      },
    },
  };
  const mcpCatalog = {
    version: "test",
    capabilities: [
      {
        id: "github.read",
        invocation: "adapter",
        operation: "read",
        provider_bindings: [
          { provider: "mcp.github", tools: ["get_file_contents"] },
        ],
      },
    ],
  };
  const rawMcp = {
    mcp_servers: {
      github: {
        command: "node",
        args: ["server.mjs"],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        },
        tools: { include: ["get_file_contents"] },
      },
    },
  };
  const env = { GITHUB_PERSONAL_ACCESS_TOKEN: "doctor-test-token" };

  const ambientCredentialOnly = onboardingDoctor(mcpPackage, env, {
    catalog: mcpCatalog,
    toolSchemas: [],
  });
  assert.equal(ambientCredentialOnly.status, "broken");
  assert.ok(
    ambientCredentialOnly.checks.some(
      check => check.name === "tool.github.read" && !check.ok
    ),
    "ambient credentials alone must not invent an executable MCP provider"
  );

  const parsedMcp = parseMcpConfig(rawMcp, {
    env,
    profileDir: repoRoot,
  });
  const executableMcp = onboardingDoctor(mcpPackage, env, {
    catalog: mcpCatalog,
    toolSchemas: [],
    mcp: parsedMcp,
  });
  assert.equal(executableMcp.status, "healthy");
  assert.ok(
    executableMcp.checks.some(
      check => check.name === "tool.github.read" && check.ok
    ),
    "doctor accepts only providers projected from the parsed executable MCP config"
  );
}

{
  const drifted = onboardingDoctor(
    {
      ...whale,
      tool_needs: {
        "web.extract": {
          necessity: "required",
          permission: "readonly",
        },
      },
    },
    { TAVILY_API_KEY: "test-key" },
    doctorOpts
  );
  assert.equal(drifted.status, "broken");
  assert.ok(
    drifted.checks.some(check => check.name === "tool.web.extract" && !check.ok)
  );
}

{
  const result = compatibilityDoctor(whale, { tools: false });
  assertDoctorShape(result);
  assert.equal(result.degraded_level, "L0");
  assert.equal(result.allow_degrade, true);
  assert.ok(["warning", "broken"].includes(result.status));
  assert.ok(
    result.checks.some(check => !check.ok && /downgrade/i.test(check.detail))
  );
  assert.ok(result.missing.some(item => /Runtime|capability|工具/.test(item)));
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
  assert.ok(
    result.checks.some(
      check => check.name === "runtime.cost_budget" && !check.ok
    )
  );
  assert.ok(
    result.checks.some(
      check => check.name === "runtime.evidence_count" && !check.ok
    )
  );
  assert.ok(result.fixes.some(fix => /预算|budget|成本|模型/.test(fix)));
  assert.ok(result.fixes.some(fix => /证据|evidence|来源/.test(fix)));
}

{
  const workspaceRoot = mkdtempSync(join(tmpdir(), "crewclaw-tool-doctor-"));
  try {
    const env = { ...process.env, CREW_DOCTOR_SKIP_MODEL: "1" };
    delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const output = spawnSync(
      process.execPath,
      [
        join(repoRoot, "packages", "runtime", "tool-doctor-cli.mjs"),
        "code-review-shrimp",
        workspaceRoot,
      ],
      { cwd: repoRoot, env, encoding: "utf8" }
    );
    assert.equal(
      output.status,
      0,
      `tool doctor failed:\n${output.stderr || output.stdout}`
    );
    const snapshot = JSON.parse(output.stdout);
    assert.equal(snapshot.schema_version, "crewclaw.tool-doctor/v1");
    assert.equal(snapshot.mcp.status, "blocked");
    assert.deepEqual(snapshot.mcp.providers, []);
    assert.deepEqual(snapshot.mcp.servers[0]?.missing_env, [
      "GITHUB_PERSONAL_ACCESS_TOKEN",
    ]);
    for (const surface of ["chat", "task"]) {
      assert.equal(
        snapshot.surfaces[surface].providers.search.runtime_tool,
        "web_search"
      );
      assert.equal(
        snapshot.surfaces[surface].providers.render.runtime_tool,
        "browser_render"
      );
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

console.log("doctor.test.mjs passed");
