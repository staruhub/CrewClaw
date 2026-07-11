import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { buildSchemas } =
  await import("../contracts/scripts/generate-schemas.ts");
const { buildWebEmployees } =
  await import("../contracts/scripts/generate-web-employees.ts");

const expected = new Map();
for (const [name, schema] of Object.entries(buildSchemas())) {
  expected.set(
    join(repoRoot, "contracts", "schema", name),
    `${JSON.stringify(schema, null, 2)}\n`
  );
}
expected.set(
  join(repoRoot, "src", "data", "employees.generated.json"),
  `${JSON.stringify(buildWebEmployees(), null, 2)}\n`
);

const drift = [];
for (const [file, generated] of expected) {
  let current;
  try {
    current = readFileSync(file, "utf8");
  } catch {
    drift.push(`${file}: missing`);
    continue;
  }
  if (current !== generated)
    drift.push(`${file}: differs from source contracts`);
}

if (drift.length) {
  console.error(
    `Generated schema/data drift detected:\n- ${drift.join("\n- ")}`
  );
  console.error(
    "Run `pnpm run schema:generate` and `pnpm run web:employees`, then commit the outputs."
  );
  process.exit(1);
}
console.log(`Generated schema/data check passed (${expected.size} files).`);
