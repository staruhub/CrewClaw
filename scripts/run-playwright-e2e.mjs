import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve, sep } from "node:path";

const mode = process.argv[2] ?? "dev";
if (mode !== "dev" && mode !== "production") {
  console.error("Usage: node scripts/run-playwright-e2e.mjs <dev|production>");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const pnpmCli = process.env.npm_execpath;
const pnpmViaNode = isWindows && Boolean(pnpmCli);
const port = Number(
  mode === "production"
    ? (process.env.E2E_PRODUCTION_PORT ?? 3273)
    : (process.env.E2E_PORT ?? 3173)
);
const baseURL = `http://127.0.0.1:${port}`;
const viteCli = resolve("node_modules", "vite", "bin", "vite.js");
const pnpmHoistedNodeModules = resolve("node_modules", ".pnpm", "node_modules");
// Both modes get a throwaway CREWCLAW_ROOT. Without it the dev run reads the developer's
// real .crewclaw/team.json, so specs that assert a not-yet-hired state pass or fail based
// on who is already on that machine's roster rather than on the code under test.
const e2eWorkspaceRoot = mkdtempSync(join(tmpdir(), `crewclaw-${mode}-e2e-`));
let server;
let shuttingDown = false;

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: isWindows,
      ...options,
    });
    child.once("error", error => {
      console.error(error.message);
      resolve(127);
    });
    child.once("exit", code => resolve(code ?? 1));
  });
}

function runPnpm(args, options = {}) {
  return run(
    pnpmViaNode ? process.execPath : pnpm,
    pnpmViaNode ? [pnpmCli, ...args] : args,
    {
      ...(pnpmViaNode ? { shell: false } : {}),
      ...options,
    }
  );
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`E2E ${mode} server exited before becoming ready`);
    }
    try {
      const response = await fetch(baseURL, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status < 500) return;
    } catch {
      // The service is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`E2E ${mode} server was not ready within ${timeoutMs}ms`);
}

async function stopServer() {
  if (shuttingDown || !server?.pid || server.exitCode !== null) return;
  shuttingDown = true;
  if (isWindows) {
    await run("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stopServer().finally(() =>
      process.exit(signal === "SIGINT" ? 130 : 143)
    );
  });
}

let exitCode = 1;
try {
  if (mode === "production") {
    const buildCode = await runPnpm(["run", "build"]);
    if (buildCode !== 0) process.exit(buildCode);
  }

  const serverCommand = process.execPath;
  const serverArgs =
    mode === "production"
      ? ["scripts/start-production.mjs"]
      : [viteCli, "--host", "127.0.0.1", "--port", String(port)];
  server = spawn(serverCommand, serverArgs, {
    cwd: process.cwd(),
    detached: !isWindows,
    env: {
      ...process.env,
      // The inspect plugin resolves Babel plugins from pnpm's virtual store.
      // Keep that lookup path while spawning Vite directly, which also lets
      // this runner terminate the server process tree reliably on Windows.
      ...(mode === "dev"
        ? {
            NODE_PATH: [pnpmHoistedNodeModules, process.env.NODE_PATH]
              .filter(Boolean)
              .join(delimiter),
          }
        : {}),
      ...(e2eWorkspaceRoot ? { CREWCLAW_ROOT: e2eWorkspaceRoot } : {}),
      NODE_ENV: mode === "production" ? "production" : process.env.NODE_ENV,
      PORT: String(port),
    },
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  await waitForServer(mode === "production" ? 60_000 : 30_000);

  const playwrightArgs = ["exec", "playwright", "test"];
  if (mode === "production") {
    playwrightArgs.push("--config", "playwright.production.config.ts");
  }
  exitCode = await runPnpm(playwrightArgs, {
    env: { ...process.env, CREWCLAW_E2E_EXTERNAL_SERVER: "1" },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await stopServer();
  if (e2eWorkspaceRoot) {
    const target = resolve(e2eWorkspaceRoot);
    const tempRoot = resolve(tmpdir());
    if (
      target.startsWith(`${tempRoot}${sep}`) &&
      basename(target).startsWith(`crewclaw-${mode}-e2e-`)
    ) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}

process.exit(exitCode);
