import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEmployeePackage } from "./pack-employee";

const repoRoot = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const runtimeRoot = path.join(repoRoot, "packages", "runtime");
const slug = "code-review-shrimp";

function createRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, "registry"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "registry", "experts.json"),
    path.join(root, "registry", "experts.json")
  );
  const isolatedRuntime = path.join(root, "packages", "runtime");
  fs.mkdirSync(isolatedRuntime, { recursive: true });
  for (const file of [
    "import-employee-package.mjs",
    "employee-package-validator.mjs",
  ]) {
    fs.copyFileSync(
      path.join(runtimeRoot, file),
      path.join(isolatedRuntime, file)
    );
  }
  return root;
}

function writeArchive(root: string, gzip: Buffer) {
  const archive = path.join(root, "employee.tar.gz");
  fs.writeFileSync(archive, gzip);
  return archive;
}

function runImporter(root: string, archive: string, sha256?: string) {
  const importer = path.join(
    root,
    "packages",
    "runtime",
    "import-employee-package.mjs"
  );
  return spawnSync(process.execPath, [importer, root, archive, sha256 ?? "-"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function buildIncompletePackage() {
  const source = createRoot("crewclaw-import-source-");
  const employee = path.join(source, "experts", slug);
  fs.mkdirSync(employee, { recursive: true });
  for (const file of ["hire.yaml", "crewclaw.employee.yaml"]) {
    fs.copyFileSync(
      path.join(repoRoot, "experts", slug, file),
      path.join(employee, file)
    );
  }
  return { source, pkg: buildEmployeePackage(source, slug) };
}

describe("employee package importer", () => {
  it("ships a standalone validator without a production TypeScript loader", () => {
    expect(packageJson.dependencies?.tsx).toBeUndefined();
    expect(packageJson.devDependencies?.tsx).toBeTruthy();
  });

  it("requires a trusted SHA-256 before it touches the experts directory", () => {
    const root = createRoot("crewclaw-import-destination-");
    try {
      const pkg = buildEmployeePackage(repoRoot, slug);
      const result = runImporter(root, writeArchive(root, pkg.gzip));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "import-employee-package.mjs <root> <archive> <sha256>"
      );
      expect(fs.existsSync(path.join(root, "experts", slug))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete package with a correct digest before installation", () => {
    const root = createRoot("crewclaw-import-destination-");
    const { source, pkg } = buildIncompletePackage();
    try {
      const result = runImporter(
        root,
        writeArchive(root, pkg.gzip),
        pkg.sha256
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("full package validation failed");
      expect(result.stderr).toContain("Missing required file");
      expect(fs.existsSync(path.join(root, "experts", slug))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("installs a fully validated package with the trusted digest", () => {
    const root = createRoot("crewclaw-import-destination-");
    try {
      const pkg = buildEmployeePackage(repoRoot, slug);
      const result = runImporter(
        root,
        writeArchive(root, pkg.gzip),
        pkg.sha256
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        slug,
        version: pkg.version,
        sha256: pkg.sha256,
        installed: true,
      });
      expect(
        fs.existsSync(path.join(root, "experts", slug, "config.yaml"))
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
