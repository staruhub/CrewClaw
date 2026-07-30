import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(
  repoRoot,
  "packages",
  "runtime",
  "employee-package-validator.mjs"
);
const result = await build({
  entryPoints: [
    join(repoRoot, "packages", "validator", "src", "standalone-bin.ts"),
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  minify: true,
  legalComments: "none",
  write: false,
});
const generated = result.outputFiles[0].text;

if (process.argv.includes("--check")) {
  let current;
  try {
    current = readFileSync(output, "utf8");
  } catch {
    console.error(
      "Standalone employee validator is missing. Run `pnpm run build:validator`."
    );
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      "Standalone employee validator is stale. Run `pnpm run build:validator` and commit the output."
    );
    process.exit(1);
  }
  console.log("Standalone employee validator bundle is current.");
} else {
  writeFileSync(output, generated);
  console.log(`Wrote ${output}`);
}
