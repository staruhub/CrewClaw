import { resolve } from "node:path";

import { loadDotEnv, loadProfile, requiredToolPreflight } from "./run.mjs";

const employeeId = String(process.argv[2] || "").trim();
const workspaceRoot = resolve(process.argv[3] || process.cwd());

if (!employeeId) {
  process.stderr.write("Usage: node tool-doctor-cli.mjs <employee-id> [workspace-root]\n");
  process.exit(2);
}

try {
  // Match `crew run` exactly: provider readiness is evaluated from the same
  // guarded workspace dotenv snapshot, before either surface is resolved.
  await loadDotEnv({ workspaceRoot, env: process.env });
  const surfaces = {};
  let grantSnapshot = null;
  for (const surface of ["chat", "task"]) {
    const profile = await loadProfile(employeeId, {
      workspaceRoot,
      env: process.env,
      surface,
    });
    grantSnapshot ||= profile.grantSnapshot;
    const preflight = requiredToolPreflight(profile.toolResolution);
    surfaces[surface] = {
      status: preflight.ok ? "ready" : "blocked",
      blocking: preflight.blocking,
      degraded: preflight.degraded,
      resolution: profile.toolResolution.sessionCatalog,
    };
  }
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "crewclaw.tool-doctor/v1",
      employee_id: employeeId,
      grant_precedence:
        "active .crewclaw/team.json permissions_granted capability:<id> entries are the only capability grant source",
      grant_source: grantSnapshot?.source || "none",
      grant_warning: grantSnapshot?.warning || null,
      grants: grantSnapshot?.grants || [],
      surfaces,
    })}\n`
  );
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
}
