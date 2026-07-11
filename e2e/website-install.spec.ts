import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, test } from "@playwright/test";

// Read the registry via fs (not a JSON import) so this stays loader-agnostic under Playwright's
// ESM runner, which requires an explicit import attribute for JSON modules.
const registry = JSON.parse(
  readFileSync(new URL("../registry/experts.json", import.meta.url), "utf8")
) as { experts: unknown[] };

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const repoRoot = process.cwd();

function quoteShellArgument(value: string) {
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function normalizeRecordedCommand(value: string) {
  return value.replaceAll("\\", "/").replaceAll(/\/\/\?\/(?=[A-Za-z]:\/)/g, "");
}

function run(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, FORCE_COLOR: "0", ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: stderr || "Command timed out" });
    }, options.timeoutMs ?? 90_000);

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test.describe.configure({ mode: "serial" });

test("homepage exposes CrewClaw CLI docs and clickable flows", async ({
  context,
  page,
  isMobile,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  expect(await page.title()).toMatch(/CrewClaw/);
  await expect(
    page.getByText("Hire ChaoGeek-certified Hermes experts in 60 seconds")
  ).toBeVisible();

  await page.getByRole("button", { name: /view expert crew/i }).click();
  await expect(page.locator("#market")).toBeInViewport();

  await page.getByRole("button", { name: /hire your first expert/i }).click();
  await expect(
    page.getByRole("dialog", { name: /join the waitlist/i })
  ).toBeVisible();
  await page.getByRole("button", { name: /close waitlist/i }).click();
  await expect(
    page.getByRole("dialog", { name: /join the waitlist/i })
  ).toBeHidden();

  if (isMobile) {
    await page.getByRole("button", { name: /open navigation menu/i }).click();
    await page.getByRole("button", { name: "Pricing" }).click();
  } else {
    await page.getByRole("button", { name: "Pricing" }).click();
  }
  await expect(page.locator("#pricing")).toBeInViewport();
  await page.getByRole("button", { name: /contact us/i }).click();
  await expect(page.getByRole("dialog", { name: /contact us/i })).toBeVisible();
  await page.getByRole("button", { name: /close contact/i }).click();
  await expect(page.getByRole("dialog", { name: /contact us/i })).toBeHidden();

  await page.getByRole("button", { name: "FAQ" }).click();
  await expect(page.locator("#faq")).toBeInViewport();
  await page.getByRole("button", { name: /how do i get started/i }).click();
  await expect(page.getByText(/Install Hermes, copy/)).toBeVisible();

  await page.getByRole("button", { name: "Install Flow" }).click();
  await expect(page.locator("#how-it-works")).toBeInViewport();
  await expect(page.getByText("CrewClaw CLI Docs")).toBeVisible();
  await expect(page.getByText("Command-line hiring path")).toBeVisible();

  const cards = page.locator("#market article");
  // One card per registry expert (registry/experts.json). Kept in sync with the registry rather
  // than a frozen literal — it grew from 4 to 7 and this assertion was never updated.
  const expectedCardCount = registry.experts.length;
  await expect(cards).toHaveCount(expectedCardCount);

  const shrimp = cards.filter({ hasText: "Code Review Shrimp" });
  await expect(shrimp.getByText("Available")).toBeVisible();
  const command = (await shrimp.locator("code").innerText()).trim();
  expect(command).toBe(
    `pnpm --silent -C ${quoteShellArgument(repoRoot)} run crewclaw`
  );

  await shrimp.getByRole("button", { name: /copy crewclaw cli/i }).click();
  await expect(
    shrimp.getByRole("button", { name: /copied crewclaw cli/i })
  ).toBeVisible();
  await expect(
    page.evaluate(() => navigator.clipboard.readText())
  ).resolves.toBe(command);

  const docsOctopus = cards.filter({ hasText: "Docs Octopus" });
  await expect(docsOctopus.getByText("Coming Soon")).toBeVisible();
  await expect(docsOctopus.locator("code")).toContainText("Join waitlist");
  await docsOctopus.getByRole("button", { name: /join waitlist/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("copied website command hires a temporary Hermes profile end to end", async ({
  page,
}) => {
  await page.goto("/");

  const shrimp = page
    .locator("#market article")
    .filter({ hasText: "Code Review Shrimp" });
  const command = (await shrimp.locator("code").innerText()).trim();
  expect(command).toBe(
    `pnpm --silent -C ${quoteShellArgument(repoRoot)} run crewclaw`
  );

  const profileName = `crewclaw-e2e-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), "crewclaw-web-install-"));
  const bin = join(root, "bin");
  const callsFile = join(root, "hermes-calls.txt");
  mkdirSync(bin, { recursive: true });
  cpSync(join(repoRoot, "registry"), join(root, "registry"), {
    recursive: true,
  });
  cpSync(join(repoRoot, "experts"), join(root, "experts"), {
    recursive: true,
  });
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

  try {
    const copiedArgs = [
      "--silent",
      "-C",
      repoRoot,
      "run",
      "crewclaw",
      "hire",
      "code-review-shrimp",
      "--name",
      profileName,
      "--yes",
      "--live",
    ];
    const commandExecutable =
      process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "pnpm";
    const executableArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "pnpm", ...copiedArgs]
        : copiedArgs;
    const install = await run(commandExecutable, executableArgs, {
      cwd: homedir(),
      timeoutMs: 120_000,
      env: {
        CREWCLAW_ROOT: root,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
    expect(install.code, install.stderr || install.stdout).toBe(0);
    expect(`${install.stdout}\n${install.stderr}`).toContain(
      "Hiring Code Review Shrimp"
    );
    expect(`${install.stdout}\n${install.stderr}`).not.toContain(
      "CrewClaw: ======"
    );
    expect(`${install.stdout}\n${install.stderr}`).not.toContain(
      "CrewClaw: Choose"
    );
    expect(`${install.stdout}\n${install.stderr}`).not.toContain(
      "> @chaogeek/hermes"
    );
    expect(`${install.stdout}\n${install.stderr}`).toContain(
      "Run this first Hermes test"
    );

    const calls = normalizeRecordedCommand(readFileSync(callsFile, "utf8"));
    expect(calls).toContain(
      `profile install ${root.replaceAll("\\", "/")}/experts/code-review-shrimp --name ${profileName} --alias --yes`
    );
    const team = JSON.parse(
      readFileSync(join(root, ".crewclaw", "team.json"), "utf8")
    ) as Array<{ employee_id: string; status: string }>;
    expect(team).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employee_id: "code-review-shrimp",
          status: "active",
        }),
      ])
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
