import { describe, expect, it } from "vitest";
import {
  getPermissionLevel,
  permissionLabel,
  type PermissionRiskLevel,
} from "./permissions";

// The exact permission strings shipped in src/data/employees.generated.json today.
// The hire flow renders a risk badge for each one AND derives the enabled-by-default
// switch from the level (HireConfirm: `!disabled && action !== "Sensitive action"`),
// so these 15 classifications are a regression contract: none of them may change.
const REGISTRY_PERMISSIONS: [string, PermissionRiskLevel][] = [
  ["broadcast:send:human_confirmation_required", "Write with confirmation"],
  ["business_decisions:human_confirmation_required", "Write with confirmation"],
  ["code:write:disabled", "Disabled"],
  ["community_data:read:with_consent", "Read-only"],
  ["contacts:read:disabled_by_default", "Disabled"],
  ["crm:write:disabled", "Disabled"],
  ["git_diff:read", "Read-only"],
  ["internal_docs:read:with_consent", "Read-only"],
  ["member_data:write:disabled", "Disabled"],
  ["merge_and_deploy:human_confirmation_required", "Write with confirmation"],
  ["outbound_messages:human_confirmation_required", "Write with confirmation"],
  ["prd_docs:read", "Read-only"],
  ["production:deploy:human_confirmation_required", "Write with confirmation"],
  ["public_web:read", "Read-only"],
  ["repo_files:read", "Read-only"],
];

describe("permissionLabel", () => {
  it("expands policy suffixes and underscores for the registry permissions", () => {
    expect(permissionLabel("code:write:disabled")).toBe(
      "code:write (disabled)"
    );
    expect(permissionLabel("contacts:read:disabled_by_default")).toBe(
      "contacts:read (disabled by default)"
    );
    expect(
      permissionLabel("merge_and_deploy:human_confirmation_required")
    ).toBe("merge and deploy (human confirmation required)");
    expect(
      permissionLabel("outbound_messages:human_confirmation_required")
    ).toBe("outbound messages (human confirmation required)");
    expect(permissionLabel("repo_files:read")).toBe("repo files:read");
  });

  it("expands `:disabled_by_default` before `:disabled` so the suffix is not split", () => {
    // The longest suffix must win; otherwise the label reads "(disabled) by default".
    expect(permissionLabel("member_data:read:disabled_by_default")).toBe(
      "member data:read (disabled by default)"
    );
    expect(
      permissionLabel("member_data:read:disabled_by_default")
    ).not.toContain("(disabled) by default");
  });

  it("expands every occurrence, not just the first", () => {
    expect(permissionLabel("code:write:disabled + crm:write:disabled")).toBe(
      "code:write (disabled) + crm:write (disabled)"
    );
    expect(
      permissionLabel(
        "a:human_confirmation_required b:human_confirmation_required"
      )
    ).toBe("a (human confirmation required) b (human confirmation required)");
  });

  it("passes unknown permissions through with only underscores swapped", () => {
    expect(permissionLabel("wire_transfer:execute")).toBe(
      "wire transfer:execute"
    );
    expect(permissionLabel("")).toBe("");
    expect(permissionLabel("plain")).toBe("plain");
  });

  it("mangles a suffix that is only a partial match (current behavior)", () => {
    // ":disabled" is replaced anywhere it appears, so a longer word is cut in half.
    expect(permissionLabel("audit:disabled_extension")).toBe(
      "audit (disabled) extension"
    );
    expect(permissionLabel("x:human_confirmation_required_later")).toBe(
      "x (human confirmation required) later"
    );
  });

  it("is case-sensitive even though the risk classifier is not", () => {
    // The badge says "Disabled" while the label still shows the raw uppercase token.
    expect(permissionLabel("CODE:WRITE:DISABLED")).toBe("CODE:WRITE:DISABLED");
    expect(getPermissionLevel("CODE:WRITE:DISABLED")).toBe("Disabled");
  });
});

describe("getPermissionLevel", () => {
  it("classifies every permission string shipped in the registry (regression contract)", () => {
    for (const [permission, level] of REGISTRY_PERMISSIONS) {
      expect(getPermissionLevel(permission), permission).toBe(level);
    }
  });

  it("lets a trailing disabled policy segment outrank every higher-risk keyword", () => {
    for (const permission of [
      "code:write:disabled",
      "billing:charge:disabled",
      "mailbox:send:disabled",
      "file:delete:disabled_by_default",
      "invoice:pay:disabled",
      "contacts:write:disabled",
      "付款:disabled",
      // Dot-style spellings of the same modifier behave identically.
      "crm.write.disabled",
      "contacts.read.disabled_by_default",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe("Disabled");
    }
  });

  it("never lets a mid-id `disabled` mention mask a live write or send", () => {
    // `disabled` only counts as the trailing policy segment. Both of these are
    // ACTIVE capabilities that previously rendered with the harmless badge.
    expect(getPermissionLevel("payments:reenable_disabled_cards:write")).toBe(
      "Sensitive action"
    );
    expect(getPermissionLevel("mailbox:send_when_alerts_disabled")).toBe(
      "Sensitive action"
    );
    // A word that merely contains "disabled" is not a policy modifier either.
    expect(getPermissionLevel("audit:disabled_extension")).not.toBe("Disabled");
  });

  it("flags sensitive actions regardless of letter case", () => {
    for (const permission of [
      "files:delete",
      "FILES:DELETE",
      "Repo:Delete",
      "billing:payment",
      "BILLING:PAYMENT",
      "billing:charge",
      "invoice:pay",
      "pay:vendor",
      "订单:付款",
      "wallet:支付",
      "mailbox:send",
      "MAILBOX:SEND",
      "team:email:send",
      "team:message:send",
      "contacts:write",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe(
        "Sensitive action"
      );
    }
  });

  it("ranks sensitive above confirmation, and confirmation above autonomous write", () => {
    expect(getPermissionLevel("payment:human_confirmation_required")).toBe(
      "Sensitive action"
    );
    expect(
      getPermissionLevel("contacts:write:human_confirmation_required")
    ).toBe("Sensitive action");
    expect(getPermissionLevel("code:write:human_confirmation_required")).toBe(
      "Write with confirmation"
    );
    expect(getPermissionLevel("docs:confirmation")).toBe(
      "Write with confirmation"
    );
    expect(getPermissionLevel("docs:write")).toBe("Autonomous write");
    // Generic send (no person-to-person channel) ranks below confirmation too,
    // which is what keeps broadcast:send:human_confirmation_required gated.
    expect(getPermissionLevel("broadcast:send")).toBe("Autonomous write");
    expect(
      getPermissionLevel("broadcast:send:human_confirmation_required")
    ).toBe("Write with confirmation");
  });

  it("detects writes across colon, dot, underscore, and space separators", () => {
    for (const permission of [
      "docs:write",
      "repo write",
      "write:everything",
      "crm.write",
      "files.write",
      "member_data.write",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe(
        "Autonomous write"
      );
    }
    // Embedded substrings are not writes — but they no longer sink to Read-only;
    // unmatched ids fail closed to the most restrictive level.
    for (const permission of [
      "writeaccess",
      "underwriting",
      "rewrite",
      "overwrite:all",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe(
        "Sensitive action"
      );
    }
  });

  it("classifies dot-style capability ids identically to their colon spellings", () => {
    // Both vocabularies ship in employees.generated.json (permissions[] uses colons,
    // tool_capabilities ids use dots), so the separator must not change the risk.
    const pairs: [string, string, PermissionRiskLevel][] = [
      ["crm.write", "crm:write", "Autonomous write"],
      ["files.write", "files:write", "Autonomous write"],
      ["member_data.write", "member_data:write", "Autonomous write"],
      ["contacts.write", "contacts:write", "Sensitive action"],
      ["email.send", "email:send", "Sensitive action"],
      ["message.send", "message:send", "Sensitive action"],
      ["broadcast.send", "broadcast:send", "Autonomous write"],
      ["production.deploy", "production:deploy", "Sensitive action"],
      ["shell.run", "shell:run", "Sensitive action"],
      ["files.read", "files:read", "Read-only"],
    ];
    for (const [dotted, colon, level] of pairs) {
      expect(getPermissionLevel(dotted), dotted).toBe(level);
      expect(getPermissionLevel(colon), colon).toBe(level);
    }
  });

  it("flags every mailbox send variant, not just the exact `mailbox:send` string", () => {
    for (const permission of [
      "mailbox:send",
      "mailbox:send:bulk",
      "mailbox:send_all",
      " mailbox:send",
      "mailbox:send ",
      "primary_mailbox:send",
      "mailbox.send",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe(
        "Sensitive action"
      );
    }
  });

  it("fails closed: unknown and empty permissions classify as Sensitive action", () => {
    // Deny by default: anything the classifier does not recognize gets the most
    // restrictive badge, so HireConfirm never enables it by default.
    for (const permission of [
      "",
      "   ",
      "wire_transfer:execute",
      "database:drop",
      "storage:purge",
      "user:impersonate",
      "keys:rotate",
      "sms:dispatch",
      "funds:transfer",
      "shell:exec",
      "crewclaw.run",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe(
        "Sensitive action"
      );
    }
  });

  it("classifies Read-only on an affirmative read marker, never as a fallback", () => {
    for (const permission of [
      "repo_files:read",
      "docs.read",
      "metrics_read",
      "read-only",
      "data:readonly",
      "delivery:read",
    ]) {
      expect(getPermissionLevel(permission), permission).toBe("Read-only");
    }
    // A read that also mentions a higher-risk keyword keeps the higher badge.
    expect(getPermissionLevel("audit_log:read:show_deleted")).toBe(
      "Sensitive action"
    );
    expect(getPermissionLevel("payments_dashboard:read")).toBe(
      "Sensitive action"
    );
    expect(getPermissionLevel("db:read:write")).toBe("Autonomous write");
  });
});
