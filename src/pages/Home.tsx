import { Link } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Cpu,
  DatabaseZap,
  Fingerprint,
  GitBranch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Terminal } from "@/components/Terminal";

const stats = [
  ["05", "published employees"],
  ["L0-L4", "runtime contract"],
  ["100%", "permission gated"],
  ["1", "shared source of truth"],
] as const;

const runtimeLevels = [
  ["L0", "Identity", "SOUL, role and operating boundaries"],
  ["L1", "Skills", "Reusable procedures and examples"],
  ["L2", "Tools", "Capability-scoped runtime access"],
  ["L3", "Memory", "Accepted work becomes evidence"],
  ["L4", "Dream", "Human-gated continuous improvement"],
] as const;

export default function Home() {
  return (
    <div className="landing-v4 min-h-screen overflow-hidden bg-[#0a0a09] text-[#f2eee7]">
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-4 rounded-full border border-white/10 bg-[#10100f]/90 px-4 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:px-5"
        >
          <Link className="flex min-w-0 items-center gap-3" to="/">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#ec9552] font-mono text-xs font-black text-[#15100c]">
              CC
            </span>
            <span className="landing-display truncate text-sm font-semibold tracking-[0.08em]">
              CREWCLAW
            </span>
            <span className="hidden border-l border-white/10 pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8d877e] md:block">
              AI employee OS
            </span>
          </Link>
          <div className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[#aaa39a] lg:flex">
            <a
              className="transition-colors hover:text-[#ec9552]"
              href="#paradigm"
            >
              Paradigm
            </a>
            <a className="transition-colors hover:text-[#ec9552]" href="#moat">
              Moat
            </a>
            <a
              className="transition-colors hover:text-[#ec9552]"
              href="#runtime"
            >
              Runtime
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="hidden rounded-full px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#aaa39a] transition-colors hover:text-white sm:block"
              to="/team"
            >
              My crew
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-full bg-[#ec9552] px-4 py-2 text-xs font-bold text-[#15100c] transition-transform hover:-translate-y-0.5"
              to="/marketplace"
            >
              Hire an employee
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="landing-grid relative border-b border-white/10 px-5 pb-20 pt-32 sm:px-6 md:pb-28 md:pt-40">
          <div className="landing-orb landing-orb-one" />
          <div className="landing-orb landing-orb-two" />
          <div className="relative mx-auto grid max-w-[1180px] items-center gap-14 lg:grid-cols-[1.06fr_0.94fr] lg:gap-16">
            <div>
              <div className="landing-reveal inline-flex items-center gap-2 rounded-full border border-[#ec9552]/25 bg-[#ec9552]/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#f5b784]">
                <Sparkles className="size-3" />
                The operating system for AI employees
              </div>
              <h1 className="landing-display landing-reveal landing-reveal-1 mt-7 max-w-[760px] text-[clamp(3.7rem,8vw,7.6rem)] font-semibold leading-[0.84] tracking-[-0.065em]">
                Hire AI like you hire people.
              </h1>
              <p className="landing-reveal landing-reveal-2 mt-8 max-w-xl text-base leading-7 text-[#aaa39a] sm:text-lg sm:leading-8">
                Discover a role, inspect its permissions, hire it into your
                local workspace, run real work, and evaluate every delivery. One
                contract from marketplace to memory.
              </p>
              <div className="landing-reveal landing-reveal-3 mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-[#ec9552] px-6 py-3.5 text-sm font-bold text-[#15100c] shadow-[0_14px_40px_rgba(236,149,82,0.18)] transition-transform hover:-translate-y-0.5"
                  to="/marketplace"
                >
                  Browse AI employees
                  <ArrowRight className="size-4" />
                </Link>
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] border border-white/15 bg-white/[0.025] px-6 py-3.5 font-mono text-xs text-[#d5cfc6] transition-colors hover:border-[#ec9552]/50 hover:text-[#ec9552]"
                  href="#runtime"
                >
                  Inspect the runtime
                </a>
              </div>
              <div className="landing-reveal landing-reveal-3 mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7e786f]">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-3 text-[#79c98d]" /> Local-first
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-3 text-[#79c98d]" /> Human-gated
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-3 text-[#79c98d]" />{" "}
                  Evidence-backed
                </span>
              </div>
            </div>

            <div className="landing-reveal landing-reveal-2 relative lg:pt-10">
              <div className="absolute -inset-6 -z-10 bg-[radial-gradient(circle,rgba(236,149,82,0.12),transparent_68%)] blur-2xl" />
              <Terminal
                command="crew hire ai-adoption-whale --live --yes"
                variant="v4"
              />
              <div className="mt-3 grid gap-px overflow-hidden rounded-[2px] border border-white/10 bg-white/10 font-mono text-[11px] sm:grid-cols-2">
                <div className="bg-[#0d0d0c] p-4 text-[#8d877e]">
                  <span className="mr-2 text-[#79c98d]">01</span> contract
                  verified
                </div>
                <div className="bg-[#0d0d0c] p-4 text-[#8d877e]">
                  <span className="mr-2 text-[#79c98d]">02</span> permissions
                  frozen
                </div>
                <div className="bg-[#0d0d0c] p-4 text-[#8d877e]">
                  <span className="mr-2 text-[#79c98d]">03</span> employee
                  installed
                </div>
                <div className="bg-[#0d0d0c] p-4 text-[#8d877e]">
                  <span className="mr-2 text-[#ec9552]">04</span> ready for
                  trial
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          aria-label="CrewClaw facts"
          className="border-b border-white/10 bg-[#0d0d0c] px-5 sm:px-6"
        >
          <div className="mx-auto grid max-w-[1180px] grid-cols-2 divide-x divide-y divide-white/10 border-x border-white/10 md:grid-cols-4 md:divide-y-0">
            {stats.map(([value, label]) => (
              <div className="px-5 py-7 sm:px-7" key={label}>
                <p className="landing-display text-2xl font-semibold text-[#f2eee7] sm:text-3xl">
                  {value}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.17em] text-[#7e786f] sm:text-[10px]">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="paradigm" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto max-w-[1180px]">
            <div className="max-w-3xl">
              <p className="landing-kicker">01 / New paradigm</p>
              <h2 className="landing-display mt-5 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                Stop prompting a model.
                <span className="block text-[#ec9552]">
                  Start managing a crew.
                </span>
              </h2>
            </div>
            <div className="mt-14 grid overflow-hidden rounded-[3px] border border-white/10 lg:grid-cols-2">
              <article className="bg-[#0d0d0c] p-7 sm:p-10">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#716b63]">
                  The old way / disposable chat
                </p>
                <div className="mt-10 space-y-6 text-[#8d877e]">
                  <p className="flex gap-4">
                    <span className="font-mono text-[#5d5852]">01</span> Rebuild
                    context for every task
                  </p>
                  <p className="flex gap-4">
                    <span className="font-mono text-[#5d5852]">02</span> Grant
                    broad access with no role contract
                  </p>
                  <p className="flex gap-4">
                    <span className="font-mono text-[#5d5852]">03</span> Lose
                    evidence when the chat closes
                  </p>
                  <p className="flex gap-4">
                    <span className="font-mono text-[#5d5852]">04</span> Judge
                    quality from memory
                  </p>
                </div>
              </article>
              <article className="relative overflow-hidden bg-[#15110e] p-7 sm:p-10">
                <div className="absolute inset-y-0 left-0 w-px bg-[#ec9552]" />
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f5b784]">
                  The CrewClaw way / durable employee
                </p>
                <div className="mt-10 space-y-6 text-[#e0dad1]">
                  <p className="flex gap-4">
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#ec9552]" />{" "}
                    Hire a versioned role and identity
                  </p>
                  <p className="flex gap-4">
                    <Fingerprint className="mt-0.5 size-4 shrink-0 text-[#ec9552]" />{" "}
                    Freeze task-scoped capabilities
                  </p>
                  <p className="flex gap-4">
                    <DatabaseZap className="mt-0.5 size-4 shrink-0 text-[#ec9552]" />{" "}
                    Persist receipts, artifacts and memory
                  </p>
                  <p className="flex gap-4">
                    <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-[#ec9552]" />{" "}
                    Evaluate accepted work with real KPIs
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#0d0d0c] px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto max-w-[1180px]">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <p className="landing-kicker">02 / The complete loop</p>
                <h2 className="landing-display mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                  From profile to performance.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-[#8d877e]">
                The website is discovery. Your workspace remains the source of
                truth.
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[3px] border border-white/10 bg-white/10 md:grid-cols-4">
              {[
                [
                  "01",
                  "Discover",
                  "Inspect role, examples and runtime requirements.",
                ],
                [
                  "02",
                  "Hire",
                  "Freeze the employee package and capability plan.",
                ],
                ["03", "Run", "Stream real work with approvals and artifacts."],
                [
                  "04",
                  "Evaluate",
                  "Persist acceptance, cost, safety and memory.",
                ],
              ].map(([number, title, body]) => (
                <article
                  className="group bg-[#0d0d0c] p-7 transition-colors hover:bg-[#13110f]"
                  key={number}
                >
                  <p className="font-mono text-xs text-[#ec9552]">{number}</p>
                  <h3 className="landing-display mt-12 text-2xl font-semibold">
                    {title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[#8d877e]">
                    {body}
                  </p>
                  <ChevronMark />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="moat" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto max-w-[1180px]">
            <p className="landing-kicker">
              03 / Built for accountable autonomy
            </p>
            <h2 className="landing-display mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
              The moat is not a better prompt.
              <span className="block text-[#8d877e]">
                It is the operating contract.
              </span>
            </h2>
            <div className="mt-14 grid gap-4 lg:grid-cols-6">
              <article className="landing-card lg:col-span-4">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p className="landing-card-label">
                      Identity that survives a session
                    </p>
                    <h3 className="landing-display mt-4 max-w-xl text-3xl font-semibold sm:text-4xl">
                      A role is a versioned package, not a system prompt pasted
                      into chat.
                    </h3>
                  </div>
                  <Bot className="size-8 shrink-0 text-[#ec9552]" />
                </div>
                <div className="mt-10 grid gap-3 font-mono text-[11px] text-[#8d877e] sm:grid-cols-3">
                  <span className="landing-chip">SOUL.md</span>
                  <span className="landing-chip">employee.yaml</span>
                  <span className="landing-chip">skills/*</span>
                </div>
              </article>
              <article className="landing-card lg:col-span-2">
                <ShieldCheck className="size-7 text-[#79c98d]" />
                <p className="landing-card-label mt-10">
                  Fail-closed permissions
                </p>
                <h3 className="landing-display mt-4 text-2xl font-semibold">
                  Every tool call meets a capability gate.
                </h3>
              </article>
              <article className="landing-card lg:col-span-2">
                <GitBranch className="size-7 text-[#ec9552]" />
                <p className="landing-card-label mt-10">Evidence trail</p>
                <h3 className="landing-display mt-4 text-2xl font-semibold">
                  Tasks, artifacts and verdicts share one run ID.
                </h3>
              </article>
              <article className="landing-card lg:col-span-2">
                <CircleDollarSign className="size-7 text-[#ec9552]" />
                <p className="landing-card-label mt-10">Measured economics</p>
                <h3 className="landing-display mt-4 text-2xl font-semibold">
                  Cost and acceptance come from receipts, not claims.
                </h3>
              </article>
              <article className="landing-card lg:col-span-2">
                <Blocks className="size-7 text-[#ec9552]" />
                <p className="landing-card-label mt-10">Gated learning</p>
                <h3 className="landing-display mt-4 text-2xl font-semibold">
                  Dream proposes improvements. Humans activate them.
                </h3>
              </article>
            </div>
          </div>
        </section>

        <section
          id="runtime"
          className="border-y border-white/10 bg-[#0d0d0c] px-5 py-24 sm:px-6 md:py-32"
        >
          <div className="mx-auto grid max-w-[1180px] gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div className="lg:sticky lg:top-28">
              <p className="landing-kicker">04 / Runtime L0-L4</p>
              <h2 className="landing-display mt-5 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                Five layers.
                <span className="block text-[#ec9552]">One employee.</span>
              </h2>
              <p className="mt-6 max-w-md text-sm leading-7 text-[#8d877e]">
                Each level adds capability without discarding the contract
                beneath it. A package can state exactly how far it is
                compatible.
              </p>
              <Link
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#ec9552]"
                to="/marketplace"
              >
                Inspect employee compatibility <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="space-y-3">
              {runtimeLevels.map(([level, title, description], index) => (
                <article
                  className="group grid grid-cols-[64px_1fr_auto] items-center gap-4 rounded-[3px] border border-white/10 bg-[#10100f] p-5 transition-colors hover:border-[#ec9552]/35"
                  key={level}
                >
                  <span className="landing-display text-2xl font-semibold text-[#ec9552]">
                    {level}
                  </span>
                  <div>
                    <h3 className="landing-display text-xl font-semibold">
                      {title}
                    </h3>
                    <p className="mt-1 text-sm text-[#8d877e]">{description}</p>
                  </div>
                  <div
                    className="hidden items-center gap-1 sm:flex"
                    aria-label={`${index + 1} of 5 runtime layers`}
                  >
                    {runtimeLevels.map((_, dot) => (
                      <span
                        className={`h-1 w-4 ${dot <= index ? "bg-[#ec9552]" : "bg-white/10"}`}
                        key={dot}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-cta relative overflow-hidden px-5 py-24 sm:px-6 md:py-32">
          <div className="relative mx-auto max-w-[920px] text-center">
            <Cpu className="mx-auto size-9 text-[#15100c]" />
            <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-[#513522]">
              Your first crew member is one command away
            </p>
            <h2 className="landing-display mt-5 text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-[#15100c] sm:text-7xl">
              Give AI a job,
              <span className="block">not just a question.</span>
            </h2>
            <div className="mx-auto mt-9 flex max-w-2xl flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-[#15100c] px-6 py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
                to="/marketplace"
              >
                Hire from the marketplace <ArrowRight className="size-4" />
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-[3px] border border-[#15100c]/25 px-6 py-3.5 font-mono text-xs font-semibold text-[#15100c] transition-colors hover:bg-[#15100c]/[0.06]"
                to="/performance"
              >
                View real performance
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#0a0a09] px-5 py-8 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 font-mono text-[10px] uppercase tracking-[0.15em] text-[#716b63] sm:flex-row sm:items-center sm:justify-between">
          <p>CREWCLAW / AI EMPLOYEE OPERATING SYSTEM</p>
          <div className="flex gap-5">
            <Link className="hover:text-[#ec9552]" to="/marketplace">
              Marketplace
            </Link>
            <Link className="hover:text-[#ec9552]" to="/creator">
              Publish
            </Link>
            <Link className="hover:text-[#ec9552]" to="/metrics">
              Metrics
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ChevronMark() {
  return (
    <span className="mt-10 inline-flex size-8 items-center justify-center rounded-full border border-white/10 text-[#716b63] transition-colors group-hover:border-[#ec9552]/40 group-hover:text-[#ec9552]">
      <ArrowRight className="size-3.5" />
    </span>
  );
}
