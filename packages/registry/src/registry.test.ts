import { describe, expect, it } from "vitest";
import { parseYaml } from "../../validator/src/index";
import { findExpert, getAvailableExperts, getExperts } from "./index";

describe("expert registry", () => {
  it("loads the seven registry experts with five available profiles", () => {
    const experts = getExperts();

    expect(experts).toHaveLength(7);
    expect(getAvailableExperts().map((expert) => expert.name)).toEqual([
      "code-review-shrimp",
      "product-prd-crab",
      "ai-adoption-whale",
      "zeneth",
      "macao-networking-agent",
    ]);
  });

  it("returns installation metadata for an available expert", () => {
    const expert = findExpert("code-review-shrimp");

    expect(expert?.status).toBe("available");
    expect(expert?.install_command).toContain("pnpm dlx @chaogeek/hermes hire code-review-shrimp");
    expect(expert?.local_install_command).toBe("pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw");
    expect(expert?.local_source).toBe("experts/code-review-shrimp");
  });

  it("parses inline object array items as objects", () => {
    const parsed = parseYaml(
      [
        "runtime:",
        "  permissions:",
        "    - scope: public_web",
        "      action: read",
        "      level: allow",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      runtime: {
        permissions: [{ scope: "public_web", action: "read", level: "allow" }],
      },
    });
  });
});
