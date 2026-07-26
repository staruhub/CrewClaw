// Single source of truth for deriving permission_policy from tool_needs.
// Authors may still ship an explicit permission_policy block for human-readable
// tier labels, but grants / denied / human_authorization_required must not
// drift from the tool_needs contract that the runtime actually enforces.

const TIER_LABELS = Object.freeze({
  P0: "read-public",
  P1: "workspace-write",
  P2: "authorized-sensitive",
  P3: "external-side-effects",
  P4: "delete-pay-permissions",
});

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Map one tool_needs permission enum onto a P0–P4 tier.
 * Fail-closed: unknown / missing → P4.
 */
export function permissionTierForNeed(need = {}) {
  const permission = String(need?.permission || "").trim();
  switch (permission) {
    case "readonly":
      return "P0";
    case "write":
      return "P1";
    case "requires_authorization":
      return "P2";
    case "disabled":
      return "P4";
    default:
      return "P4";
  }
}

/**
 * Derive the grants / denied / human_authorization_required maps from tool_needs.
 * Optional authored labels (levels / default_level) are preserved when present.
 */
export function derivePermissionPolicy(toolNeeds = {}, authored = {}) {
  const needs = isRecord(toolNeeds) ? toolNeeds : {};
  const base = isRecord(authored) ? authored : {};
  const grants = {};
  const denied = {};
  const humanAuthorization = [];

  for (const [capability, need] of Object.entries(needs)) {
    if (!capability) continue;
    const tier = permissionTierForNeed(need);
    if (String(need?.permission || "") === "disabled") {
      denied[capability] = tier;
      continue;
    }
    grants[capability] = tier;
    if (String(need?.permission || "") === "requires_authorization") {
      humanAuthorization.push(capability);
    }
  }

  const levels = isRecord(base.levels)
    ? { ...TIER_LABELS, ...base.levels }
    : { ...TIER_LABELS };

  return {
    default_level:
      typeof base.default_level === "string" && base.default_level.trim()
        ? base.default_level.trim()
        : "P1",
    levels,
    grants,
    denied,
    human_authorization_required: humanAuthorization.sort(),
  };
}
