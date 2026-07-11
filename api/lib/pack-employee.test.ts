import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsForbiddenSecret,
  portablePathComparisonKey,
} from "../../contracts/forbidden-paths";
import {
  buildEmployeePackage,
  employeePackageMetadata,
  isForbiddenPackagePath,
  loadPrebuiltEmployeePackage,
  validateTarEntryName,
} from "./pack-employee";

const repoRoot = path.resolve(__dirname, "../..");

function packageFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "crewclaw-pack-root-"));
  const root = path.join(fixture, "workspace");
  const outside = path.join(fixture, "outside");
  fs.mkdirSync(path.join(root, "registry"), { recursive: true });
  fs.mkdirSync(path.join(root, "experts"), { recursive: true });
  fs.mkdirSync(path.join(root, "experts", "code-review-shrimp"), {
    recursive: true,
  });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "must not ship");
  const registry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "registry", "experts.json"), "utf8")
  );
  return {
    root,
    outside,
    cleanup() {
      fs.rmSync(fixture, { recursive: true, force: true });
    },
    setSource(source: string) {
      const expert = registry.experts.find(
        (entry: { name: string }) => entry.name === "code-review-shrimp"
      );
      expert.local_source = source;
      fs.writeFileSync(
        path.join(root, "registry", "experts.json"),
        JSON.stringify(registry)
      );
    },
  };
}

describe("isForbiddenPackagePath", () => {
  it("excludes local secrets/state, keeps shippable files", () => {
    // The security boundary: no local secrets/state may ever enter a downloadable package.
    for (const forbidden of [
      ".env",
      ".env.local",
      ".env.production",
      ".envrc",
      "auth.json",
      ".claude/settings.local.json",
      ".direnv/environment",
      ".git/config",
      "credentials-prod.json",
      "secrets.production.yaml",
      "service-account.local.json",
      "certs/client.pem",
      "kubeconfig",
      "certificate.p12",
      ".crewclaw/eval/result.json",
      ".sessions/last.json",
      "sessions/last.json",
      "memory/fact.md",
      "memories/x.md",
      "state.db",
      "state.db-wal",
      "logs/run.log",
    ]) {
      expect(isForbiddenPackagePath(forbidden), forbidden).toBe(true);
    }
    for (const allowed of [
      "SOUL.md",
      "hire.yaml",
      "crewclaw.employee.yaml",
      ".env.EXAMPLE",
      "skills/review/SKILL.md",
      "config.yaml",
    ]) {
      expect(isForbiddenPackagePath(allowed), allowed).toBe(false);
    }
  });

  it("recognizes common cloud, source-control, package, and chat credential shapes", () => {
    for (const secret of [
      `AKIA${"A".repeat(16)}`,
      `AIza${"A".repeat(35)}`,
      `xoxb-${"1".repeat(12)}-${"A".repeat(24)}`,
      `glpat-${"A".repeat(24)}`,
      `npm_${"A".repeat(36)}`,
      `sk_live_${"A".repeat(24)}`,
      `AWS_SECRET_ACCESS_KEY=${"A".repeat(40)}`,
      `TAVILY_API_KEY=tvly-prod-${"A".repeat(24)}`,
      `SERPER_API_KEY=${"A".repeat(32)}`,
      "DATABASE_URL=postgres://admin:CorrectHorseBatteryStaple@db/prod",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    ]) {
      expect(containsForbiddenSecret(`credential: ${secret}`), secret).toBe(
        true
      );
    }
    expect(
      containsForbiddenSecret(
        Buffer.from(`TAVILY_API_KEY=tvly-prod-${"B".repeat(24)}`, "utf16le")
      )
    ).toBe(true);
    for (const placeholder of [
      "TAVILY_API_KEY=${TAVILY_API_KEY}",
      "SERPER_API_KEY=<your-key>",
      "DATABASE_URL=placeholder",
    ]) {
      expect(containsForbiddenSecret(placeholder), placeholder).toBe(false);
    }
  });

  it("rejects traversal, platform separator, absolute, and control-character tar names", () => {
    for (const unsafe of [
      "../payload",
      "safe/../../payload",
      "..\\..\\payload",
      "/absolute",
      "C:/absolute",
      "safe//payload",
      "safe/./payload",
      "safe/line\nbreak",
      "CON",
      "aux.txt",
      "safe/trailing.",
      "safe/trailing ",
      "safe/file:stream",
    ]) {
      expect(() => validateTarEntryName(unsafe), unsafe).toThrow(
        /unsafe tar entry name/
      );
    }
    expect(() => validateTarEntryName("safe/nested/file.md")).not.toThrow();
    expect(portablePathComparisonKey("Dir/A.txt")).toBe(
      portablePathComparisonKey("dir/a.TXT")
    );
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
    expect(pkg.files.some(f => isForbiddenPackagePath(f))).toBe(false);

    // It's real gzip (magic 0x1f 0x8b) and untars to a non-empty POSIX tar.
    expect(pkg.gzip[0]).toBe(0x1f);
    expect(pkg.gzip[1]).toBe(0x8b);
    const tar = gunzipSync(pkg.gzip);
    expect(tar.length % 512).toBe(0);
    expect(tar.includes(Buffer.from("ai-adoption-whale/SOUL.md"))).toBe(true);

    // Deterministic: same inputs → same checksum (a stable download URL can be cached/verified).
    expect(buildEmployeePackage(repoRoot, "ai-adoption-whale").sha256).toBe(
      pkg.sha256
    );
  });

  it("produces the same archive after source file mtimes change", () => {
    const fixture = packageFixture();
    const sourceFile = path.join(
      fixture.root,
      "experts",
      "code-review-shrimp",
      "SOUL.md"
    );
    try {
      fs.writeFileSync(sourceFile, "same package content\n");
      fixture.setSource("experts/code-review-shrimp");

      fs.utimesSync(
        sourceFile,
        new Date("2001-01-01T00:00:00Z"),
        new Date("2001-01-01T00:00:00Z")
      );
      const first = buildEmployeePackage(fixture.root, "code-review-shrimp");

      fs.utimesSync(
        sourceFile,
        new Date("2038-01-01T00:00:00Z"),
        new Date("2038-01-01T00:00:00Z")
      );
      const second = buildEmployeePackage(fixture.root, "code-review-shrimp");

      expect(second.sha256).toBe(first.sha256);
      expect(second.gzip.equals(first.gzip)).toBe(true);
      const tar = gunzipSync(second.gzip);
      expect(
        Number.parseInt(tar.toString("ascii", 136, 148).replace(/\0.*$/, ""), 8)
      ).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a package file hardlinked to content outside the employee root", () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.linkSync(
        path.join(fixture.outside, "secret.txt"),
        path.join(
          fixture.root,
          "experts",
          "code-review-shrimp",
          "linked-secret.txt"
        )
      );

      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/cannot contain hardlink/);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects credential content even when it uses an innocuous filename", () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.writeFileSync(
        path.join(fixture.root, "experts", "code-review-shrimp", "notes.txt"),
        "accidentally pasted: ghp_123456789012345678901234567890123456\n"
      );

      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/contains potential secret: notes\.txt/);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects UTF-16 credential content before packaging", () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.writeFileSync(
        path.join(fixture.root, "experts", "code-review-shrimp", "notes.txt"),
        Buffer.from(`TAVILY_API_KEY=tvly-prod-${"B".repeat(24)}`, "utf16le")
      );

      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/contains potential secret: notes\.txt/);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed on forbidden state paths instead of silently making an incomplete package", () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.writeFileSync(
        path.join(fixture.root, "experts", "code-review-shrimp", ".env.local"),
        "SAFE_PLACEHOLDER=1\n"
      );

      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/contains forbidden path: \.env\.local/);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an oversized package file before reading it into memory", () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      const oversized = path.join(
        fixture.root,
        "experts",
        "code-review-shrimp",
        "oversized.bin"
      );
      fs.writeFileSync(oversized, "");
      fs.truncateSync(oversized, 8 * 1024 * 1024 + 1);

      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/file exceeds size limit: oversized\.bin/);
    } finally {
      fixture.cleanup();
    }
  });

  it("loads verified build artifacts and rejects a linked production package root", async () => {
    const fixture = packageFixture();
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.writeFileSync(
        path.join(fixture.root, "experts", "code-review-shrimp", "SOUL.md"),
        "safe package\n"
      );
      const pkg = buildEmployeePackage(fixture.root, "code-review-shrimp");
      const output = path.join(fixture.root, "dist", "employee-packages");
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(output, "code-review-shrimp.json"),
        JSON.stringify(employeePackageMetadata("code-review-shrimp", pkg))
      );
      fs.writeFileSync(
        path.join(output, "code-review-shrimp.tar.gz"),
        pkg.gzip
      );

      const loaded = await loadPrebuiltEmployeePackage(
        fixture.root,
        "code-review-shrimp"
      );
      expect(loaded.sha256).toBe(pkg.sha256);
      expect(loaded.gzip.equals(pkg.gzip)).toBe(true);

      fs.writeFileSync(
        path.join(output, "code-review-shrimp.json"),
        JSON.stringify({
          ...employeePackageMetadata("code-review-shrimp", pkg),
          files: [...pkg.files, "Docs/A.txt", "docs/a.TXT"],
        })
      );
      await expect(
        loadPrebuiltEmployeePackage(fixture.root, "code-review-shrimp")
      ).rejects.toThrow(/invalid prebuilt employee package metadata/);

      const linkedFixture = packageFixture();
      try {
        fs.mkdirSync(path.join(linkedFixture.root, "dist"), {
          recursive: true,
        });
        fs.symlinkSync(
          linkedFixture.outside,
          path.join(linkedFixture.root, "dist", "employee-packages"),
          process.platform === "win32" ? "junction" : "dir"
        );
        await expect(
          loadPrebuiltEmployeePackage(linkedFixture.root, "code-review-shrimp")
        ).rejects.toThrow(/unsafe prebuilt employee package root/);
      } finally {
        linkedFixture.cleanup();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects tar entry names longer than 100 UTF-8 bytes without truncating", () => {
    const fixture = packageFixture();
    const utf8Filename = `${"测".repeat(28)}.md`;
    try {
      fixture.setSource("experts/code-review-shrimp");
      fs.writeFileSync(
        path.join(fixture.root, "experts", "code-review-shrimp", utf8Filename),
        "must not be archived under a truncated name\n"
      );

      expect(utf8Filename.length).toBeLessThan(100);
      expect(
        Buffer.byteLength(`code-review-shrimp/${utf8Filename}`, "utf8")
      ).toBeGreaterThan(100);
      expect(() =>
        buildEmployeePackage(fixture.root, "code-review-shrimp")
      ).toThrow(/tar entry name exceeds 100 UTF-8 bytes/);
    } finally {
      fixture.cleanup();
    }
  });

  it("404s an unknown or coming-soon employee instead of leaking a path", () => {
    expect(() => buildEmployeePackage(repoRoot, "no-such-employee")).toThrow(
      /unknown employee/
    );
    // docs-octopus is coming-soon (local_source null) — no package to build.
    expect(() => buildEmployeePackage(repoRoot, "docs-octopus")).toThrow(
      /no local package|unknown/
    );
  });

  it("rejects lexical, absolute, and cross-employee local_source escapes", () => {
    const fixture = packageFixture();
    const unsafeSource =
      /local_source must equal experts\/code-review-shrimp|escapes experts root|must resolve to experts\/code-review-shrimp/;
    fixture.setSource("../outside");
    expect(() =>
      buildEmployeePackage(fixture.root, "code-review-shrimp")
    ).toThrow(unsafeSource);

    fixture.setSource(fixture.outside);
    expect(() =>
      buildEmployeePackage(fixture.root, "code-review-shrimp")
    ).toThrow(unsafeSource);

    const other = path.join(fixture.root, "experts", "product-prd-crab");
    fs.mkdirSync(other, { recursive: true });
    fixture.setSource("experts/product-prd-crab");
    expect(() =>
      buildEmployeePackage(fixture.root, "code-review-shrimp")
    ).toThrow(unsafeSource);

    const expected = path.join(fixture.root, "experts", "code-review-shrimp");
    fs.rmSync(expected, { recursive: true });
    fs.symlinkSync(
      fixture.outside,
      expected,
      process.platform === "win32" ? "junction" : "dir"
    );
    fixture.setSource("experts/code-review-shrimp");
    expect(() =>
      buildEmployeePackage(fixture.root, "code-review-shrimp")
    ).toThrow(/cannot be a symlink/);
  });
});
