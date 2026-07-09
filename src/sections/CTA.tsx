import { Terminal } from "@/components/Terminal";
import { ScrollReveal } from "@/components/ScrollReveal";
import { findInstallCommand } from "@/data/experts";

interface CTAProps {
  onGetStarted: () => void;
}

export function CTA({ onGetStarted }: CTAProps) {
  const installCommand = findInstallCommand("product-prd-crab") ?? "pnpm --silent run crewclaw";

  return (
    <section className="relative overflow-hidden bg-crew-bg-dark py-[110px]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(200,121,65,0.12),transparent_55%)] opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/8" />

      <div className="relative mx-auto max-w-[880px] px-6 text-center">
        <ScrollReveal>
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/38">
            ( READY TO HIRE )
          </span>
        </ScrollReveal>

        <ScrollReveal delay={0.08}>
          <h2 className="mt-5 font-sans text-[38px] md:text-[62px] font-light tracking-[-0.04em] leading-[0.96] text-crew-heading">
            <span className="text-white/75">( </span>
            <span>Install A Certified Expert</span>
            <span className="text-crew-copper/90"> )</span>
          </h2>
        </ScrollReveal>

        <ScrollReveal delay={0.14}>
          <p className="mx-auto mt-5 max-w-[460px] text-sm md:text-[15px] leading-relaxed text-crew-body">
            Start with Code Review Shrimp or Product PRD Crab, then reuse the profile as the work repeats.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.22} className="mt-10 flex justify-center">
          <div className="w-full max-w-[620px] rounded-[20px] border border-white/8 bg-white/[0.02] p-3 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
            <Terminal command={installCommand} triggerOnView />
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.32} className="mt-8">
          <button
            onClick={onGetStarted}
            className="rounded-sm border border-[#F2EDE6]/70 bg-[#F2EDE6] px-8 py-3 font-mono text-sm font-semibold text-[#17120F] transition-colors hover:bg-white"
          >
            Join the preview
          </button>
        </ScrollReveal>
      </div>
    </section>
  );
}
