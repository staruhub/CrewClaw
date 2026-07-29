import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Cpu,
  FileSearch,
  GitBranch,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AsciiCanvas } from "@/components/AsciiCanvas";
import {
  employeeEvidenceBadge,
  employees,
  type Employee,
} from "@/data/employees";

const liveSession = [
  ["$ crew hire ai-adoption-whale --live --yes", "cmd"],
  ["-> contract signed · OpenWork runtime selected · budget capped", "muted"],
  ["$ crewclaw doctor --runtime openwork", "cmd"],
  [
    "✓ 8/8 checks · tools, manifest, memory, browser, budget, permissions",
    "ok",
  ],
  ['$ crewclaw task "compare LLM pricing, verified sources only"', "cmd"],
  ["-> plan(5) · search(12 sources) · evidence cards opened", "muted"],
  ["! approval needed: browser.render + network allowlist", "warn"],
  ["▤ report.md · 8 citations · confidence 0.91 · cost preview $0.72", "muted"],
  ["⏸ human approval gate · approved by you", "warn"],
  ["★ delivered · KPI updated · dream review queued", "ok"],
] as const;

const landingCommand = "crew hire ai-adoption-whale --live --yes";

const stats = [
  ["05", "published employees"],
  ["8/8", "doctor gate before work"],
  ["100%", "deliveries need approval"],
  ["L4", "OpenWork native target"],
] as const;

const comparison = [
  [
    "Install an agent",
    "No role contract",
    "Broad runtime access",
    "Chat-log memory",
    "Quality judged by feel",
  ],
  [
    "Hire an employee",
    "Signed manifest and trial",
    "Scoped permission boundary",
    "Evidence and artifacts persist",
    "KPIs update after approval",
  ],
] as const;

const boundary = [
  {
    name: "CrewClaw",
    label: "市场与员工生命周期",
    body: "Discovers, certifies, hires, evaluates, and improves AI employees. It owns manifests, permissions, doctor checks, trials, evidence, approvals, KPI history, and retirement decisions.",
    rows: [
      "Marketplace",
      "Certification",
      "Hire contract",
      "KPI / Dream review",
    ],
  },
  {
    name: "OpenWork",
    label: "员工真正工作的办公室",
    body: "Provides the workspace where employees run: tools, browser, files, long tasks, collaboration, runtime adapters, and the operating surface for active work.",
    rows: ["Runtime", "Tools", "Browser / files", "Long-running execution"],
  },
] as const;

const lifecycle = [
  ["Discover", "Compare registry-backed resumes and evidence state."],
  [
    "Hire",
    "Freeze role, budget, runtime, permissions, and expected deliverables.",
  ],
  [
    "Doctor 8/8",
    "Verify capability, policy, memory, tools, budget, and runtime readiness.",
  ],
  ["Trial", "Run one bounded task before active status."],
  ["Work", "Stream task events, tool use, evidence, artifacts, and cost."],
  ["Approve", "Human approval releases delivery and updates KPIs."],
  [
    "Improve",
    "Dream proposes playbook changes for review, not hidden mutation.",
  ],
] as const;

const trustRows = [
  [
    "Certification",
    "Registry package and lab credential status are shown separately.",
  ],
  [
    "Permissions",
    "Required, optional, disabled, and human-confirmed actions stay visible.",
  ],
  [
    "Budgets",
    "Cost is capped before work and attached to the delivery receipt.",
  ],
  ["Evidence", "Artifacts cannot be approved without inspectable evidence."],
  [
    "Auditability",
    "Every task event keeps actor, time, status, cost, and decision context.",
  ],
] as const;

const mascotArt: Record<string, string> = {
  whale: [
    "     .  o",
    '   ___:____     |"\\/"|',
    " ,'        `.    \\  /",
    " |  o        \\___/  |",
    " \\_________________/",
  ].join("\n"),
  shrimp: [
    "   __      __",
    " _/  \\____/  \\_",
    " \\_  review  _/",
    "   \\__/\\__/\\_/",
  ].join("\n"),
  crab: [
    " .-===========-.",
    " |  [+]   [+]  |",
    " |     ---     |",
    " '-.,_______,.-'",
  ].join("\n"),
  mermaid: ["    /\\_/\\", "  >( o.o )<", "    /|||\\", "   /_|||_\\"].join(
    "\n"
  ),
};

function previewEmployees() {
  return employees.slice(0, 3);
}

function runtimeLevel(employee: Employee) {
  if (
    employee.tool_capabilities.some(
      tool => tool.availability === "runtime_implementation"
    )
  ) {
    return "OpenWork L4";
  }
  if (employee.tools.length > 0) return "OpenWork L3";
  return "OpenWork L2";
}

function approvalSummary(employee: Employee) {
  const approvals = employee.tool_capabilities.filter(tool => tool.approval);
  if (approvals.some(tool => tool.approval === "always"))
    return "approval required";
  if (approvals.length > 0) return "approval when needed";
  return "read/write scoped";
}

export default function Home() {
  const featured = previewEmployees();

  return (
    <div className="landing-v4 min-h-screen overflow-hidden bg-[#08070a] text-[#f2eee7]">
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-4 rounded-full border border-[#ec9552]/15 bg-[#0d0b0c]/90 px-4 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:px-5"
        >
          <Link className="flex min-w-0 items-center gap-3" to="/">
            <span className="grid size-8 shrink-0 place-items-center rounded-[2px] border border-[#ec9552]/45 bg-[#ec9552]/10 font-mono text-xs font-black text-[#ec9552]">
              ▚
            </span>
            <span className="landing-display truncate text-sm font-semibold">
              CrewClaw
            </span>
            <span className="hidden border-l border-white/10 pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8d877e] md:block">
              AI employee OS
            </span>
          </Link>
          <div className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[#aaa39a] lg:flex">
            <a href="#paradigm">Why</a>
            <a href="#moat">Boundary</a>
            <a href="#market">Market</a>
            <a href="#trust">Trust</a>
          </div>
          <Link
            className="inline-flex items-center gap-2 rounded-full bg-[#ec9552] px-4 py-2 text-xs font-bold text-[#15100c] transition-transform hover:-translate-y-0.5"
            to="/marketplace"
          >
            Hire an employee
            <ArrowRight className="size-3.5" />
          </Link>
        </nav>
      </header>

      <main>
        <section className="landing-grid relative border-b border-white/10 px-5 pb-20 pt-32 sm:px-6 md:pb-28 md:pt-40">
          <AsciiCanvas className="opacity-80" />
          <div className="relative mx-auto flex max-w-[1180px] flex-col items-center gap-14 text-center">
            <div className="relative z-10 flex flex-col items-center">
              <div className="landing-reveal inline-flex items-center gap-2 rounded-full border border-[#ec9552]/25 bg-[#ec9552]/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#f5b784]">
                <Sparkles className="size-3" />
                The AI employee talent market
              </div>
              <h1 className="landing-display landing-reveal landing-reveal-1 mt-7 max-w-[760px] text-[clamp(3.4rem,7vw,7rem)] font-semibold leading-[0.9] tracking-[-0.04em]">
                Hire AI like you hire people.
              </h1>
              <p className="landing-reveal landing-reveal-2 mt-8 max-w-xl text-base leading-7 text-[#b5aca1] sm:text-lg sm:leading-8">
                CrewClaw turns agents into accountable digital employees: signed
                manifests, scoped permissions, doctor checks, trial work,
                evidence, human approval, and measurable performance.
              </p>
              <p className="landing-reveal landing-reveal-2 mt-4 max-w-xl text-sm leading-7 text-[#ec9552]">
                不是安装一个
                Agent，而是雇佣一位可审计、可评估、可成长的数字员工。
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
                  href="#session"
                >
                  Watch the workflow
                </a>
              </div>
            </div>

            <div
              id="session"
              className="landing-reveal landing-reveal-2 relative z-10 w-full max-w-[920px]"
            >
              <LiveSessionPanel />
            </div>
          </div>
        </section>

        <section
          aria-label="CrewClaw facts"
          className="border-b border-white/10 bg-[#0d0b0c] px-5 sm:px-6"
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
          <div className="mx-auto max-w-[1180px] text-center">
            <p className="landing-kicker">01 / Why CrewClaw</p>
            <h2 className="landing-display mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              Installing agents is over.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-[#9d948b]">
              A prompt in a chat window is not a coworker. A CrewClaw employee
              has a contract, onboarding evidence, a permission boundary, and a
              performance record.
            </p>
            <div className="mt-14 grid overflow-hidden rounded-[3px] border border-white/10 text-left lg:grid-cols-2">
              {comparison.map(([title, ...items], groupIndex) => (
                <article
                  className={
                    groupIndex === 0
                      ? "bg-[#0d0b0c] p-7 sm:p-10"
                      : "relative bg-[#15110e] p-7 sm:p-10"
                  }
                  key={title}
                >
                  {groupIndex === 1 ? (
                    <div className="absolute inset-y-0 left-0 w-px bg-[#ec9552]" />
                  ) : null}
                  <p
                    className={
                      groupIndex === 0
                        ? "landing-card-label text-[#e5564a]"
                        : "landing-card-label"
                    }
                  >
                    {title}
                  </p>
                  <div className="mt-10 space-y-5">
                    {items.map(item => (
                      <p className="flex gap-4 text-[#d9d2c8]" key={item}>
                        {groupIndex === 0 ? (
                          <span className="font-mono text-[#e5564a]">x</span>
                        ) : (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#79c98d]" />
                        )}
                        {item}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="moat"
          className="border-y border-white/10 bg-[#0d0b0c] px-5 py-24 sm:px-6 md:py-32"
        >
          <div className="mx-auto max-w-[1180px]">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <p className="landing-kicker">02 / Platform boundary</p>
                <h2 className="landing-display mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
                  CrewClaw hires. OpenWork is the office.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-[#8d877e]">
                Clear boundaries keep the product from becoming a generic chat
                workbench.
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[3px] border border-white/10 bg-white/10 lg:grid-cols-2">
              {boundary.map(item => (
                <article className="bg-[#0d0b0c] p-7 sm:p-10" key={item.name}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ec9552]">
                    {item.label}
                  </p>
                  <h3 className="landing-display mt-5 text-3xl font-semibold">
                    {item.name}
                  </h3>
                  <p className="mt-5 text-sm leading-7 text-[#9d948b]">
                    {item.body}
                  </p>
                  <div className="mt-8 grid gap-2 font-mono text-[11px] text-[#b5aca1] sm:grid-cols-2">
                    {item.rows.map(row => (
                      <span className="landing-chip" key={row}>
                        {row}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="market" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto max-w-[1180px]">
            <p className="landing-kicker">03 / Marketplace preview</p>
            <h2 className="landing-display mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              Browse employees like candidates.
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#9d948b]">
              This preview reads from the existing generated employee registry.
              Missing field history is shown as pending instead of being
              invented.
            </p>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {featured.map(employee => (
                <EmployeePreviewCard
                  employee={employee}
                  key={employee.employee_id}
                />
              ))}
            </div>
            <div className="mt-8 overflow-x-auto rounded-[3px] border border-white/10 bg-[#0d0b0c] font-mono text-[11px]">
              <div className="landing-market-table">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-[#716b63]">
                  <span>employee</span>
                  <span>certification</span>
                  <span>completed</span>
                  <span>acceptance</span>
                  <span>avg cost</span>
                </div>
                {featured.map(employee => (
                  <Link
                    className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-white/5 px-4 py-3 text-[#b5aca1] transition-colors hover:bg-[#13110f]"
                    key={employee.employee_id}
                    to={`/employee/${employee.employee_id}`}
                  >
                    <span className="text-[#ec9552]">{employee.name}</span>
                    <span>{employee.certification}</span>
                    <span>
                      {employee.evidence_state.field_status === "proven"
                        ? "see KPI"
                        : "trial pending"}
                    </span>
                    <span>
                      {employee.evidence_state.field_status === "proven"
                        ? "see KPI"
                        : "field pending"}
                    </span>
                    <span>{employee.pricing}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id="runtime"
          className="border-y border-white/10 bg-[#0d0b0c] px-5 py-24 sm:px-6 md:py-32"
        >
          <div className="mx-auto max-w-[1180px]">
            <p className="landing-kicker">04 / Lifecycle</p>
            <h2 className="landing-display mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              Discovery to evaluation is one loop.
            </h2>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[3px] border border-white/10 bg-white/10 md:grid-cols-7">
              {lifecycle.map(([title, body], index) => (
                <article className="bg-[#0d0b0c] p-5" key={title}>
                  <p className="font-mono text-xs text-[#ec9552]">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="landing-display mt-8 text-2xl font-semibold">
                    {title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[#8d877e]">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto grid max-w-[1180px] gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="landing-kicker">05 / Trust before conversion</p>
              <h2 className="landing-display mt-5 text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
                Nothing ships without evidence.
              </h2>
              <p className="mt-6 text-sm leading-7 text-[#9d948b]">
                CrewClaw asks visitors to hire only after it explains exactly
                how certification, permission review, budgets, evidence, and
                human approval work.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-[#ec9552] px-6 py-3.5 text-sm font-bold text-[#15100c]"
                  to="/marketplace"
                >
                  Explore market
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-[3px] border border-white/15 px-6 py-3.5 font-mono text-xs text-[#d5cfc6]"
                  to="/performance"
                >
                  Compare performance
                </Link>
              </div>
            </div>
            <div className="grid gap-3">
              {trustRows.map(([title, body]) => (
                <article
                  className="grid grid-cols-[44px_1fr] gap-4 rounded-[3px] border border-white/10 bg-[#0d0b0c] p-5"
                  key={title}
                >
                  <span className="grid size-11 place-items-center rounded-[2px] border border-[#ec9552]/25 text-[#ec9552]">
                    <TrustIcon title={title} />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-[#f2eee7]">
                      {title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#8d877e]">
                      {body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#08070a] px-5 py-8 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 font-mono text-[10px] uppercase tracking-[0.15em] text-[#716b63] sm:flex-row sm:items-center sm:justify-between">
          <p>CREWCLAW / AI EMPLOYEE OPERATING SYSTEM</p>
          <div className="flex gap-5">
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/team">My crew</Link>
            <Link to="/metrics">Metrics</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LiveSessionPanel() {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(landingCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="landing-terminal relative overflow-hidden rounded-[3px] border border-[#ec9552]/30 bg-[#0d0b0c] shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.025] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#716b63]">
        <span className="size-2.5 rounded-full bg-[#e5564a]" />
        <span className="size-2.5 rounded-full bg-[#e5a93d]" />
        <span className="size-2.5 rounded-full bg-[#5db354]" />
        <span className="ml-2">CrewClaw live session</span>
        <span className="ml-auto text-[#5db354]">● live</span>
      </div>
      <div className="landing-terminal-body p-5 font-mono text-[12px] leading-7 sm:p-6 sm:text-[13px]">
        {liveSession.map(([line, tone], index) => (
          <div
            className={`landing-terminal-line landing-terminal-line-${index} terminal-${tone}`}
            key={line}
          >
            {line}
          </div>
        ))}
        <span className="landing-cursor">▊</span>
      </div>
      <div className="relative flex flex-col gap-3 border-t border-white/10 bg-black/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <code className="font-mono text-xs text-[#f2eee7]">
          {landingCommand}
        </code>
        <button
          type="button"
          aria-label="Copy CrewClaw command"
          className="inline-flex items-center justify-center rounded-[3px] border border-[#ec9552]/30 bg-[#ec9552]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ec9552] transition-colors hover:bg-[#ec9552]/15"
          onClick={copyCommand}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function EmployeePreviewCard({ employee }: { employee: Employee }) {
  const art = mascotArt[employee.mascot ?? ""] ?? mascotArt.crab;

  return (
    <article className="landing-card min-h-0">
      <pre className="mb-5 overflow-hidden text-[10px] leading-[1.25] text-[#83a598]">
        {art}
      </pre>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[#f2eee7]">
            {employee.name}
          </h3>
          <p className="mt-1 text-sm text-[#ec9552]">{employee.role}</p>
        </div>
        <span className="rounded-[2px] border border-[#ec9552]/25 px-2 py-1 font-mono text-[10px] text-[#ec9552]">
          {employee.certification}
        </span>
      </div>
      <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#9d948b]">
        {employee.description}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-3 font-mono text-[11px]">
        <Metric label="Evidence" value={employeeEvidenceBadge(employee)} />
        <Metric label="Runtime" value={runtimeLevel(employee)} />
        <Metric label="Permission" value={approvalSummary(employee)} />
        <Metric label="Cost" value={employee.pricing} />
      </dl>
      <Link
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#ec9552]"
        to={`/employee/${employee.employee_id}`}
      >
        Inspect profile
        <ArrowRight className="size-4" />
      </Link>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[2px] border border-white/10 bg-black/15 p-3">
      <dt className="text-[#716b63]">{label}</dt>
      <dd className="mt-1 text-[#d9d2c8]">{value}</dd>
    </div>
  );
}

function TrustIcon({ title }: { title: string }) {
  if (title === "Certification") return <BadgeCheck className="size-5" />;
  if (title === "Permissions") return <LockKeyhole className="size-5" />;
  if (title === "Budgets") return <Cpu className="size-5" />;
  if (title === "Evidence") return <FileSearch className="size-5" />;
  if (title === "Auditability") return <GitBranch className="size-5" />;
  return <ShieldCheck className="size-5" />;
}
