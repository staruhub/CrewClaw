import { Terminal } from "@/components/Terminal";
import { ScrollReveal } from "@/components/ScrollReveal";
import { AsciiCanvas } from "@/components/AsciiCanvas";

interface HeroProps {
  onGetStarted: () => void;
}

export function Hero({ onGetStarted }: HeroProps) {
  return (
    <section className="relative isolate flex min-h-[760px] flex-col items-center justify-center overflow-hidden bg-crew-bg px-4 pt-24 pb-14 sm:px-6 lg:min-h-[820px]">
      {/* ASCII Agent Canvas Background */}
      <AsciiCanvas />

      {/* Foreground readability masks */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at center, rgba(9, 8, 7, 0.04) 0%, rgba(9, 8, 7, 0.14) 30%, rgba(9, 8, 7, 0.46) 72%, rgba(9, 8, 7, 0.86) 100%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-crew-bg via-crew-bg/88 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-crew-bg via-crew-bg/90 to-transparent" />
        <div
          className="absolute left-1/2 top-[38%] h-[300px] w-[min(84vw,760px)] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(9, 8, 7, 0.5) 0%, rgba(9, 8, 7, 0.3) 38%, rgba(9, 8, 7, 0.1) 68%, rgba(9, 8, 7, 0) 100%)",
          }}
        />
        <div
          className="absolute left-1/2 top-[72%] h-[210px] w-[min(82vw,680px)] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(9, 8, 7, 0.72) 0%, rgba(9, 8, 7, 0.34) 54%, rgba(9, 8, 7, 0) 100%)",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 isolate mx-auto w-full max-w-[760px] text-center">
        <div
          className="pointer-events-none absolute left-1/2 top-[48%] z-0 h-[320px] w-[min(90vw,700px)] -translate-x-1/2 -translate-y-1/2 rounded-[40px] blur-2xl"
          style={{
            background:
              "radial-gradient(circle, rgba(9, 8, 7, 0.9) 0%, rgba(9, 8, 7, 0.74) 34%, rgba(9, 8, 7, 0.38) 62%, rgba(9, 8, 7, 0) 100%)",
          }}
        />
        <ScrollReveal className="relative z-10">
          <h1 className="gradient-text mx-auto max-w-full font-mono text-[36px] font-light leading-[1.08] drop-shadow-[0_10px_28px_rgba(0,0,0,0.9)] sm:text-[44px] md:text-[64px]">
            {"( CrewClaw )"}
          </h1>
        </ScrollReveal>

        <ScrollReveal delay={0.1} className="relative z-10">
          <p className="mx-auto mt-5 max-w-[calc(100vw-2rem)] px-1 text-[15px] leading-7 text-[#D8CEC5] drop-shadow-[0_4px_18px_rgba(0,0,0,0.95)] sm:max-w-[560px] md:text-[16px]">
            The world's first AI agent talent market. Hire specialized agents
            for code review, testing, DevOps, docs — your AI crew awaits.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.2} className="relative z-10 mt-8 flex w-full flex-wrap justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="w-full max-w-[240px] rounded-[8px] bg-gradient-to-r from-crew-copper to-crew-bronze px-8 py-3.5 font-mono text-sm font-semibold text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] transition-all hover:-translate-y-0.5 hover:brightness-110 sm:w-auto"
          >
            Get Started — Free
          </button>
          <button
            onClick={() => {
              const el = document.querySelector("#how-it-works");
              if (el) {
                const offset = 80;
                const top = el.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({ top, behavior: "smooth" });
              }
            }}
            className="w-full max-w-[240px] rounded-[8px] border border-crew-border bg-black/20 px-8 py-3.5 font-mono text-sm text-crew-muted shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-all hover:border-crew-copper hover:text-crew-heading sm:w-auto"
          >
            View Demo
          </button>
        </ScrollReveal>
      </div>

      {/* Terminal Preview */}
      <div className="relative z-10 mx-auto mt-12 w-full max-w-[calc(100vw-2rem)] md:mt-14 md:max-w-[680px]">
        <div
          className="pointer-events-none absolute inset-x-2 -top-8 bottom-[-28px] rounded-[36px] blur-3xl sm:inset-x-8"
          style={{
            background:
              "radial-gradient(circle, rgba(9, 8, 7, 0.72) 0%, rgba(9, 8, 7, 0.24) 58%, rgba(9, 8, 7, 0) 100%)",
          }}
        />
        <ScrollReveal delay={0.3} className="w-full min-w-0">
          <Terminal command="npx crewclaw run --plan --parallel --verify" className="mx-auto" />
        </ScrollReveal>
      </div>
    </section>
  );
}
