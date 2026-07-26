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

// Classification is FAIL-CLOSED. HireConfirm switches every permission that is not
// "Sensitive action" (and not disabled) ON by default, so the permissive levels must
// be earned by an affirmative match — they are never a fallback.
//
// Separators: `:` and `.` are equivalent segment separators (the registry's
// permissions[] use colons, tool_capabilities ids use dots), and `_`, `-`, and
// whitespace additionally split words, so `member_data.write`, `member_data:write`,
// and `member data write` all classify identically.
//
// Precedence (first match wins):
//   1. Disabled — the TRAILING `:`/`.` segment is exactly the policy modifier
//      `disabled` / `disabled_by_default`. Anchoring to the tail keeps a mid-id
//      "disabled" mention (payments:reenable_disabled_cards:write,
//      mailbox:send_when_alerts_disabled) from masking a live write/send, while a
//      real trailing modifier still outranks the risky keywords in the capability
//      it switches off (code:write:disabled).
//   2. Sensitive action — money movement, data deletion, person-to-person sends,
//      contact writes.
//   3. Write with confirmation — a human confirmation marker.
//   4. Autonomous write — an explicit write, or a generic outbound send that did
//      not pair with a person-to-person channel in step 2. Generic send must rank
//      below step 3 so broadcast:send:human_confirmation_required keeps its
//      confirmation gate.
//   5. Read-only — an affirmative read marker, and only that. Never the default.
//   6. Sensitive action — the fallback for anything unrecognized, so an unknown
//      capability is never enabled by default (deny by default).
export function getPermissionLevel(permission: string): PermissionRiskLevel {
  const value = permission.trim().toLowerCase();
  const segments = value
    .split(/[:.]/)
    .map(segment => segment.trim().replace(/-/g, "_"));
  const tokens = value.split(/[\s:._-]+/).filter(token => token.length > 0);
  const has = (token: string) => tokens.includes(token);

  // 1. Disabled — only as the trailing policy segment.
  const tail = segments[segments.length - 1];
  if (tail === "disabled" || tail === "disabled_by_default") return "Disabled";

  // 2. Sensitive action.
  const movesMoney =
    has("pay") ||
    tokens.some(token => token.startsWith("payment")) ||
    (has("billing") && has("charge")) ||
    value.includes("付款") ||
    value.includes("支付");
  const deletesData = tokens.some(token => token.startsWith("delete"));
  const sendsToPeople =
    has("send") &&
    ["mailbox", "mail", "email", "message", "messages", "sms", "dm"].some(has);
  const writesContacts = (has("contact") || has("contacts")) && has("write");
  if (movesMoney || deletesData || sendsToPeople || writesContacts) {
    return "Sensitive action";
  }

  // 3. Write with confirmation.
  if (has("confirmation")) return "Write with confirmation";

  // 4. Autonomous write (explicit write, or generic outbound send).
  if (has("write") || has("send")) return "Autonomous write";

  // 5. Read-only — must be claimed explicitly.
  if (has("read") || has("readonly")) return "Read-only";

  // 6. Unknown ⇒ most restrictive.
  return "Sensitive action";
}
