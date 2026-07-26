import type { Employee } from "@/data/employees";

type CapabilityOnboardingEmployee = Pick<Employee, "tool_capabilities">;

/**
 * Picks the form that agrees with `count`. Used for nouns and for the verbs
 * that follow them, so a pluralized subject never keeps a singular verb.
 */
function agreeCopy(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function countCopy(count: number, singular: string, plural: string) {
  return `${count} ${agreeCopy(count, singular, plural)}`;
}

/**
 * Builds setup guidance from the employee's declared capability contract.
 * It deliberately uses behavior, scope, and provider metadata instead of a
 * hand-maintained list of capability IDs, so newly catalogued tools receive
 * accurate onboarding guidance without a UI code change.
 */
export function capabilityOnboardingRequirements(
  employee: CapabilityOnboardingEmployee
) {
  const active = employee.tool_capabilities.filter(
    capability =>
      capability.necessity !== "disabled" &&
      capability.permission !== "disabled"
  );
  const requirements = [
    active.length > 0
      ? `Review capability authorization for ${countCopy(active.length, "declared tool capability", "declared tool capabilities")} before onboarding this employee.`
      : "Review the employee's capability authorization before onboarding.",
  ];
  const scopedReadCapabilities = active.filter(
    capability =>
      capability.operation === "read" && capability.scopes.length > 0
  );
  if (scopedReadCapabilities.length > 0) {
    requirements.push(
      `Provide only the declared read scopes when ${countCopy(scopedReadCapabilities.length, "read capability", "read capabilities")} ${agreeCopy(scopedReadCapabilities.length, "needs", "need")} task context.`
    );
  }

  const adapterCapabilities = active.filter(
    capability => capability.availability === "adapter_required"
  );
  if (adapterCapabilities.length > 0) {
    requirements.push(
      `Configure and authorize the provider adapter required by ${countCopy(adapterCapabilities.length, "capability", "capabilities")} before assigning dependent tasks.`
    );
  }

  const approvalCapabilities = active.filter(
    capability =>
      capability.permission === "requires_authorization" ||
      capability.approval === "always"
  );
  if (approvalCapabilities.length > 0) {
    requirements.push(
      `Keep a human available for the ${countCopy(approvalCapabilities.length, "capability", "capabilities")} that can pause for authorization.`
    );
  }

  // Presence, not truthiness: a declared cap of 0 is the most restrictive
  // limit there is, so it must surface rather than read as "no limits".
  const boundedCapabilities = active.filter(
    capability =>
      capability.limits?.max_calls_per_task !== undefined ||
      capability.limits?.timeout_ms !== undefined
  );
  if (boundedCapabilities.length > 0) {
    requirements.push(
      `${countCopy(boundedCapabilities.length, "capability", "capabilities")} ${agreeCopy(boundedCapabilities.length, "has", "have")} declared task limits; review them before assigning high-volume work.`
    );
  }

  return requirements;
}
