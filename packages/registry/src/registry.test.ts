import {
  mkdirSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseYaml } from "../../validator/src/index";
import {
  findExpert,
  getAvailableExperts,
  getExperts,
  loadRegistry,
  resolveExpertSource,
} from "./index";

const temporaryRoots: string[] = [];

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `crewclaw-${label}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe("expert registry", () => {
  it("loads the seven registry experts with five available profiles", () => {
    const experts = getExperts();

    expect(experts).toHaveLength(7);
    expect(getAvailableExperts().map(expert => expert.name)).toEqual([
      "code-review-shrimp",
      "product-prd-crab",
      "ai-adoption-whale",
      "zeneth",
      "macao-networking-agent",
    ]);
  });

  it("returns installation metadata for an available expert", () => {
    const expert = findExpert("code-review-shrimp");

    expect(expert?.status).toBe("available");
    expect(expert?.install_command).toContain(
      "pnpm dlx @chaogeek/hermes hire code-review-shrimp"
    );
    expect(expert?.local_install_command).toBe("pnpm --silent run crewclaw");
    expect(expert?.local_source).toBe("experts/code-review-shrimp");
  });

  it.each([
    "../../outside",
    "/tmp/outside",
    "C:\\outside",
    "experts/product-prd-crab",
  ])("rejects an available expert local_source of %s", localSource => {
    const root = temporaryRoot("registry-contract");
    const registry = structuredClone(loadRegistry());
    registry.experts[0].local_source = localSource;
    const registryFile = join(root, "experts.json");
    writeFileSync(registryFile, JSON.stringify(registry));

    expect(() => loadRegistry(registryFile)).toThrow(/local_source/);
  });

  it("requires coming-soon experts to keep local_source null", () => {
    const root = temporaryRoot("registry-coming-soon");
    const registry = structuredClone(loadRegistry());
    const comingSoon = registry.experts.find(
      expert => expert.status === "coming-soon"
    );
    expect(comingSoon).toBeDefined();
    comingSoon!.local_source = `experts/${comingSoon!.name}`;
    const registryFile = join(root, "experts.json");
    writeFileSync(registryFile, JSON.stringify(registry));

    expect(() => loadRegistry(registryFile)).toThrow(/local_source/);
  });

  it("resolves only a canonical, link-free expert directory", () => {
    const root = temporaryRoot("registry-source");
    const expert = structuredClone(findExpert("code-review-shrimp"));
    expect(expert).toBeDefined();
    const source = join(root, "experts", expert!.name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "hire.yaml"), "kind: Employee\n");

    expect(resolveExpertSource(root, expert!)).toBe(source);
  });

  it("rejects a junction or symlink used as the expert source", () => {
    const root = temporaryRoot("registry-source-link");
    const expert = structuredClone(findExpert("code-review-shrimp"));
    expect(expert).toBeDefined();
    const outside = join(root, "outside");
    const source = join(root, "experts", expert!.name);
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(root, "experts"), { recursive: true });
    symlinkSync(
      outside,
      source,
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(() => resolveExpertSource(root, expert!)).toThrow(/links|escapes/);
  });

  it("rejects a junction or symlink nested inside an expert package", () => {
    const root = temporaryRoot("registry-nested-link");
    const expert = structuredClone(findExpert("code-review-shrimp"));
    expect(expert).toBeDefined();
    const source = join(root, "experts", expert!.name);
    const outside = join(root, "outside");
    mkdirSync(source, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(
      outside,
      join(source, "nested"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(() => resolveExpertSource(root, expert!)).toThrow(/links|escapes/);
  });

  it("rejects a hardlink to a file outside the expert package", () => {
    const root = temporaryRoot("registry-hardlink");
    const expert = structuredClone(findExpert("code-review-shrimp"));
    expect(expert).toBeDefined();
    const source = join(root, "experts", expert!.name);
    const outside = join(root, "outside.txt");
    mkdirSync(source, { recursive: true });
    writeFileSync(outside, "outside\n");
    linkSync(outside, join(source, "README.md"));

    expect(() => resolveExpertSource(root, expert!)).toThrow(/hardlinks/);
  });

  it("parses inline object array items as objects", () => {
    const parsed = parseYaml(
      [
        "runtime:",
        "  permissions:",
        "    - scope: public_web",
        "      action: read",
        "      level: allow",
      ].join("\n")
    );

    expect(parsed).toEqual({
      runtime: {
        permissions: [{ scope: "public_web", action: "read", level: "allow" }],
      },
    });
  });
});
