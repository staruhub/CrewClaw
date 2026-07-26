import {
  toolCapabilitiesForHire,
  type EmployeeToolCapability,
} from "@/data/employees";
import {
  CAPABILITY_GRANT_PREFIX,
  declarationsById,
  isGrantableCapability,
} from "@contracts/capability-grants";

// The grantability rule and the validator live in @contracts so the website and the
// real hire endpoint (api/lib/local-team.ts) share one source of truth. Re-exported
// here so existing frontend imports keep working; do not reimplement either locally.
export {
  CAPABILITY_GRANT_PREFIX,
  validateCapabilityGrantTokens,
} from "@contracts/capability-grants";
export type { CapabilityGrantValidation } from "@contracts/capability-grants";

/**
 * Mints the grant tokens for a hire. Filtered through the same
 * `isGrantableCapability` predicate the validator uses, so this can never emit a
 * token that `validateCapabilityGrantTokens` would place in
 * `invalidCapabilityTokens`.
 */
export function capabilityGrantTokensForHire(
  capabilities: EmployeeToolCapability[],
  selectedCapabilities: string[]
) {
  const declared = declarationsById(capabilities);
  return toolCapabilitiesForHire(capabilities, selectedCapabilities)
    .filter(capability => isGrantableCapability(declared.get(capability)))
    .map(capability => `${CAPABILITY_GRANT_PREFIX}${capability}`);
}
