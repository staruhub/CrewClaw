import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function runRuntimeScripts(
  files,
  { directory, env = process.env, envForFile, label = "Runtime tests" } = {}
) {
  let pass = 0;
  const failed = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, [join(directory, file)], {
      cwd: join(directory, "../../.."),
      env: envForFile ? envForFile(file, env) : env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.status === 0 && !result.error) {
      pass++;
    } else {
      failed.push({
        file,
        status: result.status,
        error: result.error,
        output: `${result.stdout || ""}${result.stderr || ""}`,
      });
    }
  }

  for (const failure of failed) {
    console.error(`\x1b[31m✗ ${failure.file}\x1b[0m`);
    if (failure.error)
      console.error(`    runner error: ${failure.error.message}`);
    const tail = failure.output.trim().split(/\r?\n/).slice(-12).join("\n");
    if (tail) console.error(tail.replace(/^/gm, "    "));
  }
  console.log(
    `\n${label}: ${pass} passed, ${failed.length} failed (of ${files.length}).`
  );
  return { ok: failed.length === 0, pass, fail: failed.length, failed };
}
