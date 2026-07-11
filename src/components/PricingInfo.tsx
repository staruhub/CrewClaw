// Constants + pure helpers live in @/lib/pricing — this file only exports components so react
// fast refresh works (react-refresh/only-export-components).
import { CheckCircle2, Crown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatPricingLabel,
  pricingTone,
  type CheckoutPlanId,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function PricingBadge({ pricing }: { pricing: string }) {
  const tone = pricingTone(pricing);

  return (
    <Badge
      className={cn(
        "rounded-[8px] border",
        tone === "Free" &&
          "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
        tone === "Pro" &&
          "border-crew-copper/45 bg-crew-copper/10 text-crew-copper",
        tone === "Custom" && "border-sky-300/35 bg-sky-300/10 text-sky-100"
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
      {bullets.map(bullet => (
        <li className="flex gap-2" key={bullet}>
          <CheckCircle2 className="mt-1 size-4 shrink-0 text-crew-copper" />
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );
}
