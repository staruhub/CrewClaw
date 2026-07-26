import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { offboardEmployee } from "./offboarding.mjs";

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value after ${name}`);
  }
  return value;
}

export function runOffboardingCli(args, env = process.env) {
  const employeeId = args[0];
  if (!employeeId)
    throw new Error(
      "usage: offboarding-cli.mjs <employee> [root] --mode <mode>"
    );
  const root = resolve(args[1] || env.CREWCLAW_ROOT || process.cwd());
  const mode = option(args, "--mode") || "export_memory";
  const successorEmployeeId = option(args, "--successor");
  return offboardEmployee(root, employeeId, { mode, successorEmployeeId });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const result = runOffboardingCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: error?.code || "OFFBOARDING_FAILED",
        error: error?.message || String(error),
      })}\n`
    );
    process.exitCode = 1;
  }
}
