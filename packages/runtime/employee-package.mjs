import { readFileSync } from "node:fs";
import { derivePermissionPolicy } from "./permission-policy.mjs";
import yaml from "./yaml.mjs";

// Exported so contracts/__tests__/employee-spec.test.ts can assert this list stays identical to
// EmployeeSpecSchema's required keys (contracts/employee-spec.ts) — two sources, one drift guard.
export const REQUIRED_FIELDS = [
  "identity",
  "role_contract",
  "soul",
  "deliverables",
  "tool_needs",
  "permission_policy",
  "eval_suite",
  "outcome_rubric",
  "compatibility_targets",
];

const BLOCKED_TOOL_PROVIDERS = new Set([
  "tavily",
  "playwright",
  "bash",
  "curl",
  "selenium",
  "puppeteer",
  "serper",
]);

const COMPATIBILITY_LEVELS = new Set(["L0", "L1", "L2", "L3", "L4"]);
const PERMISSION_LEVELS = new Set(["P0", "P1", "P2", "P3", "P4"]);

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function visitStrings(value, visitor, path = []) {
  if (typeof value === "string") {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitStrings(item, visitor, path.concat(String(index)))
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visitor(key, path.concat(key), { isKey: true });
      visitStrings(item, visitor, path.concat(key));
    }
  }
}

function collectBlockedToolProviders(toolNeeds) {
  const found = new Set();
  visitStrings(toolNeeds, value => {
    const normalized = String(value).toLowerCase();
    for (const provider of BLOCKED_TOOL_PROVIDERS) {
      const pattern = new RegExp(
        `(^|[^a-z0-9_-])${provider}([^a-z0-9_-]|$)`,
        "i"
      );
      if (pattern.test(normalized)) found.add(provider);
    }
  });
  return [...found].sort();
}

function collectLevelErrors(value, allowed, label) {
  const errors = [];
  visitStrings(value, (raw, path) => {
    const level = String(raw).trim();
    if (/^[LP]\d+$/.test(level) && !allowed.has(level)) {
      errors.push(
        `${label} has invalid level ${level} at ${path.join(".") || "<root>"}`
      );
    }
  });
  return errors;
}

export function validateEmployeePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { ok: false, errors: ["Employee package must be a YAML object"] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!hasValue(pkg[field])) errors.push(`Missing required field: ${field}`);
  }

  if (!hasValue(pkg.deliverables))
    errors.push("deliverables must be non-empty");
  if (!hasValue(pkg.outcome_rubric))
    errors.push("outcome_rubric must be non-empty");

  if (hasValue(pkg.tool_needs)) {
    const blocked = collectBlockedToolProviders(pkg.tool_needs);
    if (blocked.length > 0) {
      errors.push(
        `tool_needs must use abstract tools, not provider names: ${blocked.join(", ")}`
      );
    }
  }

  if (hasValue(pkg.compatibility_targets)) {
    errors.push(
      ...collectLevelErrors(
        pkg.compatibility_targets,
        COMPATIBILITY_LEVELS,
        "compatibility_targets"
      )
    );
  }

  if (hasValue(pkg.permission_policy)) {
    errors.push(
      ...collectLevelErrors(
        pkg.permission_policy,
        PERMISSION_LEVELS,
        "permission_policy"
      )
    );
  }

  // Dual-truth guard: when authors publish grants/denied/auth maps, membership must
  // match tool_needs. Tier labels may still be human-authored (P2 vs P3 nuance);
  // adapters always re-derive from tool_needs at runtime.
  if (hasValue(pkg.tool_needs) && hasValue(pkg.permission_policy)) {
    const derived = derivePermissionPolicy(
      pkg.tool_needs,
      pkg.permission_policy
    );
    const authored = pkg.permission_policy;
    const authoredGrants =
      authored.grants &&
      typeof authored.grants === "object" &&
      !Array.isArray(authored.grants)
        ? authored.grants
        : null;
    const authoredDenied =
      authored.denied &&
      typeof authored.denied === "object" &&
      !Array.isArray(authored.denied)
        ? authored.denied
        : null;
    const authoredAuth = Array.isArray(authored.human_authorization_required)
      ? authored.human_authorization_required
      : null;
    if (authoredGrants) {
      for (const id of Object.keys(derived.grants)) {
        if (!Object.hasOwn(authoredGrants, id)) {
          errors.push(
            `permission_policy.grants missing capability declared in tool_needs: ${id}`
          );
        }
      }
      for (const id of Object.keys(authoredGrants)) {
        if (!Object.hasOwn(derived.grants, id)) {
          errors.push(
            `permission_policy.grants references capability not granted by tool_needs: ${id}`
          );
        }
      }
    }
    if (authoredDenied) {
      for (const id of Object.keys(derived.denied)) {
        if (!Object.hasOwn(authoredDenied, id)) {
          errors.push(
            `permission_policy.denied missing capability disabled in tool_needs: ${id}`
          );
        }
      }
      for (const id of Object.keys(authoredDenied)) {
        if (!Object.hasOwn(derived.denied, id)) {
          errors.push(
            `permission_policy.denied references capability not disabled in tool_needs: ${id}`
          );
        }
      }
    }
    if (authoredAuth) {
      const authSet = new Set(authoredAuth);
      for (const id of derived.human_authorization_required) {
        if (!authSet.has(id)) {
          errors.push(
            `permission_policy.human_authorization_required missing requires_authorization capability: ${id}`
          );
        }
      }
      for (const id of authSet) {
        if (!derived.human_authorization_required.includes(id)) {
          errors.push(
            `permission_policy.human_authorization_required references non-gated capability: ${id}`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function loadEmployeePackage(path) {
  try {
    const parsed = yaml.load(readFileSync(path, "utf8")) || {};
    const validation = validateEmployeePackage(parsed);
    if (!validation.ok)
      return { ok: false, errors: validation.errors, package: parsed, path };
    return { ok: true, package: parsed, path };
  } catch (error) {
    return { ok: false, errors: [error?.message ?? String(error)], path };
  }
}

export function toLegacyProfile(pkg) {
  const identity = pkg?.identity || {};
  const role = pkg?.role_contract || {};
  const skills = Array.isArray(pkg?.playbooks)
    ? pkg.playbooks
        .map(playbook => playbook?.id || playbook?.name || playbook)
        .filter(Boolean)
    : [];

  const toolNeeds = pkg?.tool_needs || {};
  // Runtime consumers always see the tool_needs-derived policy so adapters cannot
  // diverge from the contract the gateway actually enforces.
  const permissionPolicy = derivePermissionPolicy(
    toolNeeds,
    pkg?.permission_policy || {}
  );

  return {
    displayName: identity.name || identity.display_name || identity.id || "",
    title: identity.title || role.title || "",
    description: identity.description || role.mission || "",
    version: identity.version || pkg?.version || "",
    skills,
    runtime: {
      tool_needs: toolNeeds,
      permission_policy: permissionPolicy,
      compatibility_targets: pkg?.compatibility_targets || {},
      adapter_hints: pkg?.adapter_hints || {},
    },
    system: [
      identity.name ? `You are ${identity.name}.` : "",
      identity.title ? `Role: ${identity.title}.` : "",
      role.mission ? `Mission: ${role.mission}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
