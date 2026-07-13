import {
  toolCapabilitiesForHire,
  type EmployeeToolCapability,
} from "@/data/employees";

export const CAPABILITY_GRANT_PREFIX = "capability:";

export type CapabilityGrantValidation = {
  capabilityTokens: string[];
  invalidCapabilityTokens: string[];
  missingRequiredCapabilities: string[];
};

export function capabilityGrantTokensForHire(
  capabilities: EmployeeToolCapability[],
  selectedCapabilities: string[]
) {
  return toolCapabilitiesForHire(capabilities, selectedCapabilities).map(
    capability => `${CAPABILITY_GRANT_PREFIX}${capability}`
  );
}

/**
 * Legacy hire.yaml scopes are not capability grants. Keep every malformed or
 * legacy token visible to the caller so a hire/update cannot silently accept
 * an authorization payload it does not understand.
 */
export function validateCapabilityGrantTokens(
  capabilities: EmployeeToolCapability[],
  grants: string[]
): CapabilityGrantValidation {
  const declared = new Map(
    capabilities.map(capability => [capability.capability, capability])
  );
  const capabilityTokens = new Set<string>();
  const invalidCapabilityTokens = new Set<string>();

  for (const grant of grants) {
    if (!grant.startsWith(CAPABILITY_GRANT_PREFIX)) {
      invalidCapabilityTokens.add(grant);
      continue;
    }

    const capabilityId = grant.slice(CAPABILITY_GRANT_PREFIX.length);
    const capability = declared.get(capabilityId);
    if (
      !capability ||
      capability.necessity === "disabled" ||
      capability.permission === "disabled"
    ) {
      invalidCapabilityTokens.add(grant);
      continue;
    }
    capabilityTokens.add(grant);
  }

  const missingRequiredCapabilities = capabilities
    .filter(capability => capability.necessity === "required")
    .map(capability => `${CAPABILITY_GRANT_PREFIX}${capability.capability}`)
    .filter(token => !capabilityTokens.has(token));

  return {
    capabilityTokens: [...capabilityTokens],
    invalidCapabilityTokens: [...invalidCapabilityTokens],
    missingRequiredCapabilities,
  };
}
