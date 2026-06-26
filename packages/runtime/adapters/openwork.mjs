import { computeCompatibility } from "../compatibility.mjs";
import { validateEmployeePackage } from "../employee-package.mjs";
import { defineAdapter } from "./adapter-interface.mjs";

const BLUEPRINT_KEYS = Object.freeze([
  "employee_card",
  "workspace_instructions",
  "tool_bindings",
  "permission_gateway_rules",
  "artifact_templates",
  "task_acceptance_rules",
  "workspace_memory",
  "reflection_job",
  "workspace_ui_layout",
]);

const PERMISSION_TIERS = Object.freeze({
  P0: Object.freeze({
    scope: "read-public",
    auto_allow: true,
    approval_required: false,
    confirm_mode: "none",
    default_action: "allow",
  }),
  P1: Object.freeze({
    scope: "workspace-write",
    auto_allow: false,
    approval_required: true,
    confirm_mode: "standard",
    default_action: "ask",
  }),
  P2: Object.freeze({
    scope: "authorized-sensitive",
    auto_allow: false,
    approval_required: true,
    confirm_mode: "standard",
    default_action: "ask",
  }),
  P3: Object.freeze({
    scope: "external-side-effects",
    auto_allow: false,
    approval_required: true,
    confirm_mode: "strong-confirm",
    default_action: "ask",
  }),
  P4: Object.freeze({
    scope: "delete-pay-permissions",
    auto_allow: false,
    approval_required: true,
    confirm_mode: "strong-confirm",
    default_action: "deny",
  }),
});

const OPENWORK_CAPABILITY_LIST = Object.freeze([
  "web.search",
  "web.extract",
  "web.fetch_extract",
  "source.verify",
  "evidence.create",
  "artifact.report",
  "browser.render",
  "shell.run",
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

function capabilityId(name) {
  return String(name).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function objectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function toolBindings(pkg) {
  return objectEntries(pkg?.tool_needs).map(([name, need]) => {
    const disabled = String(need?.necessity || "").toLowerCase() === "disabled";
    return {
      capability: capabilityId(name),
      crewclaw_capability: name,
      necessity: need?.necessity || "optional",
      permission: need?.permission || "unspecified",
      permission_level: pkg?.permission_policy?.grants?.[name] || pkg?.permission_policy?.denied?.[name] || pkg?.permission_policy?.default_level || "P1",
      description: need?.description || "",
      enabled: !disabled,
      binding_type: "abstract-capability",
    };
  });
}

function permissionGatewayRules(pkg) {
  const grants = pkg?.permission_policy?.grants || {};
  const denied = pkg?.permission_policy?.denied || {};
  const tiers = {};

  for (const [tier, rule] of Object.entries(PERMISSION_TIERS)) {
    tiers[tier] = {
      ...rule,
      grants: Object.entries(grants)
        .filter(([, level]) => level === tier)
        .map(([capability]) => capabilityId(capability))
        .sort(),
      denied: Object.entries(denied)
        .filter(([, level]) => level === tier)
        .map(([capability]) => capabilityId(capability))
        .sort(),
    };
  }

  return {
    default_level: pkg?.permission_policy?.default_level || "P1",
    tier_order: ["P0", "P1", "P2", "P3", "P4"],
    tiers,
    human_authorization_required: toArray(pkg?.permission_policy?.human_authorization_required).map(String),
    levels: pkg?.permission_policy?.levels || {},
  };
}

function artifactTemplates(pkg) {
  return toArray(pkg?.deliverables).map((deliverable) => ({
    type: deliverable?.type || capabilityId(deliverable?.name || deliverable),
    name: deliverable?.name || deliverable?.type || String(deliverable),
    template_source: "crewclaw-deliverable",
  }));
}

function taskAcceptanceRules(pkg) {
  return toArray(pkg?.outcome_rubric).map((rule) => ({
    id: rule?.id || capabilityId(rule?.criterion || rule),
    weight: rule?.weight ?? null,
    criterion: rule?.criterion || String(rule),
  }));
}

function workspaceInstructions(pkg) {
  return {
    title: pkg?.role_contract?.title || "",
    mission: pkg?.role_contract?.mission || "",
    responsibilities: toArray(pkg?.role_contract?.responsibilities),
    not_responsible_for: toArray(pkg?.role_contract?.not_responsible_for),
    best_for: toArray(pkg?.role_contract?.best_for),
  };
}

function employeeCard(pkg) {
  const identity = pkg?.identity || {};
  return {
    id: identity.id || "",
    name: identity.name || identity.english_name || "",
    english_name: identity.english_name || "",
    avatar: identity.avatar || "",
    author: identity.author || "",
    version: identity.version || "",
    certification: identity.certification || "",
    title: identity.title || pkg?.role_contract?.title || "",
    description: identity.description || "",
  };
}

function smokeDescriptor(pkg) {
  const smoke =
    (Array.isArray(pkg?.eval_suite?.smoke_tests) && pkg.eval_suite.smoke_tests[0]) ||
    (Array.isArray(pkg?.eval_suite) && pkg.eval_suite[0]);

  return {
    id: smoke?.id || "research-seed-2.1",
    name: "Seed 2.1 OpenWork eval trial",
    seed: "Seed 2.1",
    task: smoke?.task || "Research Seed 2.1 and decide whether it is suitable for CrewClaw.",
    acceptance: toArray(smoke?.acceptance),
    runtime: "openwork",
    trial_type: "eval",
    dry_run: true,
  };
}

function openworkCapabilities() {
  return {
    tools: true,
    events: true,
    memory: true,
    permissions: true,
    artifacts: "full",
    outcome: true,
    outcome_level: "full",
    workspace: true,
    long_running: true,
    tasks: true,
    logs: true,
    doctor: true,
    basic_acceptance: true,
    hire: true,
    onboard: true,
    workbench: true,
    artifact: true,
    dream: true,
    search: true,
    browser: true,
    source: true,
    evidence: true,
    shell: true,
    capabilities: [...OPENWORK_CAPABILITY_LIST],
  };
}

export const openworkAdapter = defineAdapter({
  id: "openwork",
  name: "OpenWork Adapter",
  targetLevel: "L4",

  capabilities: openworkCapabilities,

  validate(pkg) {
    const delegated = validateEmployeePackage(pkg);
    const errors = new Set(delegated.errors || []);
    if (!hasValue(pkg?.runtime_requirements)) {
      errors.add("Missing required OpenWork field: runtime_requirements");
    }
    return { ok: errors.size === 0, errors: [...errors] };
  },

  compile(pkg) {
    return {
      [BLUEPRINT_KEYS[0]]: employeeCard(pkg),
      [BLUEPRINT_KEYS[1]]: workspaceInstructions(pkg),
      [BLUEPRINT_KEYS[2]]: toolBindings(pkg),
      [BLUEPRINT_KEYS[3]]: permissionGatewayRules(pkg),
      [BLUEPRINT_KEYS[4]]: artifactTemplates(pkg),
      [BLUEPRINT_KEYS[5]]: taskAcceptanceRules(pkg),
      [BLUEPRINT_KEYS[6]]: pkg?.memory_seed || {},
      [BLUEPRINT_KEYS[7]]: {
        policy: pkg?.dream_policy || {},
        trigger: "post-task",
      },
      [BLUEPRINT_KEYS[8]]: pkg?.workbench_profile || {},
    };
  },

  doctor(pkg) {
    const validation = this.validate(pkg);
    const compatibility = computeCompatibility(pkg, this.capabilities());
    const blueprint = validation.ok ? this.compile(pkg) : null;
    const checks = [
      {
        id: "employee_package",
        status: validation.ok ? "pass" : "fail",
        detail: validation.ok ? "Employee package validates for OpenWork." : validation.errors.join("; "),
      },
      {
        id: "compatibility",
        status: compatibility.level === "L4" ? "pass" : "warn",
        detail: `OpenWork compatibility computed as ${compatibility.level}.`,
      },
      {
        id: "workspace_blueprint",
        status: blueprint && Object.keys(blueprint).length === BLUEPRINT_KEYS.length ? "pass" : "skip",
        detail: blueprint ? Object.keys(blueprint).join(", ") : "Skipped because validation failed.",
      },
    ];

    return {
      status: checks.every((check) => check.status === "pass") ? "ok" : "needs_attention",
      target_level: "L4",
      checks,
      fixes: validation.ok ? compatibility.reasons : validation.errors,
    };
  },

  runSmokeTest(pkg) {
    return smokeDescriptor(pkg);
  },
});

export default openworkAdapter;
