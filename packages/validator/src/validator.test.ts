import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { validateAllExperts, validateExpert } from "./index";

const createdRoots: string[] = [];

async function makeExpertRoot() {
  const root = await mkdtemp(join(tmpdir(), "crewclaw-validator-"));
  createdRoots.push(root);
  await mkdir(join(root, "skills", "review", "code-review-checklist"), { recursive: true });
  await writeFile(
    join(root, "distribution.yaml"),
    [
      "name: test-expert",
      "version: 0.1.0",
      "description: Test expert for validator coverage.",
      "hermes_requires: \">=0.12.0\"",
      "author: ChaoGeek / Pong",
      "license: Commercial Preview",
      "env_requires:",
      "  - name: OPENAI_API_KEY",
      "    description: Optional model provider key.",
      "    required: false",
      "    default: \"\"",
      "distribution_owned:",
      "  - SOUL.md",
      "  - config.yaml",
      "  - mcp.json",
      "  - skills/",
      "  - CERTIFICATION.md",
    ].join("\n"),
  );
  await writeFile(join(root, "README.md"), "# Test Expert\n");
  await writeFile(join(root, "SOUL.md"), "# Soul\nYou are a test expert.\n");
  await writeFile(join(root, "config.yaml"), "model:\n  default: \"\"\ntemperature: 0.2\n");
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({ mcp_servers: { github: { tools: { include: ["search_code"] } } } }, null, 2),
  );
  await writeFile(join(root, ".env.EXAMPLE"), "OPENAI_API_KEY=\n");
  await writeFile(join(root, "CERTIFICATION.md"), "# Certification\nC2\n");
  await writeFile(join(root, "EXAMPLES.md"), "# Examples\n\n## 1. First task\n\n## 2. Common workflow\n\n## 3. Advanced workflow\n");
  await writeFile(join(root, "EVALS.md"), "# Evals\n\ncase-001\ncase-002\ncase-003\n");
  await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n");
  await writeFile(
    join(root, "skills", "review", "code-review-checklist", "SKILL.md"),
    [
      "---",
      "name: code-review-checklist",
      "description: Use when reviewing a pull request for merge readiness.",
      "version: 0.1.0",
      "author: ChaoGeek / Pong",
      "license: Commercial Preview",
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
    ].join("\n"),
  );
  return root;
}

function makeHireYaml(overrides: { version?: string; permissions?: string[]; omitIdentity?: boolean } = {}) {
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
      "  location: Local",
    );
  }
  lines.push(
    "soul: Practical test expert.",
    "skills:",
    "  - code-review-checklist",
    "tools:",
    "  - browser",
    "permissions:",
    ...permissions.map((permission) => `  - ${permission}`),
    "requires:",
    "  hermes: \">=0.12.0\"",
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
    "  - test",
  );
  return lines.join("\n");
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validateExpert", () => {
  it("passes a complete Hermes expert distribution", async () => {
    const root = await makeExpertRoot();

    const result = await validateExpert(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates hire.yaml manifests with the shared EmployeeManifestSchema", async () => {
    const root = await makeExpertRoot();
    await writeFile(join(root, "hire.yaml"), makeHireYaml());

    const result = await validateExpert(root, {
      name: "test-expert",
      version: "0.1.0",
      local_source: root,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when hire.yaml is missing required manifest fields", async () => {
    const root = await makeExpertRoot();
    await writeFile(join(root, "hire.yaml"), makeHireYaml({ omitIdentity: true }));

    const result = await validateExpert(root);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith("Invalid hire.yaml:"))).toBe(true);
  });

  it("fails when registry name, version, or local_source disagree with hire.yaml", async () => {
    const root = await makeExpertRoot();
    await writeFile(join(root, "hire.yaml"), makeHireYaml({ version: "0.1.0" }));

    const result = await validateExpert(root, {
      name: "different-expert",
      version: "0.2.0",
      local_source: "experts/different-expert",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Registry name mismatch: registry=different-expert hire.yaml=test-expert");
    expect(result.errors).toContain("Registry version mismatch: registry=0.2.0 hire.yaml=0.1.0");
    expect(result.errors).toContain(`Registry local_source mismatch: registry=experts/different-expert package=${root}`);
  });

  it("warns without failing for high-risk permissions in hire.yaml", async () => {
    const root = await makeExpertRoot();
    await writeFile(join(root, "hire.yaml"), makeHireYaml({ permissions: ["mailbox:send", "files:delete", "payments:charge"] }));

    const result = await validateExpert(root);

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("High-risk permissions declared in hire.yaml: mailbox:send, files:delete, payments:charge");
  });

  it("fails when required files, forbidden local state, frontmatter, or secrets are present", async () => {
    const missingSoul = await makeExpertRoot();
    await rm(join(missingSoul, "SOUL.md"));
    expect((await validateExpert(missingSoul)).errors).toContain("Missing required file: SOUL.md");

    const envLeak = await makeExpertRoot();
    await writeFile(join(envLeak, ".env"), "OPENAI_API_KEY=\n");
    expect((await validateExpert(envLeak)).errors).toContain("Forbidden path found: .env");

    const badSkill = await makeExpertRoot();
    await writeFile(join(badSkill, "skills", "review", "code-review-checklist", "SKILL.md"), "# Missing frontmatter\n");
    expect((await validateExpert(badSkill)).errors).toContain(
      "Invalid skill frontmatter: skills/review/code-review-checklist/SKILL.md",
    );

    const secretLeak = await makeExpertRoot();
    await writeFile(join(secretLeak, "README.md"), "Token ghp_123456789012345678901234567890123456\n");
    expect((await validateExpert(secretLeak)).errors.some((error) => error.includes("Potential secret"))).toBe(true);
  });
});

describe("validateAllExperts", () => {
  it("passes the repository P0 experts", async () => {
    const result = await validateAllExperts();

    expect(result.ok).toBe(true);
    expect(result.results.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["code-review-shrimp", "product-prd-crab", "macao-networking-agent"]),
    );
  });
});
