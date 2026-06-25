import { describe, expect, it } from "vitest";
import { findExpert, getAvailableExperts, getExperts } from "./index";

describe("expert registry", () => {
  it("loads the four launch experts with two available profiles", () => {
    const experts = getExperts();

    expect(experts).toHaveLength(4);
    expect(getAvailableExperts().map((expert) => expert.name)).toEqual([
      "code-review-shrimp",
      "product-prd-crab",
    ]);
  });

  it("returns installation metadata for an available expert", () => {
    const expert = findExpert("code-review-shrimp");

    expect(expert?.status).toBe("available");
    expect(expert?.install_command).toContain("pnpm dlx @chaogeek/hermes hire code-review-shrimp");
    expect(expert?.local_install_command).toBe("pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw");
    expect(expert?.local_source).toBe("experts/code-review-shrimp");
  });
});
