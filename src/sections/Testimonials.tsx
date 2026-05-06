import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";

const testimonials = [
  {
    quote: "CrewClaw saved me weeks of setup time. The AI-powered code review agent caught bugs our human reviewers missed.",
    author: "David Chen",
    role: "CTO at StreamLine",
    avatar: "D",
  },
  {
    quote: "We hired a testing crew of 3 agents. They run 24/7, covering unit tests, integration, and E2E. Our release velocity doubled.",
    author: "Sarah Kim",
    role: "Engineering Lead",
    avatar: "S",
  },
  {
    quote: "The DevOps agent handles our CI/CD pipeline end to end. Auto-deploy, rollback, and health checks now happen without manual overhead.",
    author: "Marcus Wu",
    role: "DevOps Architect",
    avatar: "M",
  },
];

export function Testimonials() {
  const [active, setActive] = useState(1);

  const prev = () => setActive((current) => (current === 0 ? testimonials.length - 1 : current - 1));
  const next = () => setActive((current) => (current === testimonials.length - 1 ? 0 : current + 1));

  return (
    <section className="section-shell bg-crew-bg">
      <div className="site-container">
        <SectionHeader label="TESTIMONIALS" title="Client Testimonial" centered />

        <ScrollReveal className="mt-10 md:mt-16">
          <div className="relative">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {testimonials.map((testimonial, index) => {
                const isActive = index === active;

                return (
                  <div
                    key={testimonial.author}
                    className={`min-h-[300px] flex-col justify-between rounded-[8px] border px-6 py-8 text-center transition-all duration-500 md:min-h-[320px] md:px-8 md:py-10 ${
                      isActive ? "flex" : "hidden lg:flex"
                    } ${
                      isActive
                        ? "border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.016))] lg:scale-[1.01]"
                        : "border-white/6 bg-white/[0.015] lg:opacity-70"
                    }`}
                  >
                    <div>
                      <Quote size={30} className="mx-auto mb-6 text-crew-copper" />
                      <p
                        className={`font-sans text-[21px] leading-[1.26] md:text-[24px] ${
                          isActive ? "text-crew-heading" : "text-white/78"
                        }`}
                      >
                        {testimonial.quote}
                      </p>
                    </div>

                    <div className="mt-10 flex items-center justify-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] font-mono text-sm text-crew-heading">
                        {testimonial.avatar}
                      </div>
                      <div className="text-left">
                        <p className="text-sm text-crew-heading">{testimonial.author}</p>
                        <p className="text-xs text-crew-muted">{testimonial.role}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={prev}
                className="flex h-12 w-12 items-center justify-center border border-white/10 bg-transparent text-crew-body transition-colors hover:border-crew-copper/30 hover:text-crew-heading"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={next}
                className="flex h-12 w-12 items-center justify-center border border-crew-copper/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,225,212,0.92))] text-[#1A1512] shadow-[0_10px_26px_rgba(200,121,65,0.16)] transition-transform hover:-translate-y-0.5"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
