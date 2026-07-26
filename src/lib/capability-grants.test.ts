import { describe, expect, it } from "vitest";
import {
  employees,
  getEmployee,
  isToolCapabilityEnabledByDefault,
  type EmployeeToolCapability,
} from "../data/employees";
import {
  CAPABILITY_GRANT_PREFIX,
  capabilityGrantTokensForHire,
  validateCapabilityGrantTokens,
} from "./capability-grants";

type CapabilityOverrides = Partial<EmployeeToolCapability> &
  Pick<EmployeeToolCapability, "capability" | "necessity" | "permission">;

/** A full, type-checked capability declaration; only the fields under test vary. */
function capability(overrides: CapabilityOverrides): EmployeeToolCapability {
  return {
    description: "",
    scopes: [],
    approval: null,
    purpose: null,
    limits: null,
    on_unavailable: null,
    capability_version: "1.0.0",
    invocation: "model",
    operation: "read",
    risk_tier: "P3",
    runtime_tool: null,
    provider_bindings: [],
    side_effects: [],
    supports_preview: false,
    idempotent: true,
    timeout_ms: 30_000,
    error_codes: [],
    availability: "runtime_implementation",
    ...overrides,
  };
}

const READ = capability({
  capability: "files.read",
  necessity: "required",
  permission: "readonly",
});
const SEARCH = capability({
  capability: "web.search",
  necessity: "conditional",
  permission: "readonly",
});
const CONTACTS = capability({
  capability: "contacts.read",
  necessity: "non_default",
  permission: "requires_authorization",
});
const CRM = capability({
  capability: "crm.write",
  necessity: "disabled",
  permission: "disabled",
});

describe("capabilityGrantTokensForHire", () => {
  it("grants required capabilities plus exactly the optional ones selected", () => {
    expect(
      capabilityGrantTokensForHire([READ, SEARCH, CONTACTS], ["contacts.read"])
    ).toEqual(["capability:files.read", "capability:contacts.read"]);

    // Required is granted with an empty selection; optional ones stay off.
    expect(capabilityGrantTokensForHire([READ, SEARCH, CONTACTS], [])).toEqual([
      "capability:files.read",
    ]);

    expect(
      capabilityGrantTokensForHire(
        [READ, SEARCH, CONTACTS],
        ["web.search", "contacts.read"]
      )
    ).toEqual([
      "capability:files.read",
      "capability:web.search",
      "capability:contacts.read",
    ]);
  });

  it("never grants a capability whose necessity is disabled, even if selected", () => {
    expect(capabilityGrantTokensForHire([CRM], ["crm.write"])).toEqual([]);
    expect(capabilityGrantTokensForHire([READ, CRM], ["crm.write"])).toEqual([
      "capability:files.read",
    ]);
  });

  it("refuses to mint a grant that its own validator would reject", () => {
    // Minting and validation share one grantability predicate, so a
    // declaration with permission "disabled" is refused on both sides.
    const shell = capability({
      capability: "shell.run",
      necessity: "conditional",
      permission: "disabled",
    });

    expect(capabilityGrantTokensForHire([shell], ["shell.run"])).toEqual([]);
    expect(capabilityGrantTokensForHire([READ, shell], ["shell.run"])).toEqual([
      "capability:files.read",
    ]);

    const validation = validateCapabilityGrantTokens(
      [shell],
      ["capability:shell.run"]
    );
    expect(validation.capabilityTokens).toEqual([]);
    expect(validation.invalidCapabilityTokens).toEqual([
      "capability:shell.run",
    ]);
  });

  it("refuses to mint a token for a malformed declared capability id", () => {
    const malformed = capability({
      capability: "",
      necessity: "required",
      permission: "readonly",
    });

    expect(capabilityGrantTokensForHire([malformed], [""])).toEqual([]);
    expect(capabilityGrantTokensForHire([malformed, READ], [])).toEqual([
      "capability:files.read",
    ]);
  });

  it("agrees with the validator end to end: minted tokens always validate", () => {
    const contract = [
      READ,
      SEARCH,
      CONTACTS,
      CRM,
      capability({
        capability: "shell.run",
        necessity: "conditional",
        permission: "disabled",
      }),
      capability({
        capability: "",
        necessity: "required",
        permission: "readonly",
      }),
    ];
    const everyDeclaredId = contract.map(({ capability: id }) => id);

    const tokens = capabilityGrantTokensForHire(contract, everyDeclaredId);
    expect(tokens).toEqual([
      "capability:files.read",
      "capability:web.search",
      "capability:contacts.read",
    ]);

    const validation = validateCapabilityGrantTokens(contract, tokens);
    expect(validation.capabilityTokens).toEqual(tokens);
    expect(validation.invalidCapabilityTokens).toEqual([]);
    // The malformed required declaration surfaces instead of reading clean.
    expect(validation.missingRequiredCapabilities).toEqual(["capability:"]);
  });

  it("ignores selections the employee never declared", () => {
    // A caller cannot mint a grant by naming a capability that is not in the contract.
    expect(
      capabilityGrantTokensForHire(
        [READ, SEARCH],
        ["crm.write", "shell.run", "capability:web.search", "*", ""]
      )
    ).toEqual(["capability:files.read"]);
    expect(capabilityGrantTokensForHire([], ["files.read"])).toEqual([]);
    expect(capabilityGrantTokensForHire([], [])).toEqual([]);
  });

  it("matches selections exactly: case, whitespace, and prefix all count", () => {
    for (const selection of [
      "WEB.SEARCH",
      "Web.Search",
      "web.search ",
      " web.search",
      "web_search",
      "web.searc",
      "web.search.extra",
    ]) {
      expect(
        capabilityGrantTokensForHire([SEARCH], [selection]),
        selection
      ).toEqual([]);
    }
    expect(capabilityGrantTokensForHire([SEARCH], ["web.search"])).toEqual([
      "capability:web.search",
    ]);
  });

  it("emits declaration order and keeps duplicate declarations visible", () => {
    const tokens = capabilityGrantTokensForHire(
      [CONTACTS, READ, SEARCH, READ],
      ["web.search", "contacts.read"]
    );

    // Order follows the contract, not the caller's selection order.
    expect(tokens).toEqual([
      "capability:contacts.read",
      "capability:files.read",
      "capability:web.search",
      "capability:files.read",
    ]);
    expect(
      tokens.every(token => token.startsWith(CAPABILITY_GRANT_PREFIX))
    ).toBe(true);
    expect(CAPABILITY_GRANT_PREFIX).toBe("capability:");
  });
});

describe("validateCapabilityGrantTokens", () => {
  it("accepts declared, enabled capabilities and rejects legacy scopes", () => {
    const validation = validateCapabilityGrantTokens(
      [READ, SEARCH, CONTACTS, CRM],
      [
        "capability:files.read",
        "capability:web.search",
        "public_web:read",
        "contacts:read:disabled_by_default",
        "capability:not.real",
        "capability:crm.write",
      ]
    );

    expect(validation.capabilityTokens).toEqual([
      "capability:files.read",
      "capability:web.search",
    ]);
    expect(validation.invalidCapabilityTokens).toEqual([
      "public_web:read",
      "contacts:read:disabled_by_default",
      "capability:not.real",
      "capability:crm.write",
    ]);
    expect(validation.missingRequiredCapabilities).toEqual([]);
  });

  it("rejects a capability disabled by either necessity or permission", () => {
    const byNecessity = capability({
      capability: "a.tool",
      necessity: "disabled",
      permission: "write",
    });
    const byPermission = capability({
      capability: "b.tool",
      necessity: "conditional",
      permission: "disabled",
    });

    const validation = validateCapabilityGrantTokens(
      [byNecessity, byPermission],
      ["capability:a.tool", "capability:b.tool"]
    );

    expect(validation.capabilityTokens).toEqual([]);
    expect(validation.invalidCapabilityTokens).toEqual([
      "capability:a.tool",
      "capability:b.tool",
    ]);
  });

  it("reports required capabilities that were not requested", () => {
    const other = capability({
      capability: "artifact.report",
      necessity: "required",
      permission: "write",
    });

    const validation = validateCapabilityGrantTokens(
      [READ, other, SEARCH],
      ["capability:web.search"]
    );

    expect(validation.missingRequiredCapabilities).toEqual([
      "capability:files.read",
      "capability:artifact.report",
    ]);
    expect(validation.capabilityTokens).toEqual(["capability:web.search"]);
    expect(validation.invalidCapabilityTokens).toEqual([]);
  });

  it("surfaces a required-but-policy-disabled capability as unsatisfiable", () => {
    // necessity "required" with permission "disabled" can never be satisfied.
    // The refused token stays invalid AND the requirement stays missing, so a
    // caller that checks only `missingRequiredCapabilities` cannot mistake
    // the refusal for success.
    const contradiction = capability({
      capability: "production.deploy",
      necessity: "required",
      permission: "disabled",
    });

    expect(capabilityGrantTokensForHire([contradiction], [])).toEqual([]);

    const requested = validateCapabilityGrantTokens(
      [contradiction],
      ["capability:production.deploy"]
    );
    expect(requested.capabilityTokens).toEqual([]);
    expect(requested.invalidCapabilityTokens).toEqual([
      "capability:production.deploy",
    ]);
    expect(requested.missingRequiredCapabilities).toEqual([
      "capability:production.deploy",
    ]);

    const omitted = validateCapabilityGrantTokens([contradiction], []);
    expect(omitted.capabilityTokens).toEqual([]);
    expect(omitted.invalidCapabilityTokens).toEqual([]);
    expect(omitted.missingRequiredCapabilities).toEqual([
      "capability:production.deploy",
    ]);
  });

  it("rejects near-miss tokens instead of coercing them", () => {
    const nearMisses = [
      "",
      "web.search",
      "capability",
      "Capability:web.search",
      "capability:Web.Search",
      "capability:web.search ",
      " capability:web.search",
      "capability:capability:web.search",
      "capability:web.search.extra",
      "capability:web",
      "capability:*",
    ];

    const validation = validateCapabilityGrantTokens([SEARCH], nearMisses);

    expect(validation.capabilityTokens).toEqual([]);
    expect(validation.invalidCapabilityTokens).toEqual(nearMisses);
  });

  it("deduplicates repeated grants and ignores the caller's ordering", () => {
    const validation = validateCapabilityGrantTokens(
      [READ, SEARCH],
      [
        "capability:web.search",
        "capability:files.read",
        "capability:web.search",
        "capability:not.real",
        "capability:not.real",
      ]
    );

    expect(validation.capabilityTokens).toEqual([
      "capability:files.read",
      "capability:web.search",
    ]);
    expect(validation.invalidCapabilityTokens).toEqual(["capability:not.real"]);
  });

  it("returns empty results for empty declarations and empty grants", () => {
    expect(validateCapabilityGrantTokens([], [])).toEqual({
      capabilityTokens: [],
      invalidCapabilityTokens: [],
      missingRequiredCapabilities: [],
    });

    // No declarations means no grant can be honoured.
    expect(
      validateCapabilityGrantTokens([], ["capability:files.read"])
    ).toEqual({
      capabilityTokens: [],
      invalidCapabilityTokens: ["capability:files.read"],
      missingRequiredCapabilities: [],
    });

    expect(validateCapabilityGrantTokens([SEARCH, CONTACTS], [])).toEqual({
      capabilityTokens: [],
      invalidCapabilityTokens: [],
      missingRequiredCapabilities: [],
    });
  });

  it("rejects the bare prefix even when a contract declares an empty id", () => {
    // Declared capability ids are validated: an empty id can never turn the
    // bare prefix "capability:" into an accepted grant, and the malformed
    // required declaration is reported missing because it can never be
    // satisfied.
    const malformed = capability({
      capability: "",
      necessity: "required",
      permission: "readonly",
    });

    const validation = validateCapabilityGrantTokens(
      [malformed],
      [CAPABILITY_GRANT_PREFIX]
    );

    expect(validation.capabilityTokens).toEqual([]);
    expect(validation.invalidCapabilityTokens).toEqual(["capability:"]);
    expect(validation.missingRequiredCapabilities).toEqual(["capability:"]);
  });

  it("rejects declared ids containing whitespace or the token separator", () => {
    const padded = capability({
      capability: "web.search ",
      necessity: "conditional",
      permission: "readonly",
    });
    const nested = capability({
      capability: "capability:web.search",
      necessity: "conditional",
      permission: "readonly",
    });

    expect(
      capabilityGrantTokensForHire(
        [padded, nested],
        ["web.search ", "capability:web.search"]
      )
    ).toEqual([]);

    const validation = validateCapabilityGrantTokens(
      [padded, nested],
      ["capability:web.search ", "capability:capability:web.search"]
    );
    expect(validation.capabilityTokens).toEqual([]);
    expect(validation.invalidCapabilityTokens).toEqual([
      "capability:web.search ",
      "capability:capability:web.search",
    ]);
  });
});

describe("shipped employee contracts (regression)", () => {
  it("keeps ai-adoption-whale's default hire grant set exactly as shipped", () => {
    const whale = getEmployee("ai-adoption-whale");
    if (!whale) throw new Error("ai-adoption-whale fixture is required");

    const defaultSelection = whale.tool_capabilities
      .filter(isToolCapabilityEnabledByDefault)
      .map(declaration => declaration.capability);
    const tokens = capabilityGrantTokensForHire(
      whale.tool_capabilities,
      defaultSelection
    );

    // The live hire e2e pins exactly this grant set; it must never change.
    expect([...tokens].sort()).toEqual([
      "capability:artifact.report",
      "capability:browser.render",
      "capability:evidence.create",
      "capability:source.verify",
      "capability:web.fetch_extract",
      "capability:web.search",
    ]);

    const validation = validateCapabilityGrantTokens(
      whale.tool_capabilities,
      tokens
    );
    expect(validation.capabilityTokens).toEqual(tokens);
    expect(validation.invalidCapabilityTokens).toEqual([]);
    expect(validation.missingRequiredCapabilities).toEqual([]);
  });

  it("changes no shipped employee's grant set under the unified rule", () => {
    for (const employee of employees) {
      // The unified rule only withholds grants whose permission is "disabled"
      // or whose id is malformed. Shipped contracts declare permission
      // "disabled" solely alongside necessity "disabled" (already never
      // granted), so minting must stay exactly the necessity-derived set.
      const necessityOnly = employee.tool_capabilities
        .filter(declaration => declaration.necessity !== "disabled")
        .map(
          declaration => `${CAPABILITY_GRANT_PREFIX}${declaration.capability}`
        );
      const everyDeclaredId = employee.tool_capabilities.map(
        declaration => declaration.capability
      );
      const tokens = capabilityGrantTokensForHire(
        employee.tool_capabilities,
        everyDeclaredId
      );
      expect(tokens, employee.employee_id).toEqual(necessityOnly);

      const validation = validateCapabilityGrantTokens(
        employee.tool_capabilities,
        tokens
      );
      expect(validation.capabilityTokens, employee.employee_id).toEqual(tokens);
      expect(validation.invalidCapabilityTokens, employee.employee_id).toEqual(
        []
      );
      expect(
        validation.missingRequiredCapabilities,
        employee.employee_id
      ).toEqual([]);
    }
  });
});
