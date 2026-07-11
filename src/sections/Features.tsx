import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { FeatureIcon } from "@/components/BrandAssets";

const features = [
  {
    icon: "review" as const,
    title: "Tuned SOUL",
    desc: "Each expert ships with a role, workflow, boundaries, and escalation rules instead of a loose prompt snippet.",
  },
  {
    icon: "devops" as const,
    title: "Reusable Skills",
    desc: "Hermes skills turn repeated work like PR review or PRD evaluation into predictable operating procedures.",
  },
  {
    icon: "docs" as const,
    title: "Safe Tool Defaults",
    desc: "MCP access starts from minimal permissions, with explicit env hints and no packaged user secrets or memory.",
  },
  {
    icon: "qa" as const,
    title: "Certified Examples",
    desc: "Every available expert includes examples, eval notes, known limitations, and a ChaoGeek certification file.",
  },
];

export function Features() {
  return (
    <section id="why" className="section-shell bg-crew-bg">
      <div className="site-container">
        <SectionHeader
          label="OUR FEATURES"
          title="Not Just Prompts"
          description="Every ChaoGeek-certified expert is a tested Hermes profile with tuned behavior, skills, examples, and boundaries."
          centered
        />

        <div className="polished-panel mt-12 md:mt-14">
          <div className="grid grid-cols-1 md:grid-cols-2">
            {features.map((feature, index) => (
              <ScrollReveal key={feature.title} delay={index * 0.08}>
                <div
                  className={`relative h-full p-7 md:min-h-[250px] md:p-9 ${
                    index % 2 === 0 ? "md:border-r md:border-white/10" : ""
                  } ${index < 2 ? "border-b border-white/10" : ""}`}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(200,121,65,0.48),transparent)] opacity-70" />
                  <div className="flex items-start gap-4 md:gap-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center md:h-16 md:w-16">
                      <FeatureIcon
                        name={feature.icon}
                        className="h-14 w-14 md:h-16 md:w-16"
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="max-w-[360px] font-sans text-[24px] leading-[1.12] text-crew-heading md:text-[26px]">
                        {feature.title}
                      </h3>
                      <p className="mt-4 max-w-[360px] text-sm leading-7 text-crew-body">
                        {feature.desc}
                      </p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
