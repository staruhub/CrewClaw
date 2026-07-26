import { describe, expect, it } from "vitest";
import { capabilityOnboardingRequirements } from "./capability-onboarding";
import type { EmployeeToolCapability } from "../data/employees";

const GENERIC_REVIEW =
  "Review the employee's capability authorization before onboarding.";

function capability(
  overrides: Partial<EmployeeToolCapability> = {}
): EmployeeToolCapability {
  return {
    capability: "workspace.file.read",
    necessity: "required",
    permission: "readonly",
    description: "Reads task-scoped workspace files.",
    scopes: [],
    approval: "never",
    purpose: null,
    limits: null,
    on_unavailable: "fail",
    capability_version: "1.0.0",
    invocation: "engine",
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

describe("capabilityOnboardingRequirements", () => {
  it("gives generic guidance when the employee declares no capabilities", () => {
    expect(capabilityOnboardingRequirements({ tool_capabilities: [] })).toEqual(
      [GENERIC_REVIEW]
    );
  });

  it("ignores capabilities switched off by necessity or permission", () => {
    // Both rows carry adapter/approval/limit traits, but neither is active,
    // so none of the trait-specific guidance may appear.
    const requirements = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          necessity: "disabled",
          permission: "requires_authorization",
          availability: "adapter_required",
          approval: "always",
          scopes: ["workspace:read"],
          limits: { max_calls_per_task: 3 },
        }),
        capability({
          necessity: "required",
          permission: "disabled",
          availability: "adapter_required",
          approval: "always",
          scopes: ["workspace:read"],
          limits: { timeout_ms: 1_000 },
        }),
      ],
    });

    expect(requirements).toEqual([GENERIC_REVIEW]);
  });

  it("counts only active capabilities in the review line, with singular copy for one", () => {
    expect(
      capabilityOnboardingRequirements({
        tool_capabilities: [capability()],
      })[0]
    ).toBe(
      "Review capability authorization for 1 declared tool capability before onboarding this employee."
    );

    expect(
      capabilityOnboardingRequirements({
        tool_capabilities: [
          capability(),
          capability({ capability: "web.search" }),
          capability({ capability: "off.switch", necessity: "disabled" }),
        ],
      })[0]
    ).toBe(
      "Review capability authorization for 2 declared tool capabilities before onboarding this employee."
    );
  });

  it("emits every trait line in a stable order for a fully-loaded capability", () => {
    const requirements = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          operation: "read",
          scopes: ["workspace:source:read"],
          availability: "adapter_required",
          permission: "requires_authorization",
          approval: "always",
          limits: { max_calls_per_task: 3, timeout_ms: 4_000 },
        }),
      ],
    });

    expect(requirements).toEqual([
      "Review capability authorization for 1 declared tool capability before onboarding this employee.",
      "Provide only the declared read scopes when 1 read capability needs task context.",
      "Configure and authorize the provider adapter required by 1 capability before assigning dependent tasks.",
      "Keep a human available for the 1 capability that can pause for authorization.",
      "1 capability has declared task limits; review them before assigning high-volume work.",
    ]);
  });

  it("requires both a read operation and declared scopes for the scope line", () => {
    const readWithoutScopes = capabilityOnboardingRequirements({
      tool_capabilities: [capability({ operation: "read", scopes: [] })],
    });
    const writeWithScopes = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({ operation: "write", scopes: ["workspace:write"] }),
      ],
    });
    const sendWithScopes = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({ operation: "send", scopes: ["mail:send"] }),
      ],
    });

    for (const requirements of [
      readWithoutScopes,
      writeWithScopes,
      sendWithScopes,
    ]) {
      expect(requirements.join(" ")).not.toContain("declared read scopes");
      expect(requirements).toHaveLength(1);
    }
  });

  it("counts each bucket independently across a mixed capability set", () => {
    const requirements = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          capability: "workspace.file.read",
          operation: "read",
          scopes: ["workspace:file:read"],
        }),
        capability({
          capability: "web.search",
          operation: "read",
          scopes: ["web:search"],
          availability: "adapter_required",
        }),
        capability({
          capability: "mail.send",
          operation: "send",
          scopes: ["mail:send"],
          permission: "requires_authorization",
        }),
      ],
    });

    expect(requirements).toEqual([
      "Review capability authorization for 3 declared tool capabilities before onboarding this employee.",
      "Provide only the declared read scopes when 2 read capabilities need task context.",
      "Configure and authorize the provider adapter required by 1 capability before assigning dependent tasks.",
      "Keep a human available for the 1 capability that can pause for authorization.",
    ]);
  });

  it("treats authorization permission and always-approval as one approval bucket", () => {
    const byPermission = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({ permission: "requires_authorization", approval: "never" }),
      ],
    });
    const byApproval = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({ permission: "write", approval: "always" }),
      ],
    });
    const byBoth = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          permission: "requires_authorization",
          approval: "always",
        }),
      ],
    });

    for (const requirements of [byPermission, byApproval, byBoth]) {
      expect(requirements).toContain(
        "Keep a human available for the 1 capability that can pause for authorization."
      );
    }

    // when_needed / null approval on a non-authorization permission stays silent.
    for (const approval of ["never", "when_needed", null] as const) {
      const quiet = capabilityOnboardingRequirements({
        tool_capabilities: [capability({ permission: "write", approval })],
      });
      expect(quiet.join(" "), String(approval)).not.toContain(
        "human available"
      );
    }
  });

  it("flags a capability bounded by either a call cap or a timeout", () => {
    for (const limits of [
      { max_calls_per_task: 1 },
      { timeout_ms: 500 },
      { max_calls_per_task: 2, timeout_ms: 500 },
    ]) {
      const requirements = capabilityOnboardingRequirements({
        tool_capabilities: [capability({ limits })],
      });
      expect(requirements, JSON.stringify(limits)).toContain(
        "1 capability has declared task limits; review them before assigning high-volume work."
      );
    }
  });

  it("flags a zero-valued limit, the most restrictive cap there is", () => {
    const zeroed: EmployeeToolCapability["limits"][] = [
      { max_calls_per_task: 0 },
      { timeout_ms: 0 },
      { max_calls_per_task: 0, timeout_ms: 0 },
      { max_calls_per_task: 0, timeout_ms: 4_000 },
    ];

    for (const limits of zeroed) {
      const requirements = capabilityOnboardingRequirements({
        tool_capabilities: [capability({ limits })],
      });
      expect(requirements, JSON.stringify(limits)).toContain(
        "1 capability has declared task limits; review them before assigning high-volume work."
      );
    }
  });

  it("stays silent when no limit is declared at all", () => {
    const undeclared: EmployeeToolCapability["limits"][] = [null, {}];

    for (const limits of undeclared) {
      const requirements = capabilityOnboardingRequirements({
        tool_capabilities: [capability({ limits })],
      });
      expect(requirements.join(" "), JSON.stringify(limits)).not.toContain(
        "declared task limits"
      );
    }
  });

  it("agrees the verb with the count in the limits line", () => {
    const one = capabilityOnboardingRequirements({
      tool_capabilities: [capability({ limits: { max_calls_per_task: 1 } })],
    });
    const many = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          capability: "workspace.file.read",
          limits: { max_calls_per_task: 1 },
        }),
        capability({ capability: "web.search", limits: { timeout_ms: 0 } }),
        capability({
          capability: "mail.send",
          limits: { max_calls_per_task: 0 },
        }),
      ],
    });

    expect(one).toContain(
      "1 capability has declared task limits; review them before assigning high-volume work."
    );
    expect(many).toContain(
      "3 capabilities have declared task limits; review them before assigning high-volume work."
    );
  });

  it("agrees the verb with the count in the read-scope line", () => {
    const one = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({ operation: "read", scopes: ["workspace:file:read"] }),
      ],
    });
    const many = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          capability: "workspace.file.read",
          operation: "read",
          scopes: ["workspace:file:read"],
        }),
        capability({
          capability: "web.search",
          operation: "read",
          scopes: ["web:search"],
        }),
      ],
    });

    expect(one).toContain(
      "Provide only the declared read scopes when 1 read capability needs task context."
    );
    expect(many).toContain(
      "Provide only the declared read scopes when 2 read capabilities need task context."
    );
  });

  it("derives guidance from metadata alone, so capability ids never change the copy", () => {
    const base = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          capability: "brand.new.capability",
          operation: "read",
          scopes: ["a:b"],
          availability: "adapter_required",
        }),
      ],
    });
    const renamed = capabilityOnboardingRequirements({
      tool_capabilities: [
        capability({
          capability: "some.other.id",
          description: "A different description.",
          purpose: "A different purpose.",
          runtime_tool: "Bash",
          risk_tier: "P0",
          operation: "read",
          scopes: ["a:b"],
          availability: "adapter_required",
        }),
      ],
    });

    expect(base).toEqual(renamed);
    expect(base).toHaveLength(3);
  });

  it("returns a fresh array each call so callers cannot corrupt shared guidance", () => {
    const employee = { tool_capabilities: [capability()] };
    const first = capabilityOnboardingRequirements(employee);
    first.push("mutated");

    expect(capabilityOnboardingRequirements(employee)).toHaveLength(1);
  });
});
