import { resolve } from "node:path";

import {
  loadDotEnv,
  loadProfile,
  probeModelAccess,
  requiredToolPreflight,
} from "./run.mjs";
import { runtimeToolReadiness } from "./employee-tools.mjs";
import { mcpReadiness } from "./mcp-client.mjs";

const employeeId = String(process.argv[2] || "").trim();
const workspaceRoot = resolve(process.argv[3] || process.cwd());

if (!employeeId) {
  process.stderr.write(
    "Usage: node tool-doctor-cli.mjs <employee-id> [workspace-root]\n"
  );
  process.exit(2);
}

try {
  // Match `crew run` exactly: provider readiness is evaluated from the same
  // guarded workspace dotenv snapshot, before either surface is resolved.
  await loadDotEnv({ workspaceRoot, env: process.env });
  const surfaces = {};
  let grantSnapshot = null;
  let resolvedModel = null;
  let resolvedMcp = null;
  for (const surface of ["chat", "task"]) {
    const profile = await loadProfile(employeeId, {
      workspaceRoot,
      env: process.env,
      surface,
    });
    grantSnapshot ||= profile.grantSnapshot;
    resolvedModel ||= profile.model;
    resolvedMcp ||= profile.mcp;
    const preflight = requiredToolPreflight(profile.toolResolution);
    surfaces[surface] = {
      status: preflight.ok ? "ready" : "blocked",
      blocking: preflight.blocking,
      degraded: preflight.degraded,
      resolution: profile.toolResolution.sessionCatalog,
      providers: {
        search: runtimeToolReadiness(profile.toolResolution, "web_search"),
        render: runtimeToolReadiness(profile.toolResolution, "browser_render"),
      },
    };
  }
  // v0.20 G2：真·模型可用性预检——用配置的模型发一次最小请求，把 403/无权限/模型名错等
  // 在 doctor 阶段就诊断出来（这正是 crew chat 里 HTTP 403 的根因所在）。CREW_DOCTOR_SKIP_MODEL=1 可跳过。
  const model_access =
    process.env.CREW_DOCTOR_SKIP_MODEL === "1"
      ? {
          ok: true,
          code: "skipped",
          model: resolvedModel,
          message: "已按 CREW_DOCTOR_SKIP_MODEL 跳过模型探测。",
        }
      : await probeModelAccess({ model: resolvedModel, env: process.env });
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "crewclaw.tool-doctor/v1",
      employee_id: employeeId,
      grant_precedence:
        "active .crewclaw/team.json permissions_granted capability:<id> entries are the only capability grant source",
      grant_source: grantSnapshot?.source || "none",
      grant_warning: grantSnapshot?.warning || null,
      grants: grantSnapshot?.grants || [],
      mcp: mcpReadiness(resolvedMcp),
      model_access,
      surfaces,
    })}\n`
  );
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
}
