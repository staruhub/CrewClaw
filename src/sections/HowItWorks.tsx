import { ScrollReveal } from "@/components/ScrollReveal";
import {
  CREWCLAW_SOURCE_URL,
  isLocalDevelopment,
  localCrewClawCommand,
} from "@/data/experts";

const steps = isLocalDevelopment
  ? [
      {
        step: "01",
        title: "Choose An Expert",
        desc: "Browse the launch crew and pick a certified Hermes profile for review, product work, onboarding, or docs.",
        preview: "template",
      },
      {
        step: "02",
        title: "Install With Hermes",
        desc: "Copy one local command. The wrapper calls official Hermes profile installation and keeps local secrets out of the package.",
        preview: "ai",
      },
      {
        step: "03",
        title: "Run Repeated Work",
        desc: "Start with the first task, then reuse the same expert whenever your PRs, PRDs, or docs need another pass.",
        preview: "launch",
      },
    ]
  : [
      {
        step: "01",
        title: "Explore The Crew",
        desc: "Review the certified profiles, declared tools, permissions, and expected deliverables before setup.",
        preview: "template",
      },
      {
        step: "02",
        title: "Use Local Setup",
        desc: "Open the public source repository and follow its setup guide. No unpublished package command is presented as installable.",
        preview: "ai",
      },
      {
        step: "03",
        title: "Run Repeated Work",
        desc: "Once the local checkout is ready, reuse the same expert whenever recurring work needs another pass.",
        preview: "launch",
      },
    ];

const cliDocs = isLocalDevelopment
  ? [
      {
        label: "Open",
        title: "Start CrewClaw",
        command: localCrewClawCommand,
        desc: "Works from any directory and opens the expert picker.",
      },
      {
        label: "Choose",
        title: "Pick an employee",
        command: "Choose an expert number or slug: 1",
        desc: "Available experts install immediately; Coming Soon profiles stay blocked.",
      },
      {
        label: "First Run",
        title: "Test the profile",
        command: `${localCrewClawCommand} hire code-review-shrimp --run-first`,
        desc: "Runs the first Hermes chat test after installation.",
      },
      {
        label: "Help",
        title: "Guide agents",
        command: `${localCrewClawCommand} help`,
        desc: "Shows commands, safety checks, and the agent instruction to use CrewClaw first.",
      },
    ]
  : [
      {
        label: "Source",
        title: "View source",
        command: CREWCLAW_SOURCE_URL,
        desc: "Inspect the current code, employee packages, and verification gates.",
      },
      {
        label: "Setup",
        title: "Local setup",
        command: "Follow README.md from a local checkout",
        desc: "Install pinned dependencies and run CrewClaw from the checked-out repository.",
      },
      {
        label: "Distribution",
        title: "Package pending",
        command: "No public package command is advertised",
        desc: "The install control stays disabled until a published artifact passes a packaged smoke test.",
      },
      {
        label: "Trust",
        title: "Review before run",
        command: "Inspect permissions and source first",
        desc: "The local setup path remains explicit while public distribution is pending.",
      },
    ];

function TemplatePreview() {
  return (
    <div className="relative h-full overflow-hidden bg-[#191816]">
      <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(255,255,255,0.2),rgba(239,103,52,0.5)_48%,rgba(255,255,255,0.04))] blur-2xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(220,111,62,0.16),transparent_42%)]" />
      <div className="relative p-6 text-sm text-white">Template</div>
      <div className="absolute inset-x-6 bottom-8 grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map(item => (
          <div
            key={item}
            className={`h-[96px] border bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
              item === 2
                ? "border-[#8C3E27] bg-white/[0.045]"
                : "border-white/8"
            }`}
          >
            <div className="mt-16 mx-2 h-1 bg-white/8" />
            <div className="mt-2 mx-2 h-1 w-1/2 bg-white/6" />
          </div>
        ))}
      </div>
      <div className="absolute bottom-4 left-6 h-px w-24 bg-white/12" />
      <div className="absolute bottom-4 right-6 h-px w-16 bg-white/10" />
    </div>
  );
}

function AiPreview() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#151513]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(226,110,60,0.08),transparent_52%)]" />
      <div className="absolute h-36 w-36 rounded-full border border-[#8E442B]/18 bg-[radial-gradient(circle,rgba(255,224,205,0.42),rgba(230,111,58,0.44)_34%,rgba(143,55,30,0.16)_58%,transparent_75%)] blur-[1px]" />
      <div className="absolute h-20 w-20 rounded-full border border-white/12 bg-[radial-gradient(circle,rgba(255,255,255,0.68),rgba(239,158,112,0.66)_42%,rgba(151,58,32,0.24)_72%,transparent_100%)] shadow-[0_0_34px_rgba(218,101,55,0.28)]" />
      <div className="absolute h-10 w-10 rounded-full bg-white/14 blur-xl" />
      <div className="absolute bottom-7 text-center">
        <p className="text-[11px] text-white">Generating preview</p>
        <p className="mt-1 text-[8px] text-white/40">Thinking...</p>
        <div className="mt-3 flex justify-center gap-1">
          <span className="h-1 w-1 rounded-full bg-white/35" />
          <span className="h-1 w-1 rounded-full bg-white/18" />
          <span className="h-1 w-1 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  );
}

function LaunchPreview() {
  return (
    <div className="relative h-full overflow-hidden bg-[#181715]">
      <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(255,255,255,0.18),rgba(235,101,50,0.5)_58%,rgba(255,255,255,0.035))] blur-2xl" />
      <div className="absolute left-[-6px] top-[58px] font-sans text-[50px] tracking-[-0.06em] text-white/[0.045]">
        LAUNCH SCALE
      </div>
      <div className="absolute left-4 top-[86px] h-16 w-20 border-l border-white/7" />
      <div className="absolute right-[28px] top-[48px] h-[78px] w-[132px] border border-white/16 bg-[#242220]/92 shadow-[18px_20px_50px_rgba(0,0,0,0.35)]" />
      <div className="absolute right-[44px] top-[66px] h-[78px] w-[132px] border border-white/14 bg-[#242220]/95 shadow-[14px_18px_42px_rgba(0,0,0,0.35)]" />
      <div className="absolute right-[60px] top-[84px] h-[78px] w-[132px] border border-white/12 bg-[#242220] shadow-[12px_16px_34px_rgba(0,0,0,0.32)]" />
      <div className="absolute right-[84px] bottom-[28px] h-[76px] w-[150px] border border-white/16 bg-[#211F1D] shadow-[0_18px_42px_rgba(0,0,0,0.45)]">
        <div className="absolute bottom-4 left-5 h-1 w-16 bg-white/10" />
        <div className="absolute bottom-4 right-5 h-1 w-8 bg-white/8" />
        <div className="absolute top-4 left-5 h-px w-20 bg-white/8" />
      </div>
      <div className="absolute bottom-10 right-36 h-px w-20 bg-white/10" />
      <div className="absolute bottom-7 right-14 h-px w-28 bg-white/8" />
    </div>
  );
}

function StepPreview({ type }: { type: string }) {
  if (type === "template") return <TemplatePreview />;
  if (type === "ai") return <AiPreview />;
  return <LaunchPreview />;
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="section-shell bg-[radial-gradient(ellipse_at_center,rgba(70,29,16,0.44)_0%,rgba(24,14,12,0.78)_46%,#0A0908_100%)]"
    >
      <div className="site-container max-w-[1060px]">
        <ScrollReveal className="text-center">
          <h2 className="font-sans text-[34px] font-light leading-[1.04] text-crew-heading md:text-[52px]">
            <span>( How It </span>
            <span className="text-crew-copper">Works )</span>
          </h2>
          <p className="mt-4 text-[14px] leading-7 text-white/52">
            From fresh Hermes install to first expert task in one short path.
          </p>
        </ScrollReveal>

        <div className="polished-panel mt-12 grid grid-cols-1 bg-[#0E0B0A] md:grid-cols-3">
          {steps.map((step, index) => (
            <ScrollReveal key={step.step} delay={index * 0.1}>
              <article
                className={`min-h-[430px] border-white/10 ${
                  index < steps.length - 1 ? "md:border-r" : ""
                }`}
              >
                <div className="flex min-h-[228px] flex-col px-7 pt-8">
                  <p className="text-[13px] text-white/58">
                    (Step<span className="text-crew-copper">{step.step}</span>)
                  </p>
                  <h3 className="mt-10 font-sans text-[24px] font-light leading-tight text-white md:text-[26px]">
                    {step.title}
                  </h3>
                  <p className="mt-4 max-w-[270px] text-[14px] leading-7 text-white/46">
                    {step.desc}
                  </p>
                </div>
                <div className="h-[202px] border-t border-white/8">
                  <StepPreview type={step.preview} />
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal className="mt-10">
          <div className="polished-panel bg-[#0E0B0A]">
            <div className="grid grid-cols-1 gap-0 md:grid-cols-[280px_1fr]">
              <div className="border-b border-white/10 p-6 md:border-b-0 md:border-r md:p-8">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-crew-copper/80">
                  {isLocalDevelopment
                    ? "CrewClaw CLI Docs"
                    : "CrewClaw Source Docs"}
                </p>
                <h3 className="mt-4 font-sans text-[28px] font-light leading-tight text-crew-heading">
                  {isLocalDevelopment
                    ? "Command-line hiring path"
                    : "Source-based setup path"}
                </h3>
                <p className="mt-4 text-sm leading-7 text-white/52">
                  {isLocalDevelopment
                    ? "Copy the launcher, choose an expert, then let Hermes install the isolated profile."
                    : "View the repository, follow the local setup guide, and inspect the profile before running it."}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2">
                {cliDocs.map((item, index) => (
                  <div
                    key={item.label}
                    className={`p-5 md:p-6 ${index < 2 ? "border-b border-white/10" : ""} ${
                      index % 2 === 0 ? "md:border-r md:border-white/10" : ""
                    }`}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/38">
                      {item.label}
                    </p>
                    <h4 className="mt-3 font-sans text-[20px] leading-tight text-crew-heading">
                      {item.title}
                    </h4>
                    <code className="mt-4 block break-words rounded-[8px] border border-white/8 bg-black/24 p-3 font-mono text-[12px] leading-6 text-white/72">
                      {item.command}
                    </code>
                    <p className="mt-3 text-sm leading-6 text-crew-body">
                      {item.desc}
                    </p>
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
