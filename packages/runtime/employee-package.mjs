import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const REQUIRED_FIELDS = [
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
    value.forEach((item, index) => visitStrings(item, visitor, path.concat(String(index))));
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
  visitStrings(toolNeeds, (value) => {
    const normalized = String(value).toLowerCase();
    for (const provider of BLOCKED_TOOL_PROVIDERS) {
      const pattern = new RegExp(`(^|[^a-z0-9_-])${provider}([^a-z0-9_-]|$)`, "i");
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
      errors.push(`${label} has invalid level ${level} at ${path.join(".") || "<root>"}`);
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

  if (!hasValue(pkg.deliverables)) errors.push("deliverables must be non-empty");
  if (!hasValue(pkg.outcome_rubric)) errors.push("outcome_rubric must be non-empty");

  if (hasValue(pkg.tool_needs)) {
    const blocked = collectBlockedToolProviders(pkg.tool_needs);
    if (blocked.length > 0) {
      errors.push(`tool_needs must use abstract tools, not provider names: ${blocked.join(", ")}`);
    }
  }

  if (hasValue(pkg.compatibility_targets)) {
    errors.push(...collectLevelErrors(pkg.compatibility_targets, COMPATIBILITY_LEVELS, "compatibility_targets"));
  }

  if (hasValue(pkg.permission_policy)) {
    errors.push(...collectLevelErrors(pkg.permission_policy, PERMISSION_LEVELS, "permission_policy"));
  }

  return { ok: errors.length === 0, errors };
}

export function loadEmployeePackage(path) {
  try {
    const parsed = yaml.load(readFileSync(path, "utf8")) || {};
    const validation = validateEmployeePackage(parsed);
    if (!validation.ok) return { ok: false, errors: validation.errors, package: parsed, path };
    return { ok: true, package: parsed, path };
  } catch (error) {
    return { ok: false, errors: [error?.message ?? String(error)], path };
  }
}

export function toLegacyProfile(pkg) {
  const identity = pkg?.identity || {};
  const role = pkg?.role_contract || {};
  const skills = Array.isArray(pkg?.playbooks)
    ? pkg.playbooks.map((playbook) => playbook?.id || playbook?.name || playbook).filter(Boolean)
    : [];

  return {
    displayName: identity.name || identity.display_name || identity.id || "",
    title: identity.title || role.title || "",
    description: identity.description || role.mission || "",
    version: identity.version || pkg?.version || "",
    skills,
    runtime: {
      tool_needs: pkg?.tool_needs || {},
      permission_policy: pkg?.permission_policy || {},
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
