import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { experts, getInstallCommand } from "@/data/experts";
import { writeClipboard } from "@/lib/clipboard";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

const layers = [
  { color: "#C87941", file: "SOUL.md", layer: "Soul", desc: "Role, workflow, boundaries, escalation rules" },
  { color: "#D4853A", file: "skills/**/SKILL.md", layer: "Skills", desc: "Reusable Hermes procedures for repeated work" },
  { color: "#E8A87C", file: "mcp.json", layer: "Tools", desc: "Optional external tools with explicit permissions" },
  { color: "#8B6F4E", file: "CERTIFICATION.md", layer: "Trust", desc: "ChaoGeek tuning notes, tests, and known limits" },
  { color: "#A89B91", file: "distribution.yaml", layer: "Manifest", desc: "Hermes install metadata and owned files" },
];

interface AgentPackageProps {
  onJoinWaitlist: () => void;
}

export function AgentPackage({ onJoinWaitlist }: AgentPackageProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);

  const copyInstall = async (name: string, command: string | null) => {
    if (!command) return;
    const ok = await writeClipboard(command);
    setCopyFailed(ok ? null : name);
    setCopied(ok ? name : null);
    window.setTimeout(() => {
      setCopied(null);
      setCopyFailed(null);
    }, 1800);
  };

  return (
    <section id="market" className="section-shell bg-crew-bg">
      <div className="site-container">
        <SectionHeader
          label="EXPERT CREW"
          title="Four Launch Experts"
          description="Two certified profiles are installable now. Two starter profiles stay visible as the next wave."
          centered
        />

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {experts.map((expert, index) => {
            const installCommand = getInstallCommand(expert);

            return (
              <ScrollReveal key={expert.name} delay={index * 0.06}>
              <article className="flex h-full flex-col rounded-[8px] border border-white/10 bg-white/[0.018] p-5 transition-colors hover:border-crew-copper/30 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/38">
                      {expert.category} / {expert.certification}
                    </p>
                    <h3 className="mt-3 font-sans text-[24px] leading-tight text-crew-heading">
                      {expert.display_name}
                    </h3>
                  </div>
                  <span
                    className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                      expert.status === "available"
                        ? "border-crew-copper/30 bg-crew-copper/10 text-crew-copper"
                        : "border-white/10 bg-white/[0.03] text-white/45"
                    }`}
                  >
                    {expert.status === "available" ? "Available" : "Coming Soon"}
                  </span>
                </div>

                <p className="mt-4 flex-1 text-sm leading-7 text-crew-body">{expert.description}</p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {expert.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-sm border border-white/8 bg-black/15 px-2 py-1 font-mono text-[10px] text-white/48"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-5 rounded-[8px] border border-white/8 bg-black/18 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">CrewClaw CLI</p>
                  <code className="mt-2 block break-words font-mono text-[12px] leading-6 text-white/70">
                    {installCommand ?? "Join waitlist for launch notice"}
                  </code>
                </div>

                <button
                  onClick={() =>
                    expert.status === "available"
                      ? copyInstall(expert.name, installCommand)
                      : onJoinWaitlist()
                  }
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.035] px-4 font-mono text-xs font-semibold text-crew-heading transition-colors hover:border-crew-copper/35 hover:bg-crew-copper/10"
                >
                  {expert.status === "available" ? (
                    copied === expert.name ? (
                      <>
                        <Check size={15} /> Copied CrewClaw CLI
                      </>
                    ) : copyFailed === expert.name ? (
                      <>
                        <Copy size={15} /> Copy failed
                      </>
                    ) : (
                      <>
                        <Copy size={15} /> Copy CrewClaw CLI
                      </>
                    )
                  ) : (
                    "Join waitlist"
                  )}
                </button>
              </article>
              </ScrollReveal>
            );
          })}
        </div>

        <ScrollReveal className="mt-14">
          <div className="polished-panel">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 font-mono text-[11px] uppercase tracking-[0.28em] text-white/35">
              <span>Profile Package</span>
              <span className="text-crew-copper/75">5 layers</span>
            </div>
            {layers.map((item, i) => (
              <div
                key={item.file}
                className={`grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_130px_1fr] md:items-center ${
                  i !== layers.length - 1 ? "border-b border-white/8" : ""
                }`}
                style={{ backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.14)" }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-px w-5 shrink-0" style={{ backgroundColor: item.color, opacity: 0.8 }} />
                  <code className="break-all font-mono text-[12px] text-white/72">{item.file}</code>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/48">{item.layer}</span>
                <span className="text-sm leading-relaxed text-crew-body">{item.desc}</span>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
