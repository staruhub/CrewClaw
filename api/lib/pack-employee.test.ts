import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEmployeePackage, isForbiddenPackagePath } from "./pack-employee";

const repoRoot = path.resolve(__dirname, "../..");

describe("isForbiddenPackagePath", () => {
  it("excludes local secrets/state, keeps shippable files", () => {
    // The security boundary: no local secrets/state may ever enter a downloadable package.
    for (const forbidden of [".env", "auth.json", "sessions/last.json", "memories/x.md", "state.db", "state.db-wal", "logs/run.log"]) {
      expect(isForbiddenPackagePath(forbidden), forbidden).toBe(true);
    }
    for (const allowed of ["SOUL.md", "hire.yaml", "crewclaw.employee.yaml", ".env.EXAMPLE", "skills/review/SKILL.md", "config.yaml"]) {
      expect(isForbiddenPackagePath(allowed), allowed).toBe(false);
    }
  });
});

describe("buildEmployeePackage", () => {
  it("builds a valid, deterministic gzipped tar of a real employee with no forbidden files", () => {
    const pkg = buildEmployeePackage(repoRoot, "ai-adoption-whale");

    expect(pkg.filename).toBe("ai-adoption-whale-0.2.0.tar.gz");
    expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The two-file standard ships inside the package.
    expect(pkg.files).toContain("hire.yaml");
    expect(pkg.files).toContain("crewclaw.employee.yaml");
    expect(pkg.files).toContain("SOUL.md");
    // No local secret/state leaked in.
    expect(pkg.files.some((f) => isForbiddenPackagePath(f))).toBe(false);

    // It's real gzip (magic 0x1f 0x8b) and untars to a non-empty POSIX tar.
    expect(pkg.gzip[0]).toBe(0x1f);
    expect(pkg.gzip[1]).toBe(0x8b);
    const tar = gunzipSync(pkg.gzip);
    expect(tar.length % 512).toBe(0);
    expect(tar.includes(Buffer.from("ai-adoption-whale/SOUL.md"))).toBe(true);

    // Deterministic: same inputs → same checksum (a stable download URL can be cached/verified).
    expect(buildEmployeePackage(repoRoot, "ai-adoption-whale").sha256).toBe(pkg.sha256);
  });

  it("404s an unknown or coming-soon employee instead of leaking a path", () => {
    expect(() => buildEmployeePackage(repoRoot, "no-such-employee")).toThrow(/unknown employee/);
    // docs-octopus is coming-soon (local_source null) — no package to build.
    expect(() => buildEmployeePackage(repoRoot, "docs-octopus")).toThrow(/no local package|unknown/);
  });
});
