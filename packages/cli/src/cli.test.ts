import { mkdtemp, mkdir, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  args?: string[];
  input?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

const repoRoot = resolve(import.meta.dirname, "../../..");
const manifestPath = join(repoRoot, "crates/crewclaw-cli/Cargo.toml");
const tempDirs: string[] = [];
const cliTestTimeout = 30_000;
let crewclawBinPath: string | undefined;

function runCargo(args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn("cargo", args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_INCREMENTAL: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolveResult({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runCrewClaw(options: RunOptions = {}): Promise<CommandResult> {
  if (!crewclawBinPath) throw new Error("crewclaw CLI binary was not built before test execution");

  return new Promise((resolveResult) => {
    const child = spawn(crewclawBinPath, options.args ?? [], {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        CREWCLAW_ROOT: repoRoot,
        CARGO_INCREMENTAL: "0",
        FORCE_COLOR: "0",
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolveResult({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function makeFakeCommandBin(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "crewclaw-test-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  await mkdir(bin);
  const commandPath = join(bin, "hermes");
  await writeFile(commandPath, script);
  await chmod(commandPath, 0o755);
  return { dir, bin };
}

async function makeDoctorBin() {
  const dir = await mkdtemp(join(tmpdir(), "crewclaw-doctor-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  await mkdir(bin);
  const gitPath = join(bin, "git");
  const hermesPath = join(bin, "hermes");
  await writeFile(gitPath, "#!/bin/sh\necho 'git version 2.0.0'\n");
  await writeFile(hermesPath, "#!/bin/sh\necho 'not found' >&2\nexit 1\n");
  await chmod(gitPath, 0o755);
  await chmod(hermesPath, 0o755);
  return { bin };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("crewclaw Rust CLI", () => {
  beforeAll(async () => {
    const targetDir = resolve(repoRoot, process.env.CARGO_TARGET_DIR ?? "crates/crewclaw-cli/target");
    crewclawBinPath = join(
      targetDir,
      "debug",
      process.platform === "win32" ? "crewclaw-cli.exe" : "crewclaw-cli",
    );

    const result = await runCargo(["build", "--manifest-path", manifestPath]);
    if (result.code !== 0) {
      throw new Error(`cargo build failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`);
    }
  }, 300_000);

  it("shows CrewClaw-first help for users and agents", async () => {
    const result = await runCrewClaw({ args: ["--help"], env: { CREWCLAW_ROOT: "/repo" } });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("  / ____|");
    expect(result.stdout).toContain("\\_____|_|  \\___|");
    expect(result.stdout).toContain("ChaoGeek AI Agent Hiring Platform");
    expect(result.stdout).toContain("pnpm --silent -C /repo run crewclaw");
    expect(result.stdout).toContain("Agent instruction");
    expect(result.stdout).not.toContain("CrewClaw: ======");
    expect(result.stdout).not.toContain("CrewClaw:");
  }, cliTestTimeout);

  it("lists registry experts without invoking Hermes", async () => {
    const result = await runCrewClaw({ args: ["list"] });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Expert registry");
    expect(result.stdout).toContain("code-review-shrimp");
    expect(result.stdout).toContain("docs-octopus");
    expect(result.stdout).not.toContain("CrewClaw:");
  }, cliTestTimeout);

  // needs a real hermes executable; Rust Command::new can't run a #!/bin/sh fake on Windows.
  it.skipIf(process.platform === "win32")("hires an available expert through official Hermes profile install", async () => {
    const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
    const { bin } = await makeFakeCommandBin(`#!/bin/sh
printf '%s\\n' "$*" >> "${callsFile}"
echo installed
`);

    const result = await runCrewClaw({
      args: ["hire", "code-review-shrimp", "--yes"],
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Hiring Code Review Shrimp");
    expect(result.stdout).toContain("Run this first Hermes test");
    expect(await readFile(callsFile, "utf8")).toContain(
      `profile install ${repoRoot}/experts/code-review-shrimp --name code-review-shrimp --alias --yes`,
    );
  }, cliTestTimeout);

  // needs a real hermes executable; Rust Command::new can't run a #!/bin/sh fake on Windows.
  it.skipIf(process.platform === "win32")("opens an interactive menu and hires the selected expert", async () => {
    const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
    const { bin } = await makeFakeCommandBin(`#!/bin/sh
printf '%s\\n' "$*" >> "${callsFile}"
echo installed
`);

    const result = await runCrewClaw({
      args: ["--name", "prd-smoke", "--yes"],
      input: "2\n",
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Choose a ChaoGeek-certified Hermes expert");
    expect(result.stdout).toContain("Choose an expert number or slug:");
    expect(await readFile(callsFile, "utf8")).toContain(
      `profile install ${repoRoot}/experts/product-prd-crab --name prd-smoke --alias --yes`,
    );
  }, cliTestTimeout);

  // needs a real hermes executable; Rust Command::new can't run a #!/bin/sh fake on Windows.
  it.skipIf(process.platform === "win32")("can start the first Hermes test after install when requested", async () => {
    const { bin } = await makeFakeCommandBin(`#!/bin/sh
if [ "$1" = "-p" ]; then
  echo 'first run ok'
  exit 0
fi
echo installed
`);

    const result = await runCrewClaw({
      args: ["hire", "code-review-shrimp", "--name", "shrimp-smoke", "--run-first"],
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("First run: first run ok");
  }, cliTestTimeout);

  // needs a real hermes executable; Rust Command::new can't run a #!/bin/sh fake on Windows.
  it.skipIf(process.platform === "win32")("falls back to Hermes profile import when local Hermes lacks profile install", async () => {
    const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
    const { bin } = await makeFakeCommandBin(`#!/bin/sh
printf '%s\\n' "$*" >> "${callsFile}"
if [ "$1" = "profile" ] && [ "$2" = "install" ]; then
  echo "invalid choice: 'install'" >&2
  exit 2
fi
echo imported
`);

    const result = await runCrewClaw({
      args: ["hire", "code-review-shrimp", "--name", "crewclaw-smoke"],
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Imported via Hermes profile import fallback");
    expect(await readFile(callsFile, "utf8")).toMatch(/profile import .*code-review-shrimp.* --name crewclaw-smoke/);
  }, cliTestTimeout);

  it("blocks install for coming soon experts", async () => {
    const result = await runCrewClaw({ args: ["hire", "docs-octopus"] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Coming Soon");
  }, cliTestTimeout);

  it("handles cancelled interactive prompts without a stack trace", async () => {
    const result = await runCrewClaw({ args: [] });

    expect(result.code).toBe(130);
    expect(result.stderr).toBe("Cancelled.\n");
    expect(result.stderr).not.toContain("AbortError");
    expect(result.stderr).not.toContain("node:internal/readline");
  }, cliTestTimeout);

  it("reports Hermes doctor failures clearly", async () => {
    const { bin } = await makeDoctorBin();
    const result = await runCrewClaw({
      args: ["doctor"],
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("git: ok");
    expect(result.stderr).toContain("Error: Hermes check failed");
  }, cliTestTimeout);
});
