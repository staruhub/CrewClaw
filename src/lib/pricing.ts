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
    description: "Hire this AI employee into your local demo crew with no payment.",
    bullets: ["No real payment", "Local team record", "Manual permission review"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    cadence: "mock monthly seat",
    description: "Preview a paid seat flow before the employee joins your crew.",
    bullets: ["Mock checkout only", "No card is charged", "Same local onboarding"],
  },
];

export function formatPricingLabel(pricing: string) {
  return pricing
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

export function pricingTone(pricing: string) {
  const normalized = pricing.toLowerCase();

  if (normalized.includes("custom")) return "Custom";
  if (normalized.includes("pro") || normalized.includes("subscription")) return "Pro";
  return "Free";
}
