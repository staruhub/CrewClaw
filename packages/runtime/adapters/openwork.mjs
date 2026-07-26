import { computeCompatibility } from "../compatibility.mjs";
import { validateEmployeePackage } from "../employee-package.mjs";
import { derivePermissionPolicy } from "../permission-policy.mjs";
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

const UNPROBED_CAPABILITIES = Object.freeze({
  detected: false,
  probed: false,
  tools: false,
  events: false,
  memory: false,
  permissions: false,
  artifacts: false,
  outcome: false,
  workspace: false,
  long_running: false,
  tasks: false,
  logs: false,
  doctor: false,
  basic_acceptance: false,
  hire: false,
  onboard: false,
  workbench: false,
  artifact: false,
  dream: false,
  capabilities: [],
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

function capabilityId(name) {
  return String(name)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function objectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

function toolBindings(pkg) {
  const policy = derivePermissionPolicy(
    pkg?.tool_needs || {},
    pkg?.permission_policy || {}
  );
  return objectEntries(pkg?.tool_needs).map(([name, need]) => {
    const disabled = String(need?.necessity || "").toLowerCase() === "disabled";
    return {
      capability: capabilityId(name),
      crewclaw_capability: name,
      necessity: need?.necessity || "optional",
      permission: need?.permission || "unspecified",
      permission_level:
        policy.grants?.[name] ||
        policy.denied?.[name] ||
        policy.default_level ||
        "P1",
      description: need?.description || "",
      enabled: !disabled,
      binding_type: "abstract-capability",
    };
  });
}

function permissionGatewayRules(pkg) {
  const policy = derivePermissionPolicy(
    pkg?.tool_needs || {},
    pkg?.permission_policy || {}
  );
  const grants = policy.grants || {};
  const denied = policy.denied || {};
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
    default_level: policy.default_level || "P1",
    tier_order: ["P0", "P1", "P2", "P3", "P4"],
    tiers,
    human_authorization_required: toArray(
      policy.human_authorization_required
    ).map(String),
    levels: policy.levels || {},
  };
}

function compileBlueprint(pkg) {
  const identity = pkg?.identity || {};
  const smoke = Array.isArray(pkg?.eval_suite?.smoke_tests)
    ? pkg.eval_suite.smoke_tests[0]
    : null;
  return {
    [BLUEPRINT_KEYS[0]]: {
      id: identity.id || "",
      name: identity.name || identity.english_name || "",
      english_name: identity.english_name || "",
      avatar: identity.avatar || "",
      author: identity.author || "",
      version: identity.version || "",
      certification: identity.certification || "",
      title: identity.title || pkg?.role_contract?.title || "",
      description: identity.description || "",
    },
    [BLUEPRINT_KEYS[1]]: {
      title: pkg?.role_contract?.title || "",
      mission: pkg?.role_contract?.mission || "",
      responsibilities: toArray(pkg?.role_contract?.responsibilities),
      not_responsible_for: toArray(pkg?.role_contract?.not_responsible_for),
      best_for: toArray(pkg?.role_contract?.best_for),
    },
    [BLUEPRINT_KEYS[2]]: toolBindings(pkg),
    [BLUEPRINT_KEYS[3]]: permissionGatewayRules(pkg),
    [BLUEPRINT_KEYS[4]]: toArray(pkg?.deliverables).map(deliverable => ({
      type: deliverable?.type || capabilityId(deliverable?.name || deliverable),
      name: deliverable?.name || deliverable?.type || String(deliverable),
      template_source: "crewclaw-deliverable",
    })),
    [BLUEPRINT_KEYS[5]]: toArray(pkg?.outcome_rubric).map(rule => ({
      id: rule?.id || capabilityId(rule?.criterion || rule),
      weight: rule?.weight ?? null,
      criterion: rule?.criterion || String(rule),
    })),
    [BLUEPRINT_KEYS[6]]: pkg?.memory_seed || {},
    [BLUEPRINT_KEYS[7]]: {
      policy: pkg?.dream_policy || {},
      trigger: "post-task",
    },
    [BLUEPRINT_KEYS[8]]: {
      ...(pkg?.workbench_profile || {}),
      first_trial: smoke
        ? {
            id: smoke.id,
            task: smoke.task,
            acceptance: toArray(smoke.acceptance),
          }
        : null,
    },
  };
}

function smokeDescriptor(pkg) {
  const smoke = Array.isArray(pkg?.eval_suite?.smoke_tests)
    ? pkg.eval_suite.smoke_tests[0]
    : null;
  return {
    ok: false,
    reason: "openwork_contract_unconfigured",
    id: smoke?.id || null,
    task: smoke?.task || null,
    runtime: "openwork",
    dry_run: true,
  };
}

export const openworkAdapter = defineAdapter({
  id: "openwork",
  name: "OpenWork Adapter",
  targetLevel: "L4",

  detect() {
    return {
      ok: false,
      status: "contract_required",
      version: null,
      reason:
        "The owner's OpenWork contract and endpoint are not configured; no third-party OpenWork API is assumed.",
    };
  },

  capabilities() {
    return structuredClone(UNPROBED_CAPABILITIES);
  },

  validate(pkg) {
    const delegated = validateEmployeePackage(pkg);
    const errors = new Set(delegated.errors || []);
    if (!hasValue(pkg?.runtime_requirements))
      errors.add("Missing required OpenWork field: runtime_requirements");
    return { ok: errors.size === 0, errors: [...errors] };
  },

  compile: compileBlueprint,
  install() {
    return { ok: false, reason: "openwork_contract_unconfigured" };
  },

  doctor(pkg) {
    const validation = this.validate(pkg);
    const compatibility = computeCompatibility(pkg, this.capabilities());
    return {
      status: "needs_attention",
      target_level: "L4",
      observed_level: compatibility.level,
      checks: [
        {
          id: "employee_package",
          status: validation.ok ? "pass" : "fail",
          detail: validation.ok
            ? "Employee package is valid."
            : validation.errors.join("; "),
        },
        {
          id: "runtime_contract",
          status: "fail",
          detail:
            "Owner OpenWork contract and live endpoint are required before capability claims.",
        },
      ],
      fixes: [
        ...(validation.errors || []),
        "Configure the owner's OpenWork contract, implementation path, and live endpoint.",
      ],
    };
  },

  runSmokeTest: smokeDescriptor,
  collectEvents() {
    return { ok: false, reason: "openwork_contract_unconfigured", events: [] };
  },
  collectArtifacts() {
    return {
      ok: false,
      reason: "openwork_contract_unconfigured",
      artifacts: [],
    };
  },
  uninstall() {
    return { ok: false, reason: "openwork_contract_unconfigured" };
  },
});

export default openworkAdapter;
