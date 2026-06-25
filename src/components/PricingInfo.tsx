import { CheckCircle2, Crown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

export function PricingBadge({ pricing }: { pricing: string }) {
  const tone = pricingTone(pricing);

  return (
    <Badge
      className={cn(
        "rounded-[8px] border",
        tone === "Free" && "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
        tone === "Pro" && "border-crew-copper/45 bg-crew-copper/10 text-crew-copper",
        tone === "Custom" && "border-sky-300/35 bg-sky-300/10 text-sky-100",
      )}
      variant="outline"
    >
      {formatPricingLabel(pricing)}
    </Badge>
  );
}

export function PricingPlanIcon({ plan }: { plan: CheckoutPlanId }) {
  return plan === "pro" ? (
    <Crown className="size-5 text-crew-copper" />
  ) : (
    <Sparkles className="size-5 text-emerald-200" />
  );
}

export function PricingBulletList({ bullets }: { bullets: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-crew-body">
      {bullets.map((bullet) => (
        <li className="flex gap-2" key={bullet}>
          <CheckCircle2 className="mt-1 size-4 shrink-0 text-crew-copper" />
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );
}
