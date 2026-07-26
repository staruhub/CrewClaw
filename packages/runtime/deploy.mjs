// deploy.mjs — AC-010 OpenWork Handoff: turn an employee package into an OpenWork deployment
// package (the adapter's workspace blueprint) and report the target compatibility level (L0–L4).
// Pure + model-free — works without the LLM runtime (and without API quota).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openworkAdapter } from "./adapters/openwork.mjs";
import { computeCompatibility } from "./compatibility.mjs";
import { loadEmployeePackage } from "./employee-package.mjs";
import {
  resolveStateDirectory,
  resolveStatePath,
  writeStateFileAtomic,
} from "./state-lock.mjs";

export function deployToOpenWork(
  pkg,
  { root = process.cwd(), runtimeCapabilities = null } = {}
) {
  const validation = openworkAdapter.validate(pkg);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const blueprint = openworkAdapter.compile(pkg);
  const compatibility = computeCompatibility(
    pkg,
    runtimeCapabilities || openworkAdapter.capabilities()
  );
  const targetLevel = openworkAdapter.targetLevel || "L4";

  const id = pkg.id || pkg.identity?.id || "employee"; // v2 packages nest id/name under identity
  const name = pkg.name || pkg.identity?.name || null;
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ||
    id === "." ||
    id === ".."
  ) {
    return { ok: false, errors: ["employee id 不能用于安全的部署目录"] };
  }
  const dir = path.resolve(root, ".crewclaw", "deploy", `${id}-openwork`);
  const blueprintPath = path.join(dir, "openwork.blueprint.json");
  writeStateFileAtomic(
    blueprintPath,
    `${JSON.stringify(blueprint, null, 2)}\n`,
    { root }
  );
  const manifest = {
    id,
    name,
    target: "openwork",
    target_level: targetLevel,
    compatibility_level: compatibility.level,
    runtime_probe_status: runtimeCapabilities ? "provided" : "unprobed",
    deployment_mode: "blueprint_only",
    reasons: compatibility.reasons || [],
    blueprint_keys: Object.keys(blueprint),
  };
  writeStateFileAtomic(
    path.join(dir, "deploy.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { root }
  );

  const safeDir = resolveStateDirectory(dir, root, { mustExist: true });
  const safeBlueprintPath = resolveStatePath(blueprintPath, root, {
    mustExist: true,
  });

  return {
    ok: true,
    dir: safeDir,
    blueprintPath: safeBlueprintPath,
    level: compatibility.level,
    targetLevel,
    reasons: compatibility.reasons || [],
  };
}

// CLI: node deploy.mjs <agent>  → loads experts/<agent>/crewclaw.employee.yaml + deploys to OpenWork
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const agent = process.argv[2];
  const root = process.env.CREWCLAW_ROOT || process.cwd();
  if (!agent) {
    console.error("Usage: node deploy.mjs <agent>");
    process.exit(2);
  }
  const pkgPath = path.resolve(
    root,
    "experts",
    agent,
    "crewclaw.employee.yaml"
  );
  if (!existsSync(pkgPath)) {
    console.error(`Error: 找不到员工包：${pkgPath}`);
    process.exit(1);
  }
  const loaded = loadEmployeePackage(pkgPath); // { ok, package, errors } — package is the pkg
  if (!loaded.ok) {
    console.error(
      "员工包校验失败：\n  - " + (loaded.errors || []).join("\n  - ")
    );
    process.exit(1);
  }
  const r = deployToOpenWork(loaded.package, { root });
  if (!r.ok) {
    console.error("部署校验失败：\n  - " + r.errors.join("\n  - "));
    process.exit(1);
  }
  console.log(`✓ 已生成 OpenWork 部署包 → ${r.dir}`);
  console.log(`  目标兼容等级：${r.level}（目标 ${r.targetLevel}）`);
  if (r.reasons.length)
    console.log("  说明：\n  - " + r.reasons.join("\n  - "));
}
