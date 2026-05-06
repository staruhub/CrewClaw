import { Facebook, Instagram, Linkedin, X } from "lucide-react";
import { CrewClawMark } from "@/components/BrandAssets";

interface FooterProps {
  onGetStarted: () => void;
}

export function Footer({ onGetStarted }: FooterProps) {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-[#100D0B]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-crew-bg to-transparent" />
      <div className="pointer-events-none absolute bottom-0 right-[12%] h-[260px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(200,121,65,0.12),rgba(200,121,65,0.045)_38%,rgba(0,0,0,0)_72%)] blur-2xl" />

      <div className="site-container relative">
        <div className="grid grid-cols-1 gap-10 py-12 md:py-16 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
          <div>
            <div className="flex items-center gap-4">
              <CrewClawMark className="h-14 w-14 shrink-0 md:h-16 md:w-16" />
              <div className="flex items-baseline gap-1">
                <span className="font-sans text-[40px] font-light text-crew-heading md:text-[56px]">CrewClaw</span>
                <span className="font-sans text-[40px] font-light text-crew-copper md:text-[56px]">.</span>
              </div>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-7 md:mt-14 md:grid-cols-4 md:gap-8">
              <div className="space-y-3">
                <a href="#why" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">Features</a>
                <a href="#how-it-works" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">Workflow</a>
                <a href="#market" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">Package</a>
              </div>
              <div className="space-y-3">
                <a href="#pricing" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">Pricing</a>
                <a href="#team" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">Team</a>
                <a href="#faq" className="block text-sm text-crew-body transition-colors hover:text-crew-heading">FAQ</a>
              </div>
              <div className="space-y-3">
                <span className="block text-sm text-crew-body">Style Guide</span>
                <span className="block text-sm text-crew-body">License</span>
                <span className="block text-sm text-crew-body">Changelog</span>
              </div>
              <div>
                <span className="mb-4 block font-mono text-[11px] uppercase tracking-[0.24em] text-white/38">Social media</span>
                <div className="flex gap-3">
                  {[X, Facebook, Instagram, Linkedin].map((Icon, index) => (
                    <span
                      key={index}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-crew-heading"
                    >
                      <Icon size={16} />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:pt-4">
            <p className="max-w-[340px] font-sans text-[30px] leading-[1.08] text-crew-heading md:text-[34px] lg:max-w-[280px]">
              Ready To Build Smarter With CrewClaw?
            </p>
            <button
              onClick={onGetStarted}
              className="mt-7 rounded-[8px] border border-[#F2EDE6]/70 bg-[#F2EDE6] px-8 py-3 font-mono text-sm font-semibold text-[#17120F] transition-colors hover:bg-white md:mt-8"
            >
              Get Started Now
            </button>
            <p className="mt-10 max-w-[320px] text-xs text-white/42 md:mt-16">
              Design direction aligned to your reference, adapted for CrewClaw.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
