import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { Check } from "lucide-react";

interface PricingProps {
  onGetStarted: (plan?: string) => void;
  onContact: () => void;
}

const plans = [
  {
    name: "Free",
    price: "$0",
    desc: "For MVP preview users",
    accent: "#8B8175",
    features: [
      "Two validated employee packages",
      "Local Hermes install",
      "Static registry",
      "Validator included",
    ],
    cta: "Get Started",
    featured: false,
  },
  {
    name: "Pro",
    price: "Preview",
    desc: "For repeat workflows",
    accent: "#C87941",
    features: [
      "More expert profiles",
      "Profile update flow",
      "Usage feedback loop",
      "Priority tuning",
    ],
    cta: "Coming Soon",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    desc: "For private expert crews",
    accent: "#9A8B7A",
    features: [
      "Private registry",
      "Permission review",
      "Internal certification",
      "Dedicated tuning",
    ],
    cta: "Contact Us",
    featured: false,
  },
];

export function Pricing({ onGetStarted, onContact }: PricingProps) {
  return (
    <section id="pricing" className="section-shell bg-crew-bg-dark">
      <div className="site-container">
        <SectionHeader
          label="PRICING"
          title="Free Preview. Paid Later."
          centered
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-16">
          {plans.map((plan, i) => (
            <ScrollReveal key={plan.name} delay={i * 0.15}>
              <div
                className={`relative flex h-full flex-col overflow-hidden rounded-[8px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.026),rgba(255,255,255,0.012))] transition-colors duration-300 ${
                  plan.featured
                    ? "border-crew-copper/20"
                    : "border-white/8 hover:border-white/12"
                }`}
              >
                {plan.featured && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(200,121,65,0.18),transparent_72%)]" />
                )}

                <div className="p-7 md:p-8 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-6">
                    <div>
                      <h3 className="font-mono text-lg font-semibold text-crew-heading">
                        {plan.name}
                      </h3>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/40">
                        {plan.desc}
                      </p>
                    </div>
                    {plan.featured && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-crew-copper/80">
                        Recommended
                      </span>
                    )}
                  </div>

                  <div className="mt-7">
                    <span className="font-sans text-[40px] font-light text-crew-heading">
                      {plan.price}
                    </span>
                  </div>

                  <ul className="mt-7 space-y-3 flex-1">
                    {plan.features.map(f => (
                      <li
                        key={f}
                        className="flex items-start gap-3 border-b border-white/6 pb-3 last:border-b-0 last:pb-0"
                      >
                        <Check
                          size={14}
                          className="mt-0.5 shrink-0"
                          style={{
                            color: plan.featured ? "#C87941" : plan.accent,
                          }}
                        />
                        <span className="text-sm text-crew-body">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6">
                    <button
                      onClick={
                        plan.featured
                          ? () => onGetStarted("pro")
                          : plan.name === "Enterprise"
                            ? onContact
                            : () => onGetStarted(plan.name.toLowerCase())
                      }
                      className={`w-full rounded-sm border px-4 py-3 font-mono text-sm font-semibold transition-colors ${
                        plan.featured
                          ? "border-crew-copper/30 bg-crew-copper/10 text-crew-heading hover:bg-crew-copper/16"
                          : "border-white/10 bg-transparent text-crew-body hover:border-crew-copper/30 hover:text-crew-heading"
                      }`}
                    >
                      {plan.cta}
                    </button>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
