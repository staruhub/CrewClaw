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
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  employeeEvidenceBadge,
  employees,
  type Employee,
} from "@/data/employees";
import { useI18n, useMessages, type MessageValues } from "@/i18n";
import { localizeEmployees } from "@/i18n/employee-content";
import type { Locale } from "@/i18n/locale";
import { homeEn } from "@/i18n/locales/en/home";
import { homeZhCN } from "@/i18n/locales/zh-CN/home";
import { formatPricingLabel } from "@/lib/pricing";

const homeMessages = {
  en: homeEn,
  "zh-CN": homeZhCN satisfies { [K in keyof typeof homeEn]: string },
};

type HomeMessageKey = keyof typeof homeEn;
type HomeT = (key: HomeMessageKey, values?: MessageValues) => string;

const landingCommand = "crew hire ai-adoption-whale --live --yes";

const liveSession = [
  { line: "$ crew hire ai-adoption-whale --live --yes", tone: "cmd" },
  { key: "live.line.contract", tone: "muted" },
  { line: "$ crewclaw doctor --runtime openwork", tone: "cmd" },
  { key: "live.line.doctor", tone: "ok" },
  { key: "live.line.task", tone: "cmd" },
  { key: "live.line.plan", tone: "muted" },
  { key: "live.line.approval", tone: "warn" },
  { key: "live.line.report", tone: "muted" },
  { key: "live.line.gate", tone: "warn" },
  { key: "live.line.delivered", tone: "ok" },
] as const;

const stats = [
  { value: "05", label: "stats.published" },
  { value: "8/8", label: "stats.doctor" },
  { value: "100%", label: "stats.approval" },
  { value: "L4", label: "stats.openwork" },
] as const;

const comparison = [
  [
    "comparison.install.title",
    "comparison.install.contract",
    "comparison.install.access",
    "comparison.install.memory",
    "comparison.install.quality",
  ],
  [
    "comparison.hire.title",
    "comparison.hire.contract",
    "comparison.hire.access",
    "comparison.hire.memory",
    "comparison.hire.quality",
  ],
] as const;

const boundary = [
  {
    name: "CrewClaw",
    label: "boundary.crew.label",
    body: "boundary.crew.body",
    rows: [
      "boundary.crew.row.marketplace",
      "boundary.crew.row.certification",
      "boundary.crew.row.contract",
      "boundary.crew.row.kpi",
    ],
  },
  {
    name: "OpenWork",
    label: "boundary.openwork.label",
    body: "boundary.openwork.body",
    rows: [
      "boundary.openwork.row.runtime",
      "boundary.openwork.row.tools",
      "boundary.openwork.row.browser",
      "boundary.openwork.row.execution",
    ],
  },
] as const;

const lifecycle = [
  ["lifecycle.discover.title", "lifecycle.discover.body"],
  ["lifecycle.hire.title", "lifecycle.hire.body"],
  ["lifecycle.doctor.title", "lifecycle.doctor.body"],
  ["lifecycle.trial.title", "lifecycle.trial.body"],
  ["lifecycle.work.title", "lifecycle.work.body"],
  ["lifecycle.approve.title", "lifecycle.approve.body"],
  ["lifecycle.improve.title", "lifecycle.improve.body"],
] as const;

const trustRows = [
  ["certification", "trust.certification.title", "trust.certification.body"],
  ["permissions", "trust.permissions.title", "trust.permissions.body"],
  ["budgets", "trust.budgets.title", "trust.budgets.body"],
  ["evidence", "trust.evidence.title", "trust.evidence.body"],
  ["auditability", "trust.auditability.title", "trust.auditability.body"],
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

function approvalSummary(employee: Employee, t: HomeT) {
  const approvals = employee.tool_capabilities.filter(tool => tool.approval);
  if (approvals.some(tool => tool.approval === "always"))
    return t("employee.approval.required");
  if (approvals.length > 0) return t("employee.approval.whenNeeded");
  return t("employee.approval.scoped");
}

export default function Home() {
  const { locale } = useI18n();
  const t = useMessages(homeMessages);
  const featured = localizeEmployees(employees.slice(0, 3), locale);

  return (
    <div className="landing-v4 min-h-screen overflow-hidden bg-[#08070a] text-[#f2eee7]">
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
        <nav
          aria-label={t("nav.aria")}
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
              {t("nav.subtitle")}
            </span>
          </Link>
          <div className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[#aaa39a] lg:flex">
            <a href="#paradigm">{t("nav.why")}</a>
            <a href="#moat">{t("nav.boundary")}</a>
            <a href="#market">{t("nav.market")}</a>
            <a href="#trust">{t("nav.trust")}</a>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <Link
              className="inline-flex items-center gap-2 rounded-full bg-[#ec9552] px-4 py-2 text-xs font-bold text-[#15100c] transition-transform hover:-translate-y-0.5"
              to="/marketplace"
            >
              {t("nav.cta")}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="landing-grid relative border-b border-white/10 px-5 pb-20 pt-32 sm:px-6 md:pb-28 md:pt-40">
          <AsciiCanvas className="opacity-80" />
          <div className="relative mx-auto flex max-w-[1180px] flex-col items-center gap-14 text-center">
            <div className="relative z-10 flex flex-col items-center">
              <div className="landing-reveal inline-flex items-center gap-2 rounded-full border border-[#ec9552]/25 bg-[#ec9552]/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#f5b784]">
                <Sparkles className="size-3" />
                {t("hero.kicker")}
              </div>
              <h1 className="landing-display landing-reveal landing-reveal-1 mt-7 max-w-[760px] text-[clamp(3.4rem,7vw,7rem)] font-semibold leading-[0.9] tracking-[-0.04em]">
                {t("hero.title")}
              </h1>
              <p className="landing-reveal landing-reveal-2 mt-8 max-w-xl text-base leading-7 text-[#b5aca1] sm:text-lg sm:leading-8">
                {t("hero.body")}
              </p>
              <p className="landing-reveal landing-reveal-2 mt-4 max-w-xl text-sm leading-7 text-[#ec9552]">
                {t("hero.note")}
              </p>
              <div className="landing-reveal landing-reveal-3 mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-[#ec9552] px-6 py-3.5 text-sm font-bold text-[#15100c] shadow-[0_14px_40px_rgba(236,149,82,0.18)] transition-transform hover:-translate-y-0.5"
                  to="/marketplace"
                >
                  {t("hero.primary")}
                  <ArrowRight className="size-4" />
                </Link>
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] border border-white/15 bg-white/[0.025] px-6 py-3.5 font-mono text-xs text-[#d5cfc6] transition-colors hover:border-[#ec9552]/50 hover:text-[#ec9552]"
                  href="#session"
                >
                  {t("hero.secondary")}
                </a>
              </div>
              <LanguageSwitcher className="mt-5 sm:hidden" />
            </div>

            <div
              id="session"
              className="landing-reveal landing-reveal-2 relative z-10 w-full max-w-[920px]"
            >
              <LiveSessionPanel t={t} />
            </div>
          </div>
        </section>

        <section
          aria-label={t("stats.aria")}
          className="border-b border-white/10 bg-[#0d0b0c] px-5 sm:px-6"
        >
          <div className="mx-auto grid max-w-[1180px] grid-cols-2 divide-x divide-y divide-white/10 border-x border-white/10 md:grid-cols-4 md:divide-y-0">
            {stats.map(({ value, label }) => (
              <div className="px-5 py-7 sm:px-7" key={label}>
                <p className="landing-display text-2xl font-semibold text-[#f2eee7] sm:text-3xl">
                  {value}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.17em] text-[#7e786f] sm:text-[10px]">
                  {t(label)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="paradigm" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto max-w-[1180px] text-center">
            <p className="landing-kicker">{t("section.why.kicker")}</p>
            <h2 className="landing-display mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              {t("section.why.title")}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-[#9d948b]">
              {t("section.why.body")}
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
                    {t(title)}
                  </p>
                  <div className="mt-10 space-y-5">
                    {items.map(item => (
                      <p className="flex gap-4 text-[#d9d2c8]" key={item}>
                        {groupIndex === 0 ? (
                          <span className="font-mono text-[#e5564a]">x</span>
                        ) : (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#79c98d]" />
                        )}
                        {t(item)}
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
                <p className="landing-kicker">{t("section.boundary.kicker")}</p>
                <h2 className="landing-display mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
                  {t("section.boundary.title")}
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-[#8d877e]">
                {t("section.boundary.body")}
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[3px] border border-white/10 bg-white/10 lg:grid-cols-2">
              {boundary.map(item => (
                <article className="bg-[#0d0b0c] p-7 sm:p-10" key={item.name}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ec9552]">
                    {t(item.label)}
                  </p>
                  <h3 className="landing-display mt-5 text-3xl font-semibold">
                    {item.name}
                  </h3>
                  <p className="mt-5 text-sm leading-7 text-[#9d948b]">
                    {t(item.body)}
                  </p>
                  <div className="mt-8 grid gap-2 font-mono text-[11px] text-[#b5aca1] sm:grid-cols-2">
                    {item.rows.map(row => (
                      <span className="landing-chip" key={row}>
                        {t(row)}
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
            <p className="landing-kicker">{t("section.market.kicker")}</p>
            <h2 className="landing-display mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              {t("section.market.title")}
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#9d948b]">
              {t("section.market.body")}
            </p>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {featured.map(employee => (
                <EmployeePreviewCard
                  employee={employee}
                  key={employee.employee_id}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
            <div className="mt-8 overflow-x-auto rounded-[3px] border border-white/10 bg-[#0d0b0c] font-mono text-[11px]">
              <div className="landing-market-table">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-[#716b63]">
                  <span>{t("market.column.employee")}</span>
                  <span>{t("market.column.certification")}</span>
                  <span>{t("market.column.completed")}</span>
                  <span>{t("market.column.acceptance")}</span>
                  <span>{t("market.column.cost")}</span>
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
                        ? t("market.status.seeKpi")
                        : t("market.status.trialPending")}
                    </span>
                    <span>
                      {employee.evidence_state.field_status === "proven"
                        ? t("market.status.seeKpi")
                        : t("market.status.fieldPending")}
                    </span>
                    <span>{formatPricingLabel(employee.pricing, locale)}</span>
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
            <p className="landing-kicker">{t("section.lifecycle.kicker")}</p>
            <h2 className="landing-display mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              {t("section.lifecycle.title")}
            </h2>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[3px] border border-white/10 bg-white/10 md:grid-cols-7">
              {lifecycle.map(([title, body], index) => (
                <article className="bg-[#0d0b0c] p-5" key={title}>
                  <p className="font-mono text-xs text-[#ec9552]">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="landing-display mt-8 text-2xl font-semibold">
                    {t(title)}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[#8d877e]">
                    {t(body)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="px-5 py-24 sm:px-6 md:py-32">
          <div className="mx-auto grid max-w-[1180px] gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="landing-kicker">{t("section.trust.kicker")}</p>
              <h2 className="landing-display mt-5 text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
                {t("section.trust.title")}
              </h2>
              <p className="mt-6 text-sm leading-7 text-[#9d948b]">
                {t("section.trust.body")}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-[3px] bg-[#ec9552] px-6 py-3.5 text-sm font-bold text-[#15100c]"
                  to="/marketplace"
                >
                  {t("section.trust.primary")}
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-[3px] border border-white/15 px-6 py-3.5 font-mono text-xs text-[#d5cfc6]"
                  to="/performance"
                >
                  {t("section.trust.secondary")}
                </Link>
              </div>
            </div>
            <div className="grid gap-3">
              {trustRows.map(([icon, title, body]) => (
                <article
                  className="grid grid-cols-[44px_1fr] gap-4 rounded-[3px] border border-white/10 bg-[#0d0b0c] p-5"
                  key={icon}
                >
                  <span className="grid size-11 place-items-center rounded-[2px] border border-[#ec9552]/25 text-[#ec9552]">
                    <TrustIcon icon={icon} />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-[#f2eee7]">
                      {t(title)}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#8d877e]">
                      {t(body)}
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
          <p>{t("footer.brand")}</p>
          <div className="flex gap-5">
            <Link to="/marketplace">{t("footer.marketplace")}</Link>
            <Link to="/team">{t("footer.team")}</Link>
            <Link to="/metrics">{t("footer.metrics")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LiveSessionPanel({ t }: { t: HomeT }) {
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
        <span className="ml-2">{t("live.title")}</span>
        <span className="ml-auto text-[#5db354]">● {t("live.status")}</span>
      </div>
      <div className="landing-terminal-body p-5 font-mono text-[12px] leading-7 sm:p-6 sm:text-[13px]">
        {liveSession.map((entry, index) => {
          const line = "line" in entry ? entry.line : t(entry.key);

          return (
            <div
              className={`landing-terminal-line landing-terminal-line-${index} terminal-${entry.tone}`}
              key={`${entry.tone}-${line}`}
            >
              {line}
            </div>
          );
        })}
        <span className="landing-cursor">▊</span>
      </div>
      <div className="relative flex flex-col gap-3 border-t border-white/10 bg-black/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <code className="font-mono text-xs text-[#f2eee7]">
          {landingCommand}
        </code>
        <button
          type="button"
          aria-label={t("live.copyAria")}
          className="inline-flex items-center justify-center rounded-[3px] border border-[#ec9552]/30 bg-[#ec9552]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ec9552] transition-colors hover:bg-[#ec9552]/15"
          onClick={copyCommand}
        >
          {copied ? t("live.copied") : t("live.copy")}
        </button>
      </div>
    </div>
  );
}

function EmployeePreviewCard({
  employee,
  locale,
  t,
}: {
  employee: Employee;
  locale: Locale;
  t: HomeT;
}) {
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
        <Metric
          label={t("employee.evidence")}
          value={employeeEvidenceBadge(employee)}
        />
        <Metric label={t("employee.runtime")} value={runtimeLevel(employee)} />
        <Metric
          label={t("employee.permission")}
          value={approvalSummary(employee, t)}
        />
        <Metric
          label={t("employee.cost")}
          value={formatPricingLabel(employee.pricing, locale)}
        />
      </dl>
      <Link
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#ec9552]"
        to={`/employee/${employee.employee_id}`}
      >
        {t("employee.inspect")}
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

function TrustIcon({ icon }: { icon: (typeof trustRows)[number][0] }) {
  if (icon === "certification") return <BadgeCheck className="size-5" />;
  if (icon === "permissions") return <LockKeyhole className="size-5" />;
  if (icon === "budgets") return <Cpu className="size-5" />;
  if (icon === "evidence") return <FileSearch className="size-5" />;
  if (icon === "auditability") return <GitBranch className="size-5" />;
  return <ShieldCheck className="size-5" />;
}
