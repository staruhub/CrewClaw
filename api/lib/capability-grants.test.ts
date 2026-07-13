import { describe, expect, it } from "vitest";
import { getEmployee } from "@/data/employees";
import {
  capabilityGrantTokensForHire,
  validateCapabilityGrantTokens,
} from "@/lib/capability-grants";

const macao = getEmployee("macao-networking-agent");

if (!macao)
  throw new Error("Macao fixture is required for capability grant tests");

describe("website capability grants", () => {
  it("writes only formal capability tokens for a selected hire", () => {
    const tokens = capabilityGrantTokensForHire(macao.tool_capabilities, [
      "contacts.read",
    ]);

    expect(tokens).toContain("capability:web.search");
    expect(tokens).toContain("capability:contacts.read");
    expect(tokens).not.toContain("capability:crm.write");
    expect(tokens.every(token => token.startsWith("capability:"))).toBe(true);
  });

  it("fails closed for legacy, unknown, or disabled capability tokens", () => {
    const validRequiredTokens = capabilityGrantTokensForHire(
      macao.tool_capabilities,
      []
    );
    const validation = validateCapabilityGrantTokens(macao.tool_capabilities, [
      ...validRequiredTokens,
      "public_web:read",
      "capability:not.real",
      "capability:crm.write",
    ]);

    expect(validation.missingRequiredCapabilities).toEqual([]);
    expect(validation.capabilityTokens).not.toContain("public_web:read");
    expect(validation.invalidCapabilityTokens).toEqual([
      "public_web:read",
      "capability:not.real",
      "capability:crm.write",
    ]);
  });
});
