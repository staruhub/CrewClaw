import { describe, expect, it } from "vitest";
import { CHECKOUT_PLANS, formatPricingLabel, pricingTone } from "./pricing";

describe("formatPricingLabel", () => {
  it("title-cases each token and normalises hyphen, underscore and space separators", () => {
    expect(formatPricingLabel("free")).toBe("Free");
    expect(formatPricingLabel("pro-subscription")).toBe("Pro Subscription");
    expect(formatPricingLabel("usage_based")).toBe("Usage Based");
    expect(formatPricingLabel("mock monthly seat")).toBe("Mock Monthly Seat");
  });

  it("collapses separator runs and drops leading or trailing separators", () => {
    expect(formatPricingLabel("pro__seat")).toBe("Pro Seat");
    expect(formatPricingLabel("pro - seat")).toBe("Pro Seat");
    expect(formatPricingLabel("-free-")).toBe("Free");
    expect(formatPricingLabel("   free   ")).toBe("Free");
    expect(formatPricingLabel("a\tb\nc")).toBe("A B C");
  });

  it("returns an empty label for empty or separator-only input", () => {
    expect(formatPricingLabel("")).toBe("");
    expect(formatPricingLabel("   ")).toBe("");
    expect(formatPricingLabel("___")).toBe("");
    expect(formatPricingLabel("- _ -")).toBe("");
  });

  it("only uppercases the first character and leaves the rest of a token untouched", () => {
    // Not a full title-case: an all-caps or intercapped token keeps its original tail.
    expect(formatPricingLabel("FREE")).toBe("FREE");
    expect(formatPricingLabel("iOS pro")).toBe("IOS Pro");
    expect(formatPricingLabel("payAsYouGo")).toBe("PayAsYouGo");
  });

  it("passes through tokens that have no uppercase form", () => {
    expect(formatPricingLabel("$19/mo")).toBe("$19/mo");
    expect(formatPricingLabel("2 seats")).toBe("2 Seats");
    expect(formatPricingLabel("免费")).toBe("免费");
  });

  it("is idempotent for an already formatted label", () => {
    const once = formatPricingLabel("pro-subscription");

    expect(formatPricingLabel(once)).toBe(once);
  });
});

describe("pricingTone", () => {
  it("classifies the plain pricing vocabulary", () => {
    expect(pricingTone("free")).toBe("Free");
    expect(pricingTone("pro")).toBe("Pro");
    expect(pricingTone("subscription")).toBe("Pro");
    expect(pricingTone("custom")).toBe("Custom");
  });

  it("is case insensitive", () => {
    for (const variant of ["PRO", "Pro", "pRo"]) {
      expect(pricingTone(variant), variant).toBe("Pro");
    }
    for (const variant of ["CUSTOM", "Custom Quote", "Enterprise custom"]) {
      expect(pricingTone(variant), variant).toBe("Custom");
    }
    expect(pricingTone("SUBSCRIPTION")).toBe("Pro");
  });

  it("lets Custom win when several keywords are present", () => {
    expect(pricingTone("custom pro subscription")).toBe("Custom");
    expect(pricingTone("pro custom")).toBe("Custom");
  });

  it("falls back to Free for empty or unrecognised pricing", () => {
    expect(pricingTone("")).toBe("Free");
    expect(pricingTone("   ")).toBe("Free");
    expect(pricingTone("$0")).toBe("Free");
    expect(pricingTone("usage based")).toBe("Free");
    expect(pricingTone("trial")).toBe("Free");
  });

  it("matches whole words, so a word merely containing a keyword stays Free", () => {
    // Regression: `includes` had no word boundary, so anything containing "pro" or
    // "custom" was upgraded away from Free — a free plan badged as a paid tier.
    expect(pricingTone("free promo")).toBe("Free");
    expect(pricingTone("approved usage")).toBe("Free");
    expect(pricingTone("product-led free tier")).toBe("Free");
    expect(pricingTone("customer supported free")).toBe("Free");
    expect(pricingTone("promotional")).toBe("Free");
    expect(pricingTone("reproduction")).toBe("Free");
    expect(pricingTone("customary")).toBe("Free");
    expect(pricingTone("subscriptions")).toBe("Free");
  });

  it("classifies the pricing strings the registry actually publishes", () => {
    // Every employee in src/data/employees.generated.json and registry/experts.json
    // ships pricing "free-preview"; "preview" must not be read as "pro".
    expect(pricingTone("free-preview")).toBe("Free");
    expect(formatPricingLabel("free-preview")).toBe("Free Preview");
  });

  it("still finds a keyword next to any separator or punctuation", () => {
    for (const paid of [
      "pro-seat",
      "pro_seat",
      "pro seat",
      "seat (pro)",
      "pro/seat",
      "team, subscription",
    ]) {
      expect(pricingTone(paid), paid).toBe("Pro");
    }

    for (const custom of ["custom-quote", "custom_quote", "quote: custom"]) {
      expect(pricingTone(custom), custom).toBe("Custom");
    }
  });
});

describe("CHECKOUT_PLANS", () => {
  it("offers exactly the free and pro demo plans, in that order, with unique ids", () => {
    const ids = CHECKOUT_PLANS.map(plan => plan.id);

    expect(ids).toEqual(["free", "pro"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every plan the copy the checkout UI renders", () => {
    for (const plan of CHECKOUT_PLANS) {
      expect(plan.name.trim().length, plan.id).toBeGreaterThan(0);
      expect(plan.cadence.trim().length, plan.id).toBeGreaterThan(0);
      expect(plan.description.trim().length, plan.id).toBeGreaterThan(0);
      expect(plan.bullets.length, plan.id).toBeGreaterThan(0);
      expect(
        plan.bullets.every(bullet => bullet.trim().length > 0),
        plan.id
      ).toBe(true);
    }
  });

  it("prices plans as whole dollars with free at zero and pro above it", () => {
    const priced = CHECKOUT_PLANS.map(plan => ({
      id: plan.id,
      dollars: Number(plan.price.replace(/^\$/, "")),
    }));

    for (const plan of CHECKOUT_PLANS) {
      expect(plan.price, plan.id).toMatch(/^\$\d+$/);
    }
    expect(priced.find(plan => plan.id === "free")?.dollars).toBe(0);
    expect(priced.find(plan => plan.id === "pro")?.dollars).toBeGreaterThan(0);
  });

  it("keeps plan ids in step with the label and tone helpers", () => {
    for (const plan of CHECKOUT_PLANS) {
      expect(formatPricingLabel(plan.id), plan.id).toBe(plan.name);
    }
    expect(pricingTone("free")).toBe(CHECKOUT_PLANS[0].name);
    expect(pricingTone("pro")).toBe(CHECKOUT_PLANS[1].name);
  });
});
