import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  chmod,
  readFile,
  cp,
} from "node:fs/promises";
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

function normalizeRecordedCommand(value: string): string {
  return value.replaceAll("\\", "/").replaceAll(/\/\/\?\/(?=[A-Za-z]:\/)/g, "");
}

function runCargo(args: string[]): Promise<CommandResult> {
  return new Promise(resolveResult => {
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
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      resolveResult({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", code => {
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runCrewClaw(options: RunOptions = {}): Promise<CommandResult> {
  const binaryPath = crewclawBinPath;
  if (!binaryPath)
    throw new Error("crewclaw CLI binary was not built before test execution");

  return new Promise(resolveResult => {
    const child = spawn(binaryPath, options.args ?? [], {
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
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      resolveResult({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", code => {
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runPackageBin(options: RunOptions = {}): Promise<CommandResult> {
  const binPath = join(repoRoot, "packages/cli/bin/chaogeek-hermes.cjs");
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [binPath, ...(options.args ?? [])], {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        CREWCLAW_ROOT: repoRoot,
        CARGO_INCREMENTAL: "0",
        FORCE_COLOR: "0",
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      resolveResult({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", code => {
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

type FakeHermesOptions = {
  callsFile?: string;
  firstRun?: boolean;
  installFallback?: boolean;
};

async function makeFakeCommandBin(options: FakeHermesOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), "crewclaw-test-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  await mkdir(bin);
  const commandPath = join(
    bin,
    process.platform === "win32" ? "hermes.cmd" : "hermes"
  );
  const callsFile = options.callsFile;
  const script =
    process.platform === "win32"
      ? [
          "@echo off",
          ...(callsFile ? [`echo %*>>"${callsFile}"`] : []),
          ...(options.installFallback
            ? [
                'if /I "%~1"=="profile" if /I "%~2"=="install" (',
                "  >&2 echo invalid choice: 'install'",
                "  exit /b 2",
                ")",
              ]
            : []),
          ...(options.firstRun
            ? ['if "%~1"=="-p" (', "  echo first run ok", "  exit /b 0", ")"]
            : []),
          `echo ${options.installFallback ? "imported" : "installed"}`,
          "exit /b 0",
          "",
        ].join("\r\n")
      : [
          "#!/bin/sh",
          ...(callsFile ? [`printf '%s\\n' "$*" >> "${callsFile}"`] : []),
          ...(options.installFallback
            ? [
                'if [ "$1" = "profile" ] && [ "$2" = "install" ]; then',
                "  echo \"invalid choice: 'install'\" >&2",
                "  exit 2",
                "fi",
              ]
            : []),
          ...(options.firstRun
            ? [
                'if [ "$1" = "-p" ]; then',
                "  echo 'first run ok'",
                "  exit 0",
                "fi",
              ]
            : []),
          `echo ${options.installFallback ? "imported" : "installed"}`,
          "",
        ].join("\n");
  await writeFile(commandPath, script);
  if (process.platform !== "win32") await chmod(commandPath, 0o755);
  return { dir, bin };
}

async function makeDoctorBin() {
  const dir = await mkdtemp(join(tmpdir(), "crewclaw-doctor-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  await mkdir(bin);
  const windows = process.platform === "win32";
  const gitPath = join(bin, windows ? "git.cmd" : "git");
  const hermesPath = join(bin, windows ? "hermes.cmd" : "hermes");
  await writeFile(
    gitPath,
    windows
      ? "@echo off\r\necho git version 2.0.0\r\nexit /b 0\r\n"
      : "#!/bin/sh\necho 'git version 2.0.0'\n"
  );
  await writeFile(
    hermesPath,
    windows
      ? "@echo off\r\n>&2 echo not found\r\nexit /b 1\r\n"
      : "#!/bin/sh\necho 'not found' >&2\nexit 1\n"
  );
  if (!windows) {
    await chmod(gitPath, 0o755);
    await chmod(hermesPath, 0o755);
  }
  return { bin };
}

async function makeCliFixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "crewclaw-root-"));
  tempDirs.push(root);
  await Promise.all([
    cp(join(repoRoot, "registry"), join(root, "registry"), {
      recursive: true,
    }),
    cp(join(repoRoot, "experts"), join(root, "experts"), {
      recursive: true,
    }),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

describe("crewclaw Rust CLI", () => {
  beforeAll(async () => {
    const targetDir = resolve(
      repoRoot,
      process.env.CARGO_TARGET_DIR ?? "crates/crewclaw-cli/target"
    );
    crewclawBinPath = join(
      targetDir,
      "debug",
      process.platform === "win32" ? "crewclaw-cli.exe" : "crewclaw-cli"
    );

    const result = await runCargo(["build", "--manifest-path", manifestPath]);
    if (result.code !== 0) {
      throw new Error(
        `cargo build failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`
      );
    }
  }, 300_000);

  it(
    "shows CrewClaw-first help for users and agents",
    async () => {
      const result = await runCrewClaw({
        args: ["--help"],
        env: { CREWCLAW_ROOT: "/repo" },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("  / ____|");
      expect(result.stdout).toContain("\\_____|_|  \\___|");
      expect(result.stdout).toContain("ChaoGeek AI Agent Hiring Platform");
      expect(result.stdout).toContain(
        process.platform === "win32"
          ? 'pnpm --silent -C "/repo" run crewclaw'
          : "pnpm --silent -C '/repo' run crewclaw"
      );
      expect(result.stdout).toContain("Agent instruction");
      expect(result.stdout).not.toContain("CrewClaw: ======");
      expect(result.stdout).not.toContain("CrewClaw:");
    },
    cliTestTimeout
  );

  it(
    "launches the package bin through the platform-native built executable",
    async () => {
      const result = await runPackageBin({
        args: ["--help"],
        // If the wrapper incorrectly falls back to cargo, an empty PATH makes the smoke fail.
        env: { PATH: "" },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("ChaoGeek AI Agent Hiring Platform");
      expect(result.stdout).toContain("Usage");
    },
    cliTestTimeout
  );

  it(
    "lists registry experts without invoking Hermes",
    async () => {
      const result = await runCrewClaw({ args: ["list"] });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("Expert registry");
      expect(result.stdout).toContain("code-review-shrimp");
      expect(result.stdout).toContain("docs-octopus");
      expect(result.stdout).not.toContain("CrewClaw:");
    },
    cliTestTimeout
  );

  it(
    "hires an available expert through official Hermes profile install",
    async () => {
      const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
      const { bin } = await makeFakeCommandBin({ callsFile });
      const root = await makeCliFixtureRoot();

      const result = await runCrewClaw({
        args: ["hire", "code-review-shrimp", "--yes", "--live"],
        env: {
          CREWCLAW_ROOT: root,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("Hiring Code Review Shrimp");
      expect(result.stdout).toContain("Run this first Hermes test");
      expect(
        normalizeRecordedCommand(await readFile(callsFile, "utf8"))
      ).toContain(
        `profile install ${root.replaceAll("\\", "/")}/experts/code-review-shrimp --name code-review-shrimp --alias --yes`
      );
    },
    cliTestTimeout
  );

  it(
    "opens an interactive menu and hires the selected expert",
    async () => {
      const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
      const { bin } = await makeFakeCommandBin({ callsFile });
      const root = await makeCliFixtureRoot();

      const result = await runCrewClaw({
        args: ["--name", "prd-smoke", "--yes", "--live"],
        input: "2\n",
        env: {
          CREWCLAW_ROOT: root,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "Choose a ChaoGeek-certified Hermes expert"
      );
      expect(result.stdout).toContain("Choose an expert number or slug:");
      expect(
        normalizeRecordedCommand(await readFile(callsFile, "utf8"))
      ).toContain(
        `profile install ${root.replaceAll("\\", "/")}/experts/product-prd-crab --name prd-smoke --alias --yes`
      );
    },
    cliTestTimeout
  );

  it(
    "can start the first Hermes test after install when requested",
    async () => {
      const { bin } = await makeFakeCommandBin({ firstRun: true });
      const root = await makeCliFixtureRoot();

      const result = await runCrewClaw({
        args: [
          "hire",
          "code-review-shrimp",
          "--name",
          "shrimp-smoke",
          "--run-first",
          "--live",
        ],
        env: {
          CREWCLAW_ROOT: root,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("First run: first run ok");
    },
    cliTestTimeout
  );

  it(
    "falls back to Hermes profile import when local Hermes lacks profile install",
    async () => {
      const callsFile = join(tmpdir(), `crewclaw-calls-${Date.now()}.txt`);
      const { bin } = await makeFakeCommandBin({
        callsFile,
        installFallback: true,
      });
      const root = await makeCliFixtureRoot();

      const result = await runCrewClaw({
        args: [
          "hire",
          "code-review-shrimp",
          "--name",
          "crewclaw-smoke",
          "--live",
        ],
        env: {
          CREWCLAW_ROOT: root,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "Imported via Hermes profile import fallback"
      );
      expect(await readFile(callsFile, "utf8")).toMatch(
        /profile import .*code-review-shrimp.* --name crewclaw-smoke/
      );
    },
    cliTestTimeout
  );

  it(
    "blocks install for coming soon experts",
    async () => {
      const result = await runCrewClaw({ args: ["hire", "docs-octopus"] });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Coming Soon");
    },
    cliTestTimeout
  );

  it(
    "handles cancelled interactive prompts without a stack trace",
    async () => {
      const result = await runCrewClaw({ args: [] });

      expect(result.code).toBe(130);
      expect(result.stderr).toBe("Cancelled.\n");
      expect(result.stderr).not.toContain("AbortError");
      expect(result.stderr).not.toContain("node:internal/readline");
    },
    cliTestTimeout
  );

  it(
    "reports Hermes doctor failures clearly",
    async () => {
      const { bin } = await makeDoctorBin();
      const result = await runCrewClaw({
        args: ["doctor"],
        env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      });

      expect(result.code).toBe(1);
      expect(result.stdout).toContain("git: ok");
      expect(result.stderr).toContain("Error: Hermes check failed");
    },
    cliTestTimeout
  );
});
