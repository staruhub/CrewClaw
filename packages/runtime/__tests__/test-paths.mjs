import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(RUNTIME_TEST_DIR, "../../..");
export const RUNTIME_ENTRY = join(REPO_ROOT, "packages", "runtime", "run.mjs");

export function createRuntimeTestRoot(prefix = "crew-runtime-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}
