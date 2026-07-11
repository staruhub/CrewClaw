import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildEmployeePackage,
  employeePackageMetadata,
} from "../api/lib/pack-employee";
import { getAvailableExperts } from "../packages/registry/src/index";

const root = resolve(process.cwd());
const output = join(root, "dist", "employee-packages");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const experts = getAvailableExperts(join(root, "registry", "experts.json"));
for (const expert of experts) {
  const pkg = buildEmployeePackage(root, expert.name);
  const metadata = employeePackageMetadata(expert.name, pkg);
  await Promise.all([
    writeFile(join(output, `${expert.name}.tar.gz`), pkg.gzip, { mode: 0o644 }),
    writeFile(
      join(output, `${expert.name}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o644 }
    ),
  ]);
}

console.log(`Built ${experts.length} employee packages.`);
