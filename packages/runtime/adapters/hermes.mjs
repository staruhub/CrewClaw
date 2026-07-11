import yaml from "../yaml.mjs";
import { computeCompatibility } from "../compatibility.mjs";
import { validateEmployeePackage } from "../employee-package.mjs";
import { defineAdapter } from "./adapter-interface.mjs";

const TOOL_NAME_MAP = Object.freeze({
  "web.search": "web_search",
  "web.extract": "web_fetch",
  "web.fetch_extract": "web_fetch",
  "browser.render": "browser_render",
  "source.verify": "source_verify",
  "evidence.create": "artifact_create",
  "artifact.report": "artifact_export",
  "shell.run": "shell_run",
});

// PRD §14.2: risk rises P0→P4, so approval strictness must rise WITH it. P0 (read public)
// auto-allows; P4 (delete/pay/perms) defaults to DENY. (A first pass had this inverted —
// auto-allowing P4 high-risk actions, the exact "权限不可信" risk §26 warns about.)
const APPROVAL_BY_TIER = Object.freeze({
  P0: "never", // 只读公开信息 → 可允许（自动）
  P1: "sensitive", // 只读用户数据 → 需授权
  P2: "always", // 写入本地结果 → 需授权
  P3: "always", // 外部副作用 → 强确认
  P4: "deny", // 高危动作 → 默认禁止
});

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function toArray(value) {
  if (!hasValue(value)) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function renderValue(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (!hasValue(value)) return [`${pad}- none`];
  if (typeof value !== "object") return [`${pad}- ${scalar(value)}`];

  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (item && typeof item === "object") return renderValue(item, indent);
      return [`${pad}- ${scalar(item)}`];
    });
  }

  return Object.entries(value).flatMap(([key, item]) => {
    if (item && typeof item === "object")
      return [`${pad}- ${key}:`, ...renderValue(item, indent + 1)];
    return [`${pad}- ${key}: ${scalar(item)}`];
  });
}

function renderSection(title, value) {
  return [`## ${title}`, ...renderValue(value), ""].join("\n");
}

function normalizeToolName(toolName) {
  return (
    TOOL_NAME_MAP[toolName] ||
    toolName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  );
}

function configuredToolEntries(pkg) {
  return Object.entries(pkg?.tool_needs || {})
    .filter(
      ([, need]) => String(need?.necessity || "").toLowerCase() !== "disabled"
    )
    .map(([crewclawName, need]) => ({
      crewclaw: crewclawName,
      hermes: normalizeToolName(crewclawName),
      necessity: need?.necessity || "optional",
      permission: need?.permission || "unspecified",
      description: need?.description || "",
      tier:
        pkg?.permission_policy?.grants?.[crewclawName] ||
        pkg?.permission_policy?.default_level ||
        "P1",
    }));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function permissionTiers(pkg, tools) {
  const grants = pkg?.permission_policy?.grants || {};
  const denied = pkg?.permission_policy?.denied || {};
  const tiers = {};

  for (const tier of Object.keys(APPROVAL_BY_TIER)) {
    const allowlist = unique(
      Object.entries(grants)
        .filter(([, level]) => level === tier)
        .map(([tool]) => normalizeToolName(tool))
    );
    tiers[tier] = {
      requires_approval: APPROVAL_BY_TIER[tier],
      allowlist,
    };
  }

  for (const tool of tools) {
    if (!tiers[tool.tier]) {
      tiers[tool.tier] = {
        requires_approval: "always", // unknown tier → ask (never silently auto-allow)
        allowlist: [],
      };
    }
    if (!tiers[tool.tier].allowlist.includes(tool.hermes))
      tiers[tool.tier].allowlist.push(tool.hermes);
  }

  return {
    default_level: pkg?.permission_policy?.default_level || "P1",
    tiers,
    denied: Object.keys(denied).sort(),
    human_authorization_required: toArray(
      pkg?.permission_policy?.human_authorization_required
    ).map(String),
  };
}

function compileConfig(pkg) {
  const tools = configuredToolEntries(pkg);
  const config = {
    runtime: "hermes",
    employee: {
      id: pkg?.identity?.id || "",
      name: pkg?.identity?.name || pkg?.identity?.english_name || "",
      target_level: "L3",
    },
    toolsets: {
      default: unique(tools.map(tool => tool.hermes)),
      mappings: tools.map(
        ({ crewclaw, hermes, necessity, permission, description, tier }) => ({
          crewclaw,
          hermes,
          necessity,
          permission,
          tier,
          description,
        })
      ),
    },
    permissions: permissionTiers(pkg, tools),
    artifacts: {
      mode: "basic",
      deliverables: toArray(pkg?.deliverables).map(
        deliverable => deliverable?.type || deliverable?.name || deliverable
      ),
    },
    outcome: {
      mode: "basic",
      rubric: toArray(pkg?.outcome_rubric).map(
        item => item?.id || item?.criterion || item
      ),
    },
  };

  return yaml.dump(config, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

function compileSoul(pkg) {
  return [
    `# ${pkg?.identity?.name || pkg?.identity?.id || "CrewClaw Employee"} SOUL`,
    "",
    renderSection("Identity", pkg?.identity),
    renderSection("Soul", pkg?.soul),
    renderSection("Values", pkg?.soul?.values),
  ].join("\n");
}

function compileAgents(pkg) {
  return [
    `# ${pkg?.identity?.name || pkg?.identity?.id || "CrewClaw Employee"} AGENTS`,
    "",
    renderSection("Role Contract", pkg?.role_contract),
    renderSection("Playbooks", pkg?.playbooks),
    renderSection("Failure Playbooks", pkg?.failure_playbooks),
    renderSection("Deliverables", pkg?.deliverables),
    renderSection("Outcome Rubric", pkg?.outcome_rubric),
  ].join("\n");
}

function compileMemory(pkg) {
  return [
    `# ${pkg?.identity?.name || pkg?.identity?.id || "CrewClaw Employee"} MEMORY`,
    "",
    renderSection("Memory Seed", pkg?.memory_seed),
    renderSection("Dream Policy", pkg?.dream_policy),
  ].join("\n");
}

function skillNameFromPath(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  const skillIndex = parts.findIndex(part => part === "SKILL.md");
  if (skillIndex > 0) return parts[skillIndex - 1];
  return parts.at(-1)?.replace(/\.md$/i, "") || "crewclaw-skill";
}

function renderSkill(path, pkg) {
  const name = skillNameFromPath(path);
  const playbook = toArray(pkg?.playbooks).find(item => {
    const id = String(item?.id || "").toLowerCase();
    const title = String(item?.name || "").toLowerCase();
    return (
      id === name || title === name || id.includes(name) || name.includes(id)
    );
  });

  return [
    "---",
    `name: ${name}`,
    `description: Hermes skill compiled for ${pkg?.identity?.name || pkg?.identity?.id || "CrewClaw employee"}.`,
    "---",
    "",
    `# ${name}`,
    "",
    `Use this skill when operating as ${pkg?.identity?.name || pkg?.identity?.id || "this CrewClaw employee"}.`,
    "",
    renderSection("Mission", pkg?.role_contract?.mission),
    renderSection("Playbook", playbook || pkg?.playbooks),
    renderSection("Tool Boundaries", pkg?.tool_needs),
  ].join("\n");
}

function compileSkills(pkg) {
  const hintPaths = toArray(pkg?.adapter_hints?.Hermes?.skills);
  const fallbackPaths = toArray(pkg?.playbooks).map(
    playbook => `skills/${playbook?.id || "playbook"}/SKILL.md`
  );
  return (hintPaths.length > 0 ? hintPaths : fallbackPaths).map(path => ({
    path,
    content: renderSkill(path, pkg),
  }));
}

function publicCapabilities() {
  const capabilities = {
    tools: true,
    events: true,
    memory: true,
    permissions: true,
    artifacts: "basic",
    outcome: "basic",
  };

  Object.defineProperties(capabilities, {
    tasks: { value: true },
    logs: { value: true },
    doctor: { value: true },
    basic_acceptance: { value: true },
    search: { value: true },
    web: { value: true },
    browser: { value: true },
    source: { value: true },
    evidence: { value: true },
    artifact: { value: true },
  });

  return capabilities;
}

function smokeDescriptor(pkg) {
  const smoke =
    (Array.isArray(pkg?.eval_suite) && pkg.eval_suite[0]) ||
    (Array.isArray(pkg?.eval_suite?.smoke_tests) &&
      pkg.eval_suite.smoke_tests[0]);

  const descriptor = smoke || {
    id: "research-seed-2.1",
    task: "Research Volcengine Seed 2.1 and decide whether it is suitable for CrewClaw.",
    acceptance: [
      "Find official or authoritative sources.",
      "Extract model ID, pricing, capability direction, context, and unknown fields.",
      "Provide confidence labels and a CrewClaw routing recommendation.",
    ],
  };

  return {
    ...descriptor,
    runtime: "hermes",
    dry_run: true,
    runner: "hermes task run",
  };
}

export const hermesAdapter = defineAdapter({
  id: "hermes",
  name: "Hermes Adapter",
  targetLevel: "L3",

  capabilities: publicCapabilities,

  validate(pkg) {
    const delegated = validateEmployeePackage(pkg);
    const errors = new Set(delegated.errors || []);

    for (const field of ["identity", "soul", "role_contract", "tool_needs"]) {
      if (!hasValue(pkg?.[field]))
        errors.add(`Missing required Hermes field: ${field}`);
    }

    return { ok: errors.size === 0, errors: [...errors] };
  },

  compile(pkg) {
    return {
      runtime: "hermes",
      targetLevel: "L3",
      files: {
        "SOUL.md": compileSoul(pkg),
        "AGENTS.md": compileAgents(pkg),
        "config.yaml": compileConfig(pkg),
        "MEMORY.md": compileMemory(pkg),
      },
      skills: compileSkills(pkg),
    };
  },

  doctor(pkg) {
    const validation = this.validate(pkg);
    const compatibility = this.computeLevel(pkg);
    const compiled = validation.ok ? this.compile(pkg) : null;
    const checks = [
      {
        id: "employee_package",
        status: validation.ok ? "pass" : "fail",
        detail: validation.ok
          ? "Employee package validates for Hermes."
          : validation.errors.join("; "),
      },
      {
        id: "compatibility",
        status: compatibility.level === "L3" ? "pass" : "warn",
        detail: `Hermes compatibility computed as ${compatibility.level}.`,
      },
      {
        id: "compiled_files",
        status: compiled ? "pass" : "skip",
        detail: compiled
          ? Object.keys(compiled.files).join(", ")
          : "Skipped because validation failed.",
      },
      {
        id: "skills",
        status: compiled?.skills?.length > 0 ? "pass" : "warn",
        detail:
          compiled?.skills?.length > 0
            ? `${compiled.skills.length} skill descriptors emitted.`
            : "No skills emitted.",
      },
    ];
    const fixes = [];

    if (!validation.ok)
      fixes.push(
        ...validation.errors.map(error => `Fix package validation: ${error}`)
      );
    if (compatibility.level !== "L3") fixes.push(...compatibility.reasons);

    return {
      status: checks.every(check => check.status === "pass")
        ? "ok"
        : "needs_attention",
      checks,
      fixes,
    };
  },

  runSmokeTest(pkg) {
    return smokeDescriptor(pkg);
  },

  computeLevel(pkg) {
    return computeCompatibility(pkg, publicCapabilities());
  },
});

export default hermesAdapter;
