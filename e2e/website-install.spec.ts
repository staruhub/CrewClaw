import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, test } from "@playwright/test";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const repoRoot = process.cwd();
const landingCommand = "pnpm run crewclaw -- hire ai-adoption-whale --yes";

test.use({ locale: "en-US" });

function normalizeRecordedCommand(value: string) {
  return value.replaceAll("\\", "/").replaceAll(/\/\/\?\/(?=[A-Za-z]:\/)/g, "");
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, FORCE_COLOR: "0", ...options.env },
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
    }, options.timeoutMs ?? 120_000);

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

test.describe.configure({ mode: "serial" });

test("Landing v4 exposes the real employee loop and a copyable CLI handoff", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  expect(await page.title()).toMatch(/CrewClaw/);
  await expect(
    page.getByRole("heading", { name: "Hire AI like you hire people." })
  ).toBeVisible();
  await expect(
    page.getByText("published employees", { exact: true })
  ).toBeVisible();
  await expect(page.locator("#paradigm")).toBeVisible();
  await expect(page.locator("#moat")).toBeVisible();
  await expect(page.locator("#runtime")).toBeVisible();
  await expect(page.getByText(landingCommand, { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Copy CrewClaw command" }).click();
  await expect(
    page.getByRole("button", { name: "Copy CrewClaw command" })
  ).toContainText("Copied");
  await expect(
    page.evaluate(() => navigator.clipboard.readText())
  ).resolves.toBe(landingCommand);

  await page.getByRole("link", { name: "Browse AI employees" }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(page.getByText("AI Adoption Whale").first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("the Landing hire command maps to a real CLI hire and atomic team record", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByText(landingCommand, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Copy CrewClaw command" }).click();
  const copiedCommand = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  expect(copiedCommand).toBe(landingCommand);

  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "crewclaw-web-install-"))
  );
  const bin = join(root, "bin");
  const callsFile = join(root, "hermes-calls.txt");
  mkdirSync(bin, { recursive: true });
  cpSync(join(repoRoot, "registry"), join(root, "registry"), {
    recursive: true,
  });
  cpSync(join(repoRoot, "experts"), join(root, "experts"), { recursive: true });
  mkdirSync(join(root, "contracts"), { recursive: true });
  cpSync(
    join(repoRoot, "contracts", "tool-catalog.json"),
    join(root, "contracts", "tool-catalog.json")
  );
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
    const pnpmCli = process.env.npm_execpath;
    if (!pnpmCli) {
      throw new Error(
        "pnpm did not expose npm_execpath to the source-command E2E"
      );
    }
    const commandParts = copiedCommand.split(/\s+/);
    expect(commandParts.slice(0, 4)).toEqual(["pnpm", "run", "crewclaw", "--"]);
    const install = await run(
      process.execPath,
      [pnpmCli, ...commandParts.slice(1)],
      {
        cwd: repoRoot,
        timeoutMs: 60_000,
        env: {
          CREWCLAW_ROOT: root,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        },
      }
    );

    expect(install.code, install.stderr || install.stdout).toBe(0);
    expect(`${install.stdout}\n${install.stderr}`).toContain(
      "Hiring AI 落地鲸"
    );
    const calls = normalizeRecordedCommand(readFileSync(callsFile, "utf8"));
    expect(calls).toContain(
      `profile install ${root.replaceAll("\\", "/")}/experts/ai-adoption-whale --name ai-adoption-whale --alias --yes`
    );
    const team = JSON.parse(
      readFileSync(join(root, ".crewclaw", "team.json"), "utf8")
    ) as Array<{ employee_id: string; status: string }>;
    expect(team).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employee_id: "ai-adoption-whale",
          status: "active",
        }),
      ])
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
