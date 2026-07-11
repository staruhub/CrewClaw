import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";

const founder = {
  name: "PONG",
  title: "FOUNDER & CEO",
  bio: "14 yrs IT · iFlytek AI Dev 1st Place · Asia AI Startup HK Champion · ADG Guangzhou Leader · TRAE Expert · Multi-Agent Architect",
};

const advisors = [
  {
    name: "RICHARD",
    title: "ADVISOR",
    bio: "OneOneTalk Co-founder · Business & Market Strategy",
  },
  {
    name: "ZENETH",
    title: "ADVISOR",
    bio: "ClawTime Founder · Community & Ecosystem · World AI Conference 2026 Co-Organiser",
  },
];

const achievements = [
  "Beyond Expo Pitch Finals",
  "NVIDIA Outstanding Exhibitor",
  "World AI Conference 2026 Co-Organiser",
  "ClawTime HK Speaker",
];

export function Team() {
  return (
    <section id="team" className="section-shell bg-crew-bg-dark">
      <div className="site-container">
        <SectionHeader label="TEAM" title="Built by Builders" centered />

        <div className="grid grid-cols-1 gap-5 mt-10 md:mt-14 lg:grid-cols-[1.3fr_0.7fr]">
          <ScrollReveal>
            <div className="polished-panel h-full p-6 md:p-10">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
                <div className="md:w-[180px] shrink-0">
                  <div className="rounded-[8px] border border-crew-copper/20 bg-crew-copper/5 p-5">
                    <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-crew-copper/80">
                      Founder
                    </span>
                    <div className="mt-6 flex items-end justify-between">
                      <span className="font-sans text-[56px] font-light leading-none tracking-[-0.05em] text-crew-heading">
                        P
                      </span>
                      <span className="font-mono text-[11px] text-white/30">
                        01
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/34">
                    Core profile
                  </span>
                  <h3 className="mt-4 font-sans text-[34px] font-light text-crew-heading">
                    {founder.name}
                  </h3>
                  <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.26em] text-crew-copper/78">
                    {founder.title}
                  </span>
                  <p className="mt-5 max-w-[620px] text-sm leading-7 text-crew-body md:mt-6">
                    {founder.bio}
                  </p>
                </div>
              </div>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 gap-5">
            {advisors.map((advisor, i) => (
              <ScrollReveal key={advisor.name} delay={0.16 + i * 0.12}>
                <div className="h-full rounded-[8px] border border-white/10 bg-black/16 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-mono text-[11px] uppercase tracking-[0.26em] text-white/30">
                      Advisor {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[11px] text-crew-copper/70">
                      {advisor.name[0]}
                    </span>
                  </div>
                  <h3 className="mt-5 font-mono text-base font-semibold text-crew-heading">
                    {advisor.name}
                  </h3>
                  <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.22em] text-white/42">
                    {advisor.title}
                  </span>
                  <p className="mt-4 text-sm leading-relaxed text-crew-body">
                    {advisor.bio}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>

        <ScrollReveal delay={0.35} className="mt-6 md:mt-8">
          <div className="rounded-[8px] border border-white/10 bg-black/14 px-6 py-5 md:px-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-start">
              <span className="md:w-[190px] shrink-0 font-mono text-[11px] uppercase tracking-[0.28em] text-white/34">
                Selected Milestones
              </span>
              <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                {achievements.map(achievement => (
                  <div
                    key={achievement}
                    className="flex items-center gap-3 border-b border-white/6 pb-3 last:border-b-0 md:last:border-b md:last:pb-3"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-crew-copper/80" />
                    <span className="text-sm text-crew-body">
                      {achievement}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
