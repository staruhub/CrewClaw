import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { GitPullRequest, Repeat2, ScrollText } from "lucide-react";

const workflows = [
  {
    title: "Every PR",
    desc: "Code Review Shrimp can run whenever a branch needs risk review, security scanning, or a team-ready merge summary.",
    icon: GitPullRequest,
  },
  {
    title: "Every PRD",
    desc: "Product PRD Crab turns vague product notes into edge cases, acceptance criteria, and measurable decision points.",
    icon: ScrollText,
  },
  {
    title: "Every Iteration",
    desc: "Profiles stay reusable: the same expert can be updated, validated, and re-run as the workflow repeats.",
    icon: Repeat2,
  },
];

export function Testimonials() {
  return (
    <section className="section-shell bg-crew-bg">
      <div className="site-container">
        <SectionHeader
          label="RECURRING WORK"
          title="Built For Repeated Triggers"
          description="The product thesis is not one-off chat. It is expert profiles entering work that repeats."
          centered
        />

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {workflows.map((workflow, index) => {
            const Icon = workflow.icon;
            return (
              <ScrollReveal key={workflow.title} delay={index * 0.08}>
                <article className="h-full rounded-[8px] border border-white/10 bg-white/[0.018] p-6">
                  <Icon className="text-crew-copper" size={24} />
                  <h3 className="mt-6 font-sans text-[25px] text-crew-heading">{workflow.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-crew-body">{workflow.desc}</p>
                </article>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
