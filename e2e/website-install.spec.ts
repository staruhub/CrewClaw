import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
};

const repoRoot = process.cwd();

function run(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function hermesProfileDetails(profileName: string) {
  const info = await run("hermes", ["profile", "info", profileName], { timeoutMs: 20_000 });
  if (info.code === 0) return info;
  return run("hermes", ["profile", "show", profileName], { timeoutMs: 20_000 });
}

async function deleteHermesProfile(profileName: string) {
  const attempts = [
    ["profile", "delete", profileName, "--yes"],
    ["profile", "delete", "-y", profileName],
    ["profile", "delete", profileName, "-y"],
  ];

  for (const args of attempts) {
    const result = await run("hermes", args, { timeoutMs: 20_000 });
    if (result.code === 0) return result;
  }
  return { code: 1, stdout: "", stderr: `Could not delete ${profileName}` };
}

test.describe.configure({ mode: "serial" });

test("homepage exposes CrewClaw CLI docs and clickable flows", async ({ context, page, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  expect(await page.title()).toMatch(/CrewClaw/);
  await expect(page.getByText("Hire ChaoGeek-certified Hermes experts in 60 seconds")).toBeVisible();

  await page.getByRole("button", { name: /view expert crew/i }).click();
  await expect(page.locator("#market")).toBeInViewport();

  await page.getByRole("button", { name: /hire your first expert/i }).click();
  await expect(page.getByRole("dialog", { name: /join the waitlist/i })).toBeVisible();
  await page.getByRole("button", { name: /close waitlist/i }).click();
  await expect(page.getByRole("dialog", { name: /join the waitlist/i })).toBeHidden();

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
  await expect(cards).toHaveCount(4);

  const shrimp = cards.filter({ hasText: "Code Review Shrimp" });
  await expect(shrimp.getByText("Available")).toBeVisible();
  const command = (await shrimp.locator("code").innerText()).trim();
  expect(command).toBe(`pnpm --silent -C ${repoRoot} run crewclaw`);

  await shrimp.getByRole("button", { name: /copy crewclaw cli/i }).click();
  await expect(shrimp.getByRole("button", { name: /copied crewclaw cli/i })).toBeVisible();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(command);

  const docsOctopus = cards.filter({ hasText: "Docs Octopus" });
  await expect(docsOctopus.getByText("Coming Soon")).toBeVisible();
  await expect(docsOctopus.locator("code")).toContainText("Join waitlist");
  await docsOctopus.getByRole("button", { name: /join waitlist/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("copied website command hires a temporary Hermes profile end to end", async ({ page }) => {
  await page.goto("/");

  const shrimp = page.locator("#market article").filter({ hasText: "Code Review Shrimp" });
  const command = (await shrimp.locator("code").innerText()).trim();
  const commandParts = command.split(/\s+/);
  expect(commandParts).toEqual(["pnpm", "--silent", "-C", repoRoot, "run", "crewclaw"]);

  const profileName = `crewclaw-e2e-${Date.now()}`;
  const hermes = await run("hermes", ["--version"], { timeoutMs: 60_000 });
  expect(hermes.code, hermes.stderr || hermes.stdout).toBe(0);

  const profiles = await run("hermes", ["profile", "list"], { timeoutMs: 60_000 });
  expect(profiles.code, profiles.stderr || profiles.stdout).toBe(0);
  expect(`${profiles.stdout}\n${profiles.stderr}`).not.toContain(profileName);

  try {
    const install = await run(commandParts[0], [...commandParts.slice(1), "--name", profileName, "--yes"], {
      cwd: "/Users/pongpong",
      input: "1\n",
      timeoutMs: 120_000,
    });
    expect(install.code, install.stderr || install.stdout).toBe(0);
    expect(`${install.stdout}\n${install.stderr}`).toContain("   _____                         _____ _");
    expect(`${install.stdout}\n${install.stderr}`).toContain("ChaoGeek AI Agent Hiring Platform");
    expect(`${install.stdout}\n${install.stderr}`).toContain("Hiring Code Review Shrimp");
    expect(`${install.stdout}\n${install.stderr}`).not.toContain("CrewClaw: ======");
    expect(`${install.stdout}\n${install.stderr}`).not.toContain("CrewClaw: Choose");
    expect(`${install.stdout}\n${install.stderr}`).not.toContain("> @chaogeek/hermes");
    expect(`${install.stdout}\n${install.stderr}`).toContain("Run this first Hermes test");

    const details = await hermesProfileDetails(profileName);
    expect(details.code, details.stderr || details.stdout).toBe(0);
    expect(`${details.stdout}\n${details.stderr}`).toMatch(/code-review-shrimp|Code Review Shrimp|SOUL\.md|Skills/i);
  } finally {
    await deleteHermesProfile(profileName);
  }

  const afterDelete = await run("hermes", ["profile", "list"], { timeoutMs: 60_000 });
  expect(`${afterDelete.stdout}\n${afterDelete.stderr}`).not.toContain(profileName);
});
