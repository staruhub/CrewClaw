// Permission classification helpers, split out of components/employee/PermissionLevel.tsx so that
// file only exports components (react-refresh/only-export-components — mixed exports break HMR).

export type PermissionRiskLevel =
  | "Disabled"
  | "Read-only"
  | "Write with confirmation"
  | "Autonomous write"
  | "Sensitive action";

export function permissionLabel(permission: string) {
  return permission
    .replace(/:disabled_by_default/g, " (disabled by default)")
    .replace(/:human_confirmation_required/g, " (human confirmation required)")
    .replace(/:disabled/g, " (disabled)")
    .replace(/_/g, " ");
}

export function getPermissionLevel(permission: string): PermissionRiskLevel {
  const value = permission.toLowerCase();

  // A policy-forbidden capability must never be reclassified as an autonomous write merely
  // because its descriptive id also contains `:write`.
  if (value.includes("disabled")) return "Disabled";

  if (
    value.includes("delete") ||
    value.includes("payment") ||
    value.includes("billing:charge") ||
    value.includes("invoice:pay") ||
    value.includes("pay:") ||
    value.includes("付款") ||
    value.includes("支付") ||
    value === "mailbox:send" ||
    value.includes("email:send") ||
    value.includes("message:send") ||
    value.includes("contacts:write")
  ) {
    return "Sensitive action";
  }

  if (
    value.includes("human_confirmation_required") ||
    value.includes("confirmation")
  ) {
    return "Write with confirmation";
  }

  if (
    value.includes(":write") ||
    value.includes(" write") ||
    value.includes("write:")
  ) {
    return "Autonomous write";
  }

  return "Read-only";
}
