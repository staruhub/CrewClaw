#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { migrateKpiV1 } from "./kpi.mjs";

const SAFE_KPI_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

export function migrateAllKpiV1(root = process.cwd()) {
  const workspaceRoot = resolve(root);
  const directory = join(workspaceRoot, ".crewclaw", "kpi");
  if (!existsSync(directory)) return { scanned: 0, migrated: 0, employees: [] };
  const employees = [];
  let scanned = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const match = entry.isFile() ? SAFE_KPI_FILE.exec(entry.name) : null;
    if (!match) continue;
    scanned += 1;
    const result = migrateKpiV1(workspaceRoot, match[1]);
    if (result.migrated) employees.push(match[1]);
  }
  return { scanned, migrated: employees.length, employees };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const result = migrateAllKpiV1(process.argv[2] || process.cwd());
  console.log(
    `KPI migration complete: scanned ${result.scanned}, migrated ${result.migrated}.`
  );
  if (result.employees.length > 0) console.log(result.employees.join("\n"));
}
