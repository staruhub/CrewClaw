// Pricing constants + pure helpers, split out of components/PricingInfo.tsx so that file only
// exports components (react-refresh/only-export-components — mixed exports break HMR fast refresh).

export type CheckoutPlanId = "free" | "pro";

export type CheckoutPlan = {
  id: CheckoutPlanId;
  name: string;
  price: string;
  cadence: string;
  description: string;
  bullets: string[];
};

export const CHECKOUT_PLANS: CheckoutPlan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "demo onboarding",
    description:
      "Hire this AI employee into your local demo crew with no payment.",
    bullets: [
      "No real payment",
      "Local team record",
      "Manual permission review",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    cadence: "mock monthly seat",
    description:
      "Preview a paid seat flow before the employee joins your crew.",
    bullets: [
      "Mock checkout only",
      "No card is charged",
      "Same local onboarding",
    ],
  },
];

export function formatPricingLabel(pricing: string) {
  return pricing
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Whole words only. A bare `includes("pro")` also fired on "promo", "product"
 * and "approved" (and `includes("custom")` on "customer"), so a free plan could
 * be badged as a paid tier. Splitting on runs of non-alphanumerics covers every
 * separator these strings use (`-`, `_`, space, `/`, punctuation) and is more
 * permissive than \b, which treats `_` as a word character and would miss
 * "pro_seat".
 */
function pricingTokens(pricing: string) {
  return new Set(
    pricing
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

export function pricingTone(pricing: string) {
  const tokens = pricingTokens(pricing);

  if (tokens.has("custom")) return "Custom";
  if (tokens.has("pro") || tokens.has("subscription")) return "Pro";
  return "Free";
}
