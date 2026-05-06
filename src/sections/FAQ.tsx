import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";

const faqs = [
  {
    q: "What type of AI agents can I hire?",
    a: "CrewClaw offers specialized agents for code review, DevOps automation, testing, documentation, product management, security audits, and architecture design.",
  },
  {
    q: "How does an AI agent integrate with my workflow?",
    a: "Agents install via CLI, connect into your existing tools, read your codebase context, and work within your team’s rules and delivery flow.",
  },
  {
    q: "What industries do you specialize in?",
    a: "The platform is built for software teams across startups, agencies, product companies, and enterprise engineering organizations.",
  },
  {
    q: "How do I get started?",
    a: "Install the open-source CLI, hire your first agent, and then expand the crew as your workflow grows.",
  },
  {
    q: "How do you handle security?",
    a: "Agents can run with isolated permissions, environment-aware rules, and enterprise controls for auditability and deployment boundaries.",
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
