import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTool } from "../run.mjs";

const allow = {
  decision: "allow",
  level: "L1",
  scope: "test",
  reason: "test",
};

const root = mkdtempSync(join(tmpdir(), "crewclaw-shell-runner-"));
try {
  const executable = JSON.stringify(process.execPath);
  const success = await runTool(
    "bash",
    { command: `${executable} -e "process.stdout.write('ok')"` },
    { root, permission: allow }
  );
  assert.equal(success, "ok");

  await assert.rejects(
    runTool(
      "bash",
      { command: `${executable} -e "process.exit(7)"` },
      { root, permission: allow }
    ),
    error =>
      error?.code === "shell_command_failed" &&
      error?.exitCode === 7 &&
      /退出码 7/.test(error.message)
  );

  await assert.rejects(
    runTool(
      "bash",
      {
        command: `${executable} -e "process.stdout.write('x'.repeat(300000))"`,
      },
      { root, permission: allow }
    ),
    error =>
      error?.code === "shell_output_too_large" &&
      error?.outputBytes > 256 * 1024
  );

  console.log("shell-runner.test.mjs passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
