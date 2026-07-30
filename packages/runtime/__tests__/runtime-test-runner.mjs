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
    const lines = failure.output.trim().split(/\r?\n/);
    const firstFailure = lines.findIndex(line => /^not ok\b/.test(line.trim()));
    const diagnostic =
      firstFailure >= 0
        ? lines.slice(firstFailure, Math.min(lines.length, firstFailure + 40))
        : lines.slice(-40);
    const tail = lines.slice(-12);
    const rendered = [
      ...diagnostic,
      ...(diagnostic.at(-1) === tail.at(-1)
        ? []
        : ["    ... final TAP summary ...", ...tail]),
    ].join("\n");
    if (rendered) console.error(rendered.replace(/^/gm, "    "));
  }
  console.log(
    `\n${label}: ${pass} passed, ${failed.length} failed (of ${files.length}).`
  );
  return { ok: failed.length === 0, pass, fail: failed.length, failed };
}
