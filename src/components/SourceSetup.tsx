import { ArrowUpRight } from "lucide-react";

import { CREWCLAW_SOURCE_URL } from "@/data/experts";

interface SourceSetupProps {
  className?: string;
}

export function SourceSetup({ className = "" }: SourceSetupProps) {
  return (
    <div
      className={`rounded-[10px] border border-white/10 bg-white/[0.025] p-5 text-left shadow-[0_24px_70px_rgba(0,0,0,0.32)] ${className}`}
      data-testid="source-setup"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-crew-copper/90">
        Local setup
      </p>
      <p className="mt-3 text-sm leading-6 text-crew-body">
        Public package distribution is not available yet. Use the repository
        setup guide to run CrewClaw from a local source clone.
      </p>
      <a
        className="mt-4 inline-flex items-center gap-2 font-mono text-xs font-semibold text-crew-heading transition-colors hover:text-crew-copper"
        href={CREWCLAW_SOURCE_URL}
        rel="noreferrer"
        target="_blank"
      >
        View source <ArrowUpRight size={14} />
      </a>
    </div>
  );
}
