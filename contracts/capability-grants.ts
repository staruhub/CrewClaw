export const CAPABILITY_GRANT_PREFIX = "capability:";

export type CapabilityDeclaration = {
  capability: string;
  necessity: string;
  permission: string;
};

export type CapabilityGrantValidation = {
  capabilityTokens: string[];
  invalidCapabilityTokens: string[];
  missingRequiredCapabilities: string[];
};

/**
 * A declared capability id is honoured only when it is well formed: non-empty,
 * free of whitespace, and free of ":" (the token separator). Without this check
 * a malformed declaration such as "" would turn the bare prefix "capability:"
 * into an accepted grant.
 */
function isWellFormedCapabilityId(id: string) {
  return id.length > 0 && !/[\s:]/.test(id);
}

/**
 * The single grantability rule. A capability can be granted only when it is
 * declared, its id is well formed, and neither `necessity` nor `permission`
 * disables it. Minting (src/lib/capability-grants.ts) and validation must both
 * go through this predicate so the hire path can never emit a token its own
 * validator refuses — one rule, one place.
 */
export function isGrantableCapability(
  capability: CapabilityDeclaration | undefined
): capability is CapabilityDeclaration {
  return (
    capability !== undefined &&
    isWellFormedCapabilityId(capability.capability) &&
    capability.necessity !== "disabled" &&
    capability.permission !== "disabled"
  );
}

/**
 * Minting and validation resolve a capability id to its declaration the same
 * way: through this map, where a duplicated id resolves to the last
 * declaration. Sharing the resolution keeps both paths in agreement even for
 * pathological duplicate contracts.
 */
export function declarationsById(
  capabilities: readonly CapabilityDeclaration[]
) {
  return new Map(
    capabilities.map(capability => [capability.capability, capability])
  );
}

/**
 * Legacy hire.yaml scopes are not capability grants. Keep every malformed or
 * legacy token visible to the caller so a hire/update cannot silently accept an
 * authorization payload it does not understand.
 *
 * `missingRequiredCapabilities` lists every required capability absent from the
 * ACCEPTED grant set — including the unsatisfiable case of a required
 * declaration that can never be granted (permission "disabled", malformed id).
 * A caller that checks only that field can therefore never mistake a refused
 * grant for success.
 */
export function validateCapabilityGrantTokens(
  capabilities: CapabilityDeclaration[],
  grants: string[]
): CapabilityGrantValidation {
  const declared = declarationsById(capabilities);
  const requested = new Set(grants);
  const invalidCapabilityTokens = new Set<string>();

  for (const grant of grants) {
    if (!grant.startsWith(CAPABILITY_GRANT_PREFIX)) {
      invalidCapabilityTokens.add(grant);
      continue;
    }
    if (
      !isGrantableCapability(
        declared.get(grant.slice(CAPABILITY_GRANT_PREFIX.length))
      )
    ) {
      invalidCapabilityTokens.add(grant);
    }
  }

  const capabilityTokens = capabilities
    .map(capability => `${CAPABILITY_GRANT_PREFIX}${capability.capability}`)
    .filter(
      token => requested.has(token) && !invalidCapabilityTokens.has(token)
    );
  const accepted = new Set(capabilityTokens);
  const missingRequiredCapabilities = capabilities
    .filter(capability => capability.necessity === "required")
    .map(capability => `${CAPABILITY_GRANT_PREFIX}${capability.capability}`)
    .filter(token => !accepted.has(token));

  return {
    capabilityTokens,
    invalidCapabilityTokens: [...invalidCapabilityTokens],
    missingRequiredCapabilities,
  };
}
