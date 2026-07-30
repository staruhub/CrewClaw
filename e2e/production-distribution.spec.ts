import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const repoRoot = process.cwd();

test.use({ locale: "en-US" });

function cliExecutable() {
  const filename =
    process.platform === "win32" ? "crewclaw-cli.exe" : "crewclaw-cli";
  const candidates = [
    process.env.CREWCLAW_E2E_CLI,
    join(repoRoot, "crates", "crewclaw-cli", "target", "release", filename),
    join(repoRoot, "crates", "crewclaw-cli", "target", "debug", filename),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "CrewClaw CLI binary is missing; run cargo build before browser E2E"
    );
  }
  return executable;
}

type CommandResult = { code: number; stdout: string; stderr: string };

function runCli(root: string, args: string[]): Promise<CommandResult> {
  return new Promise(resolve => {
    const command = cliExecutable();
    const commandArgs = args;
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CREWCLAW_ROOT: root,
        FORCE_COLOR: "0",
        PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill("SIGTERM");
      }
    }, 180_000);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      clearTimeout(timer);
      finish({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", code => {
      clearTimeout(timer);
      finish({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut && !stderr ? "Command timed out" : stderr,
      });
    });
  });
}

function prepareCliRoot(root: string) {
  cpSync(join(repoRoot, "registry"), join(root, "registry"), {
    recursive: true,
  });
  mkdirSync(join(root, "contracts"), { recursive: true });
  cpSync(
    join(repoRoot, "contracts", "tool-catalog.json"),
    join(root, "contracts", "tool-catalog.json")
  );
  mkdirSync(join(root, "packages", "runtime"), { recursive: true });
  cpSync(
    join(repoRoot, "packages", "runtime", "import-employee-package.mjs"),
    join(root, "packages", "runtime", "import-employee-package.mjs")
  );
  cpSync(
    join(repoRoot, "packages", "runtime", "employee-package-validator.mjs"),
    join(root, "packages", "runtime", "employee-package-validator.mjs")
  );
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const callsFile = join(root, "hermes-calls.txt");
  const hermesPath = join(
    bin,
    process.platform === "win32" ? "hermes.cmd" : "hermes"
  );
  writeFileSync(
    hermesPath,
    process.platform === "win32"
      ? `@echo off\r\necho %*>>"${callsFile}"\r\necho installed\r\nexit /b 0\r\n`
      : `#!/bin/sh\nprintf '%s\\n' "$*" >> "${callsFile}"\necho installed\n`
  );
  if (process.platform !== "win32") chmodSync(hermesPath, 0o755);
  return callsFile;
}

function writeTarText(
  buffer: Buffer,
  offset: number,
  length: number,
  value: string
) {
  buffer.write(value.slice(0, length), offset, length, "utf8");
}

function traversalArchive() {
  const content = Buffer.from("must not escape", "utf8");
  const header = Buffer.alloc(512, 0);
  writeTarText(header, 0, 100, "../escape.txt");
  writeTarText(header, 100, 8, "0000644\0");
  writeTarText(header, 108, 8, "0000000\0");
  writeTarText(header, 116, 8, "0000000\0");
  writeTarText(
    header,
    124,
    12,
    `${content.length.toString(8).padStart(11, "0")}\0`
  );
  writeTarText(header, 136, 12, "00000000000\0");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarText(header, 257, 6, "ustar\0");
  writeTarText(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return gzipSync(
    Buffer.concat([header, content, padding, Buffer.alloc(1024, 0)])
  );
}

test("production Landing v4 exposes truthful hire handoff and evaluation provenance", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400) {
      httpErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");

  await expect(
    page.getByText("crew hire ai-adoption-whale --live --yes", { exact: true })
  ).toBeVisible({ timeout: 10_000 });

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("pnpm dlx @chaogeek/hermes");
  expect(body).not.toContain("pnpm --silent -C");
  expect(body).toContain("crew hire ai-adoption-whale --live --yes");
  await expect(
    page.getByRole("heading", { name: "Hire AI like you hire people." })
  ).toBeVisible();

  await page.goto("/employee/code-review-shrimp");
  const detailBody = await page.locator("body").innerText();
  expect(detailBody).not.toContain("pnpm dlx @chaogeek/hermes");
  await expect(
    page.getByText(
      /no registry-published (?:signed )?mock:false (?:lab credential|evaluation)/i
    )
  ).toBeVisible();

  await page.goto("/hire/ai-adoption-whale");
  await expect(
    page.getByRole("button", { name: "Pass Doctor and accept trial first" })
  ).toBeDisabled();
  await page.getByRole("button", { name: "Run Doctor", exact: true }).click();
  await expect(page.getByText(/Doctor passed/i)).toBeVisible();
  await page
    .getByRole("button", { name: "Run bounded trial", exact: true })
    .click();
  await page.getByRole("button", { name: "Accept trial", exact: true }).click();
  await page
    .getByRole("button", { name: "Activate local hire", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finish hiring on this machine." })
  ).toBeVisible();
  expect(await page.locator("body").innerText()).toContain("crew hire --from");
  await page
    .getByRole("button", { name: "Hire on this machine", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: /AI Adoption Whale is on your local roster/i,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Continue in the employee workbench",
    })
  ).toBeVisible();
  await expect(page.getByText("Hired locally", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /crew run ai-adoption-whale 'Prepare a practical AI adoption plan.*--tui/
    )
  ).toBeVisible();

  expect(consoleErrors, httpErrors.join("\n")).toEqual([]);
});

test("production serves the downloadable employee package through Hono", async ({
  request,
}) => {
  const metadataResponse = await request.get(
    "/api/employees/ai-adoption-whale/package?meta=1"
  );
  expect(metadataResponse.status()).toBe(200);
  expect(metadataResponse.headers()["content-type"]).toContain(
    "application/json"
  );
  expect(metadataResponse.headers()["etag"]).toMatch(/^"[a-f0-9]{64}"$/);
  expect(metadataResponse.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate"
  );

  const metadata = (await metadataResponse.json()) as {
    slug: string;
    filename: string;
    version: string;
    sha256: string;
    files: string[];
  };
  expect(metadata.slug).toBe("ai-adoption-whale");
  expect(metadata.filename).toBe(
    `ai-adoption-whale-${metadata.version}.tar.gz`
  );
  expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(metadata.files).toEqual(
    expect.arrayContaining([
      "hire.yaml",
      "crewclaw.employee.yaml",
      "distribution.yaml",
      "SOUL.md",
    ])
  );

  const packageResponse = await request.get(
    "/api/employees/ai-adoption-whale/package"
  );
  expect(packageResponse.status()).toBe(200);
  const headers = packageResponse.headers();
  expect(headers["content-type"]).toContain("application/gzip");
  expect(headers["content-disposition"]).toBe(
    `attachment; filename="${metadata.filename}"`
  );
  expect(headers["x-checksum-sha256"]).toBe(metadata.sha256);

  const archive = await packageResponse.body();
  expect([...archive.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  expect(createHash("sha256").update(archive).digest("hex")).toBe(
    metadata.sha256
  );

  const notModified = await request.get(
    "/api/employees/ai-adoption-whale/package",
    { headers: { "If-None-Match": `"${metadata.sha256}"` } }
  );
  expect(notModified.status()).toBe(304);
  expect((await notModified.body()).length).toBe(0);
});

test("production package endpoint returns 404 for an unknown employee", async ({
  request,
}) => {
  const response = await request.get(
    "/api/employees/employee-that-does-not-exist/package?meta=1"
  );
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringMatching(/unknown employee/i),
  });
});

test("downloaded package imports through CLI, records provenance, and rejects traversal", async ({
  request,
}) => {
  test.setTimeout(360_000);
  const metadataResponse = await request.get(
    "/api/employees/ai-adoption-whale/package?meta=1"
  );
  expect(metadataResponse.status()).toBe(200);
  const metadata = (await metadataResponse.json()) as {
    filename: string;
    sha256: string;
  };
  const packageResponse = await request.get(
    "/api/employees/ai-adoption-whale/package"
  );
  expect(packageResponse.status()).toBe(200);
  const archive = await packageResponse.body();

  const root = mkdtempSync(join(tmpdir(), "crewclaw-package-import-e2e-"));
  const hostileRoot = mkdtempSync(
    join(tmpdir(), "crewclaw-package-traversal-e2e-")
  );
  try {
    const callsFile = prepareCliRoot(root);
    const archivePath = join(root, metadata.filename);
    writeFileSync(archivePath, archive);
    const profileName = `package-e2e-${Date.now()}`;
    const install = await runCli(root, [
      "hire",
      "--from",
      archivePath,
      "--sha256",
      metadata.sha256,
      "--name",
      profileName,
      "--yes",
      "--live",
    ]);

    expect(install.code, install.stderr || install.stdout).toBe(0);
    expect(readFileSync(callsFile, "utf8")).toContain("profile install");
    expect(
      existsSync(
        join(root, "experts", "ai-adoption-whale", "crewclaw.employee.yaml")
      )
    ).toBe(true);
    const team = JSON.parse(
      readFileSync(join(root, ".crewclaw", "team.json"), "utf8")
    ) as Array<{
      employee_id: string;
      status: string;
      hire_source?: string;
      package_sha256?: string;
    }>;
    expect(team).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employee_id: "ai-adoption-whale",
          status: "active",
          hire_source: "website",
          package_sha256: metadata.sha256,
        }),
      ])
    );

    prepareCliRoot(hostileRoot);
    const hostileArchive = traversalArchive();
    const hostilePath = join(hostileRoot, "traversal.tar.gz");
    writeFileSync(hostilePath, hostileArchive);
    const hostileSha = createHash("sha256")
      .update(hostileArchive)
      .digest("hex");
    const rejected = await runCli(hostileRoot, [
      "hire",
      "--from",
      hostilePath,
      "--sha256",
      hostileSha,
      "--yes",
      "--live",
    ]);
    expect(rejected.code).not.toBe(0);
    expect(`${rejected.stdout}\n${rejected.stderr}`).toMatch(
      /path|archive|traversal|escape/i
    );
    expect(existsSync(join(hostileRoot, "escape.txt"))).toBe(false);
    expect(existsSync(join(hostileRoot, ".crewclaw", "team.json"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(hostileRoot, { recursive: true, force: true });
  }
});
