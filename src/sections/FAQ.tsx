import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";

const faqs = [
  {
    q: "What can I install today?",
    a: "The MVP ships two available Hermes profiles: Code Review Shrimp and Product PRD Crab. Onboarding Conch and Docs Octopus are visible as Coming Soon.",
  },
  {
    q: "Is CrewClaw replacing Hermes?",
    a: "No. Hermes remains the runtime. CrewClaw distributes ChaoGeek-certified profile packages and wraps official Hermes profile commands for easier onboarding.",
  },
  {
    q: "What is inside a profile?",
    a: "Each available expert includes SOUL.md, config.yaml, mcp.json, certification notes, examples, eval notes, changelog, and reusable Hermes skills.",
  },
  {
    q: "How do I get started?",
    a: "Install Hermes, copy the CrewClaw CLI command from the expert card, choose an available employee, then run the first Hermes test command CrewClaw prints after installation.",
  },
  {
    q: "How do you handle secrets and permissions?",
    a: "Expert packages must not include real .env files, auth files, memory, sessions, logs, or state DBs. MCP tools use explicit permission declarations.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="section-shell bg-crew-bg">
      <div className="site-container grid grid-cols-1 gap-10 md:gap-14 lg:grid-cols-[260px_1fr] lg:gap-20">
        <div>
          <SectionHeader label="FAQ" title="FAQ" />
        </div>

        <ScrollReveal className="space-y-0">
          {faqs.map((faq, index) => (
            <div key={faq.q} className="border-b border-white/10">
              <button
                onClick={() => setOpen(open === index ? -1 : index)}
                className="group flex w-full items-start justify-between gap-5 py-5 text-left md:gap-6 md:py-6"
              >
                <div className="pr-4">
                  <span
                    className={`block font-sans text-[21px] leading-[1.22] transition-colors md:text-[23px] ${
                      open === index ? "text-crew-heading" : "text-white/86 group-hover:text-crew-heading"
                    }`}
                  >
                    {faq.q}
                  </span>
                  {open === index && (
                    <p className="max-w-[680px] pt-5 text-sm leading-7 text-crew-body">
                      {faq.a}
                    </p>
                  )}
                </div>
                <span className="mt-1 shrink-0 text-white/40 transition-colors group-hover:text-crew-copper">
                  {open === index ? <ArrowUpRight size={18} /> : <ChevronRight size={18} />}
                </span>
              </button>
            </div>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
