import { link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { EmployeeSpecSchema } from "../../../contracts/employee-spec";
import { TOOL_CAPABILITIES } from "../../../contracts/tool-catalog";
import runtimeYaml from "../../runtime/yaml.mjs";
import {
  validateAllExperts,
  validateEmployeeToolContract,
  validateExpert,
} from "./index";

const createdRoots: string[] = [];

async function makeExpertRoot() {
  const sandbox = await mkdtemp(join(tmpdir(), "crewclaw-validator-"));
  createdRoots.push(sandbox);
  const root = join(sandbox, "test-expert");
  await mkdir(join(root, "skills", "review", "code-review-checklist"), {
    recursive: true,
  });
  await writeFile(
    join(root, "distribution.yaml"),
    [
      "name: test-expert",
      "version: 0.1.0",
      "description: Test expert for validator coverage.",
      'hermes_requires: ">=0.18.2"',
      "author: ChaoGeek / Pong",
      "license: Apache-2.0",
      "env_requires:",
      "  - name: OPENAI_API_KEY",
      "    description: Optional model provider key.",
      "    required: false",
      '    default: ""',
      "distribution_owned:",
      "  - SOUL.md",
      "  - config.yaml",
      "  - mcp.json",
      "  - skills/",
      "  - CERTIFICATION.md",
    ].join("\n")
  );
  await writeFile(join(root, "README.md"), "# Test Expert\n");
  await writeFile(join(root, "SOUL.md"), "# Soul\nYou are a test expert.\n");
  await writeFile(
    join(root, "config.yaml"),
    "temperature: 0.2\ntoolsets: []\nplatform_toolsets:\n  cli:\n    - no_mcp\ncoding_context: off\nagent:\n  disabled_toolsets: [browser, code_execution, file, skills, terminal]\nplugins:\n  enabled: []\napprovals:\n  mode: manual\n"
  );
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({ mcp_servers: {} }, null, 2)
  );
  await writeFile(join(root, ".env.EXAMPLE"), "OPENAI_API_KEY=\n");
  await writeFile(join(root, "CERTIFICATION.md"), "# Certification\nC2\n");
  await writeFile(
    join(root, "EXAMPLES.md"),
    "# Examples\n\n## 1. First task\n\n## 2. Common workflow\n\n## 3. Advanced workflow\n"
  );
  await writeFile(
    join(root, "EVALS.md"),
    "# Evals\n\ncase-001\ncase-002\ncase-003\n"
  );
  await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n");
  await writeFile(
    join(root, "skills", "review", "code-review-checklist", "SKILL.md"),
    [
      "---",
      "name: code-review-checklist",
      "description: Use when reviewing a pull request for merge readiness.",
      "version: 0.1.0",
      "author: ChaoGeek / Pong",
      "license: Apache-2.0",
      "---",
      "# Code Review Checklist",
      "",
      "## Overview",
      "Review the diff.",
      "",
      "## When to Use",
      "Use for PR review.",
      "",
      "## Workflow",
      "Read, inspect, summarize.",
      "",
      "## Common Pitfalls",
      "Do not invent files.",
      "",
      "## Verification Checklist",
      "- [ ] Blocking issues are separated.",
    ].join("\n")
  );
  // v0.18 A4: the two-file employee standard is mandatory for a complete distribution — write a
  // valid default hire.yaml + crewclaw.employee.yaml. Tests that exercise hire.yaml overwrite it.
  await writeFile(join(root, "hire.yaml"), makeHireYaml());
  await writeFile(join(root, "crewclaw.employee.yaml"), makeSpecYaml());
  return root;
}

// A minimal EmployeeSpec (crewclaw.employee.yaml) that satisfies contracts/employee-spec.ts:
// id/version match the fixture's registry entry, a single rubric entry weighing 1.0.
function makeSpecYaml() {
  return [
    "identity:",
    "  id: test-expert",
    "  name: Test Expert",
    "  avatar: shrimp",
    "  author: ChaoGeek / Pong",
    "  version: 0.1.0",
    "  certification: C2",
    "  title: Test Expert",
    "  description: Test expert for validator coverage.",
    "role_contract:",
    "  title: Test Expert",
    "  mission: Exercise the validator.",
    "  responsibilities:",
    "    - Review changes.",
    "  not_responsible_for:",
    "    - Deploying code.",
    "  best_for:",
    "    - Validator coverage.",
    "soul:",
    "  source: SOUL.md",
    "  working_style:",
    "    - Evidence first.",
    "  communication_style: Crisp and structured.",
    "  values:",
    "    - No fabrication.",
    "deliverables:",
    "  - type: review_report",
    "    name: Review report",
    "tool_needs:",
    "  files.read:",
    "    necessity: required",
    "    permission: readonly",
    "    description: Read files.",
    "permission_policy:",
    "  default_level: P1",
    "  levels:",
    "    P0: Read only.",
    "    P1: Write artifacts.",
    "  grants:",
    "    files.read: P0",
    "  denied: {}",
    "  human_authorization_required: []",
    "eval_suite:",
    "  smoke_tests:",
    "    - id: smoke-1",
    "      task: Review a trivial change.",
    "      acceptance:",
    "        - Reports blocking issues.",
    "  grading:",
    "    pass_threshold: 0.8",
    "outcome_rubric:",
    "  - id: defect_detection",
    "    weight: 1.0",
    "    criterion: Finds the real defects.",
    "compatibility_targets:",
    "  Hermes:",
    "    level: L1",
    "    strategy: Prompt and playbook only; tools require CrewClaw.",
  ].join("\n");
}

function makeHireYaml(
  overrides: {
    version?: string;
    permissions?: string[];
    omitIdentity?: boolean;
  } = {}
) {
  const permissions = overrides.permissions ?? ["browser:read"];
  const lines = [
    "apiVersion: crewclaw/v1",
    "kind: Employee",
    "metadata:",
    "  id: test-expert",
    "  name: Test Expert",
    "  mascot: shrimp",
    `  version: ${overrides.version ?? "0.1.0"}`,
    "  certification: C2",
    "  published_by: ChaoGeek",
    "  creator: Pong",
  ];
  if (!overrides.omitIdentity) {
    lines.push(
      "identity:",
      "  title: Test Expert",
      "  description: Test expert for validator coverage.",
      "  reports_to: User",
      "  location: Local"
    );
  }
  lines.push(
    "soul: Practical test expert.",
    "skills:",
    "  - code-review-checklist",
    "tools: []",
    "permissions:",
    ...permissions.map(permission => `  - ${permission}`),
    "requires:",
    '  hermes: ">=0.18.2"',
    "  runtime: node",
    "  env:",
    "    - OPENAI_API_KEY",
    "examples:",
    "  inputs:",
    "    - Review this pull request.",
    "  outputs:",
    "    - Blocking issues and recommendations.",
    "limitations:",
    "  - Cannot access private repositories without credentials.",
    "sla:",
    "  response_time: immediate",
    "  availability: best-effort",
    "  escalation: Ask a human reviewer.",
    "lifecycle:",
    "  hireable: true",
    "  fireable: true",
    "  trial_period: 14 days",
    "categories:",
    "  - engineering",
    "tags:",
    "  - test"
  );
  return lines.join("\n");
}

afterEach(async () => {
  for (const root of createdRoots.splice(0).reverse()) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("validateExpert", () => {
  it("passes a complete Hermes expert distribution", async () => {
    const root = await makeExpertRoot();

    const result = await validateExpert(root);

    expect(result.ok, result.errors.join("\n")).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an employee capability that is not in the catalog", async () => {
    const root = await makeExpertRoot();
    const unknownCapability = makeSpecYaml()
      .replace("  files.read:\n", "  shadow.root:\n")
      .replace("    files.read: P0", "    shadow.root: P0");
    await writeFile(join(root, "crewclaw.employee.yaml"), unknownCapability);

    const result = await validateExpert(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("unknown tool capability");
  });

  it("rejects granting a capability declared disabled", async () => {
    const root = await makeExpertRoot();
    const disabledButGranted = makeSpecYaml()
      .replace("    necessity: required", "    necessity: disabled")
      .replace("    permission: readonly", "    permission: disabled");
    await writeFile(join(root, "crewclaw.employee.yaml"), disabledButGranted);

    const result = await validateExpert(root);

    expect(result.errors).toContain(
      "Disabled capability cannot be granted: files.read"
    );
  });

  it("rejects a required capability without any executable binding", () => {
    const spec = EmployeeSpecSchema.parse(runtimeYaml.load(makeSpecYaml()));
    const filesRead = TOOL_CAPABILITIES.get("files.read");
    expect(filesRead).toBeDefined();
    const unboundCatalog = new Map(TOOL_CAPABILITIES);
    unboundCatalog.set("files.read", {
      ...filesRead!,
      runtime_tool: null,
      provider_bindings: [],
    });

    expect(validateEmployeeToolContract(spec, unboundCatalog)).toContain(
      "Required capability has no executable binding: files.read"
    );
  });

  it("rejects an MCP allowlist that exceeds the employee capability contract", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "mcp.json"),
      JSON.stringify(
        {
          mcp_servers: {
            github: { tools: { include: ["search_code"] } },
          },
        },
        null,
        2
      )
    );

    const result = await validateExpert(root);

    expect(result.errors).toContain(
      "MCP tool exceeds employee capability contract: github.search_code"
    );
  });

  it("validates hire.yaml manifests with the shared EmployeeManifestSchema", async () => {
    const root = await makeExpertRoot();
    await writeFile(join(root, "hire.yaml"), makeHireYaml());

    const result = await validateExpert(root, {
      name: "test-expert",
      version: "0.1.0",
      local_source: root,
    });

    expect(result.ok, result.errors.join("\n")).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when hire.yaml is missing required manifest fields", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "hire.yaml"),
      makeHireYaml({ omitIdentity: true })
    );

    const result = await validateExpert(root);

    expect(result.ok).toBe(false);
    expect(
      result.errors.some(error => error.startsWith("Invalid hire.yaml:"))
    ).toBe(true);
  });

  it("fails when registry name, version, or local_source disagree with hire.yaml", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "hire.yaml"),
      makeHireYaml({ version: "0.1.0" })
    );

    const result = await validateExpert(root, {
      name: "different-expert",
      version: "0.2.0",
      local_source: "experts/different-expert",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Registry name mismatch: registry=different-expert hire.yaml=test-expert"
    );
    expect(result.errors).toContain(
      "Registry version mismatch: registry=0.2.0 hire.yaml=0.1.0"
    );
    expect(result.errors).toContain(
      `Registry local_source mismatch: registry=experts/different-expert package=${root}`
    );
  });

  it("rejects distribution identity and Hermes version drift", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "distribution.yaml"),
      [
        "name: wrong-expert",
        "version: 9.9.9",
        "description: Wrong identity used to exercise drift checks.",
        'hermes_requires: ">=0.12.0"',
        "author: ChaoGeek / Pong",
        "license: Apache-2.0",
      ].join("\n")
    );

    const result = await validateExpert(root);

    expect(result.errors).toContain(
      "Distribution name mismatch: directory=test-expert distribution.yaml=wrong-expert"
    );
    expect(result.errors).toContain(
      "Version mismatch: distribution.yaml=9.9.9 hire.yaml=0.1.0"
    );
    expect(result.errors).toContain(
      "Unsupported Hermes requirement: distribution.yaml=>=0.12.0 expected=>=0.18.2"
    );
    expect(result.errors).toContain(
      "Hermes requirement mismatch: distribution.yaml=>=0.12.0 hire.yaml=>=0.18.2"
    );
  });

  it("rejects legacy Hermes config shapes and tool names masquerading as toolsets", async () => {
    const legacyRoot = await makeExpertRoot();
    await writeFile(
      join(legacyRoot, "config.yaml"),
      'model:\n  default: ""\ntoolsets:\n  default:\n    - read_file\napprovals:\n  mode: manual\n'
    );

    const legacy = await validateExpert(legacyRoot);
    expect(legacy.errors).toContain(
      "Invalid config.yaml: model must be a scalar string; legacy model.default is not supported"
    );
    expect(legacy.errors).toContain(
      "Invalid config.yaml: toolsets must be an array of official Hermes toolset names; legacy toolsets.default is not supported"
    );

    const fakeToolsetRoot = await makeExpertRoot();
    await writeFile(
      join(fakeToolsetRoot, "config.yaml"),
      "toolsets:\n  - read_file\n  - skills\napprovals:\n  mode: manual\n"
    );
    const fakeToolset = await validateExpert(fakeToolsetRoot);
    expect(fakeToolset.errors).toContain(
      "Invalid config.yaml: unknown Hermes toolset(s): read_file"
    );
  });

  it("rejects hire/profile Hermes toolset drift", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "config.yaml"),
      "toolsets:\n  - web\nplatform_toolsets:\n  cli: [web, no_mcp]\ncoding_context: off\nagent:\n  disabled_toolsets: [browser, code_execution, file, skills, terminal]\nplugins:\n  enabled: []\napprovals:\n  mode: manual\n"
    );

    const result = await validateExpert(root);

    expect(result.errors).toContain(
      "Hermes toolset mismatch: hire.yaml= config.yaml=web"
    );
  });

  it("rejects broad Hermes bundles that resolve disabled capabilities", async () => {
    for (const [toolset, forbiddenTool] of [
      ["file", "write_file"],
      ["terminal", "terminal"],
      ["skills", "skill_manage"],
    ]) {
      const root = await makeExpertRoot();
      await writeFile(
        join(root, "config.yaml"),
        `toolsets: [${toolset}]\nplatform_toolsets:\n  cli: [${toolset}, no_mcp]\ncoding_context: off\nagent:\n  disabled_toolsets: [browser, code_execution, file, skills, terminal]\nplugins:\n  enabled: []\napprovals:\n  mode: manual\n`
      );
      const result = await validateExpert(root);
      expect(result.errors.join("\n")).toContain(
        `Unsafe standalone Hermes toolset: ${toolset} expands to forbidden tools`
      );
      expect(result.errors.join("\n")).toContain(forbiddenTool);
    }
  });

  it("warns without failing for high-risk permissions in hire.yaml", async () => {
    const root = await makeExpertRoot();
    await writeFile(
      join(root, "hire.yaml"),
      makeHireYaml({
        permissions: ["mailbox:send", "files:delete", "payments:charge"],
      })
    );

    const result = await validateExpert(root);

    expect(result.ok, result.errors.join("\n")).toBe(true);
    expect(result.warnings).toContain(
      "High-risk permissions declared in hire.yaml: mailbox:send, files:delete, payments:charge"
    );
  });

  it("fails when required files, forbidden local state, frontmatter, or secrets are present", async () => {
    const missingSoul = await makeExpertRoot();
    await rm(join(missingSoul, "SOUL.md"));
    expect((await validateExpert(missingSoul)).errors).toContain(
      "Missing required file: SOUL.md"
    );

    const envLeak = await makeExpertRoot();
    await writeFile(join(envLeak, ".env"), "OPENAI_API_KEY=\n");
    expect((await validateExpert(envLeak)).errors).toContain(
      "Forbidden path found: .env"
    );

    const badSkill = await makeExpertRoot();
    await writeFile(
      join(badSkill, "skills", "review", "code-review-checklist", "SKILL.md"),
      "# Missing frontmatter\n"
    );
    expect((await validateExpert(badSkill)).errors).toContain(
      "Invalid skill frontmatter: skills/review/code-review-checklist/SKILL.md"
    );

    const skillDrift = await makeExpertRoot();
    await writeFile(
      join(skillDrift, "skills", "review", "code-review-checklist", "SKILL.md"),
      "---\nname: different-skill\ndescription: Use when testing manifest drift.\n---\n# Different\n"
    );
    expect((await validateExpert(skillDrift)).errors).toContain(
      "Skill manifest mismatch: missing SKILL.md=code-review-checklist; undeclared SKILL.md=different-skill"
    );

    const secretLeak = await makeExpertRoot();
    await writeFile(
      join(secretLeak, "README.md"),
      "Token ghp_123456789012345678901234567890123456\n"
    );
    expect(
      (await validateExpert(secretLeak)).errors.some(error =>
        error.includes("Potential secret")
      )
    ).toBe(true);

    const utf16SecretLeak = await makeExpertRoot();
    await writeFile(
      join(utf16SecretLeak, "NOTES.md"),
      Buffer.from(`TAVILY_API_KEY=tvly-prod-${"A".repeat(24)}`, "utf16le")
    );
    expect(
      (await validateExpert(utf16SecretLeak)).errors.some(error =>
        error.includes("Potential secret found: NOTES.md")
      )
    ).toBe(true);
  });

  it("rejects package paths that collide on case-insensitive filesystems", async () => {
    if (process.platform === "win32") return;
    const root = await makeExpertRoot();
    await mkdir(join(root, "Docs"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "Docs", "A.txt"), "first\n");
    await writeFile(join(root, "docs", "a.TXT"), "second\n");

    const result = await validateExpert(root);

    expect(
      result.errors.some(error =>
        error.includes("Case-folding package path collision")
      )
    ).toBe(true);
  });

  it("rejects a symlink or junction used as the direct validation root", async () => {
    const root = await makeExpertRoot();
    const container = await mkdtemp(join(tmpdir(), "crewclaw-validator-link-"));
    createdRoots.push(container);
    const linkedRoot = join(container, "linked-expert");
    await symlink(
      root,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await validateExpert(linkedRoot);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Expert root must not be a symlink or junction"
    );
  });

  it("rejects a symlink or junction nested inside a directly validated package", async () => {
    const root = await makeExpertRoot();
    const outside = await mkdtemp(
      join(tmpdir(), "crewclaw-validator-outside-")
    );
    createdRoots.push(outside);
    await symlink(
      outside,
      join(root, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await validateExpert(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Unsafe symlink or junction found: linked-outside"
    );
  });

  it("rejects a hardlink to a file outside a directly validated package", async () => {
    const root = await makeExpertRoot();
    const outside = await mkdtemp(
      join(tmpdir(), "crewclaw-validator-hardlink-")
    );
    createdRoots.push(outside);
    const outsideFile = join(outside, "outside.txt");
    await writeFile(outsideFile, "outside\n");
    await link(outsideFile, join(root, "hardlinked-outside.txt"));

    const result = await validateExpert(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Unsafe hardlink found: hardlinked-outside.txt"
    );
  });
});

describe("validateAllExperts", () => {
  it("passes the repository P0 experts", async () => {
    const result = await validateAllExperts();

    expect(result.ok).toBe(true);
    expect(result.results.map(entry => entry.name)).toEqual(
      expect.arrayContaining([
        "code-review-shrimp",
        "product-prd-crab",
        "macao-networking-agent",
      ])
    );
  });
});
