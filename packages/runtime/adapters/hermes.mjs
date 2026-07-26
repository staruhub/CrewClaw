import yaml from "../yaml.mjs";
import { computeCompatibility } from "../compatibility.mjs";
import { validateEmployeePackage } from "../employee-package.mjs";
import { defineAdapter } from "./adapter-interface.mjs";

// Hermes exposes named bundles, not per-tool grants. Only map bundles whose complete expansion
// is read-only. `file`, `terminal`, `browser`, and `skills` are deliberately absent because they
// also expose writes/arbitrary actions or skill_manage.
const HERMES_TOOLSETS_BY_CAPABILITY = Object.freeze({
  "web.search": ["search"],
  "web.fetch": ["web"],
  "web.extract": ["web"],
  "web.fetch_extract": ["web"],
});

const HERMES_FORBIDDEN_BROAD_TOOLSETS = Object.freeze([
  "browser",
  "code_execution",
  "file",
  "skills",
  "terminal",
]);

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function configuredToolsets(pkg) {
  const selected = [];
  for (const [capability, need] of Object.entries(pkg?.tool_needs || {})) {
    // Base profiles grant required capabilities only. Conditional and non-default capabilities
    // must be selected by the frozen CrewClaw hire/session decision, never silently broadened here.
    if (String(need?.necessity || "").toLowerCase() !== "required") continue;
    selected.push(...(HERMES_TOOLSETS_BY_CAPABILITY[capability] || []));
  }
  const resolved = unique(selected);
  // Hermes web includes both web_search and web_extract; avoid the redundant search bundle.
  return resolved.includes("web")
    ? resolved.filter(toolset => toolset !== "search")
    : resolved;
}

function compileConfig(pkg) {
  const toolsets = configuredToolsets(pkg);
  const config = {
    toolsets,
    platform_toolsets: {
      cli: [...toolsets, "no_mcp"],
    },
    coding_context: "off",
    agent: {
      disabled_toolsets: [...HERMES_FORBIDDEN_BROAD_TOOLSETS],
    },
    plugins: {
      enabled: [],
    },
    approvals: {
      mode: "manual",
    },
  };

  // The lightweight repository YAML dumper renders empty arrays as `{}`. Normalize the two
  // security-sensitive empty allowlists so Hermes receives an actual list and never falls back.
  return yaml
    .dump(config, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    })
    .replace(/^toolsets:[ \t]*(?=\r?\n(?![ \t]+-))/m, "toolsets: []")
    .replace(/^(\s+enabled):[ \t]*(?=\r?\n(?![ \t]+-))/m, "$1: []");
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
    "## Playbooks and Skills",
    "- Playbooks are orchestration flows from crewclaw.employee.yaml; they describe the process CrewClaw supervises.",
    "- Skills are separate executable instruction guides. Hermes may load only explicitly mapped skill paths; a playbook id is never guessed to be a skill directory.",
    "",
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
    `description: Use when applying the ${name} execution guide as ${pkg?.identity?.name || pkg?.identity?.id || "a CrewClaw employee"}.`,
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
  // A playbook is a supervised process, not a filesystem skill. The old fallback guessed
  // `skills/<playbook-id>/SKILL.md`, which produced paths that did not exist in the employee
  // package. Fail honestly when adapter hints are absent instead of fabricating skill files.
  return unique(hintPaths).map(path => ({
    path,
    content: renderSkill(path, pkg),
  }));
}

function publicCapabilities() {
  const capabilities = {
    tools: true,
    events: false,
    memory: false,
    permissions: false,
    artifacts: false,
    outcome: false,
  };

  Object.defineProperties(capabilities, {
    tasks: { value: true },
    logs: { value: false },
    doctor: { value: true },
    basic_acceptance: { value: false },
    search: { value: true },
    web: { value: true },
    browser: { value: false },
    source: { value: false },
    evidence: { value: false },
    artifact: { value: false },
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
    runner: "hermes chat -q",
  };
}

export const hermesAdapter = defineAdapter({
  id: "hermes",
  name: "Hermes Adapter",
  targetLevel: "L1",

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
      targetLevel: "L1",
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
    const compiledToolsets = compiled ? configuredToolsets(pkg) : [];
    const unsupportedRequired = Object.entries(pkg?.tool_needs || {})
      .filter(
        ([, need]) => String(need?.necessity || "").toLowerCase() === "required"
      )
      .map(([capability]) => capability)
      .filter(capability => !HERMES_TOOLSETS_BY_CAPABILITY[capability])
      .sort();
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
        status: compatibility.level === "L1" ? "pass" : "warn",
        detail: `Standalone Hermes compatibility computed as ${compatibility.level}.`,
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
      {
        id: "standalone_capability_boundary",
        status: unsupportedRequired.length > 0 ? "fail" : "pass",
        detail:
          unsupportedRequired.length > 0
            ? `Standalone Hermes cannot safely expose required capabilities without a CrewClaw gateway: ${unsupportedRequired.join(", ")}.`
            : `Only fail-closed read-only bundles are enabled: ${compiledToolsets.join(", ") || "none"}.`,
      },
    ];
    const fixes = [];

    if (!validation.ok)
      fixes.push(
        ...validation.errors.map(error => `Fix package validation: ${error}`)
      );
    if (compatibility.level !== "L1") fixes.push(...compatibility.reasons);
    if (unsupportedRequired.length > 0)
      fixes.push(
        "Run this employee through the CrewClaw capability gateway, or install a separately audited read-only MCP that covers the missing capabilities."
      );

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
