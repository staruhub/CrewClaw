import { Link } from "react-router";
import {
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  Shield,
  Terminal,
  Users,
} from "lucide-react";
import { useMessages } from "@/i18n";
import { manualMessages } from "@/i18n/locales/manual";

const codeBlocks = {
  clone: "git clone https://github.com/staruhub/CrewClaw.git\ncd CrewClaw",
  install: "corepack enable\npnpm install --frozen-lockfile",
  verify: "pnpm run crewclaw -- list\npnpm run check",
  build: "pnpm run build",
  dev: "pnpm run dev",
  list: "pnpm run crewclaw -- list",
  hire: "pnpm run crewclaw -- hire code-review-shrimp --yes",
  trial: "pnpm run crewclaw -- hire product-prd-crab --run-first",
  doctor: "pnpm run crewclaw -- doctor",
};

export default function Manual() {
  const t = useMessages(manualMessages);

  return (
    <div className="min-h-screen bg-crew-bg text-crew-body">
      <header className="border-b border-white/10 bg-crew-card/50 px-5 py-4 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Link
            className="inline-flex items-center gap-2 text-sm text-crew-copper transition-colors hover:text-crew-copper/80"
            to="/"
          >
            ← {t("nav.backHome")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
        <div className="mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-crew-copper/20 bg-crew-copper/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-crew-copper">
            <BookOpen className="size-3.5" />
            Beta 0.8
          </div>
          <h1 className="mb-4 text-4xl font-light tracking-tight text-crew-heading sm:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="text-lg leading-relaxed text-crew-body">
            {t("hero.subtitle")}
          </p>
        </div>

        <Section
          icon={<BookOpen className="size-5" />}
          title={t("section.what.title")}
        >
          <p className="mb-4 leading-7">{t("section.what.description")}</p>
          <p className="mb-2 font-semibold text-crew-heading">
            {t("section.what.not")}
          </p>
          <ul className="space-y-2">
            <li className="flex gap-3">
              <span className="text-crew-copper">×</span>
              <span>{t("section.what.not.chat")}</span>
            </li>
            <li className="flex gap-3">
              <span className="text-crew-copper">×</span>
              <span>{t("section.what.not.replacement")}</span>
            </li>
            <li className="flex gap-3">
              <span className="text-crew-copper">×</span>
              <span>{t("section.what.not.hosted")}</span>
            </li>
            <li className="flex gap-3">
              <span className="text-crew-copper">×</span>
              <span>{t("section.what.not.paid")}</span>
            </li>
          </ul>
        </Section>

        <Section
          icon={<CheckCircle2 className="size-5" />}
          title={t("section.requirements.title")}
        >
          <ul className="space-y-2">
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.git")}</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.nodejs")}</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.pnpm")}</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.rust")}</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.chromium")}</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crew-copper" />
              <span>{t("section.requirements.hermes")}</span>
            </li>
          </ul>
          <p className="mt-4 text-sm leading-6 text-crew-muted">
            {t("section.requirements.note")}
          </p>
        </Section>

        <Section
          icon={<Download className="size-5" />}
          title={t("section.install.title")}
        >
          <div className="space-y-4">
            <StepWithCode
              label={t("section.install.clone")}
              code={codeBlocks.clone}
            />
            <StepWithCode
              label={t("section.install.setup")}
              code={codeBlocks.install}
            />
            <StepWithCode
              label={t("section.install.verify")}
              code={codeBlocks.verify}
            />
            <StepWithCode
              label={t("section.install.build")}
              code={codeBlocks.build}
            />
            <StepWithCode
              label={t("section.install.start")}
              code={codeBlocks.dev}
            />
            <p className="pt-2 text-sm leading-6 text-crew-muted">
              {t("section.install.open")}
            </p>
          </div>
        </Section>

        <Section
          icon={<Users className="size-5" />}
          title={t("section.hire.title")}
        >
          <p className="mb-4 leading-7">{t("section.hire.intro")}</p>
          <div className="space-y-4">
            <StepWithCode
              label={t("section.hire.list")}
              code={codeBlocks.list}
            />
            <p className="text-sm leading-6 text-crew-muted">
              {t("section.hire.interactive")}
            </p>
            <StepWithCode
              label={t("section.hire.direct")}
              code={codeBlocks.hire}
            />
            <StepWithCode
              label={t("section.hire.trial")}
              code={codeBlocks.trial}
            />
            <StepWithCode
              label={t("section.hire.check")}
              code={codeBlocks.doctor}
            />
          </div>
        </Section>

        <Section
          icon={<GitBranch className="size-5" />}
          title={t("section.lifecycle.title")}
        >
          <p className="mb-6 leading-7">{t("section.lifecycle.intro")}</p>
          <div className="space-y-6">
            <LifecycleStep
              title={t("section.lifecycle.discover.title")}
              body={t("section.lifecycle.discover.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.review.title")}
              body={t("section.lifecycle.review.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.doctor.title")}
              body={t("section.lifecycle.doctor.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.trial.title")}
              body={t("section.lifecycle.trial.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.supervise.title")}
              body={t("section.lifecycle.supervise.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.approve.title")}
              body={t("section.lifecycle.approve.body")}
            />
            <LifecycleStep
              title={t("section.lifecycle.improve.title")}
              body={t("section.lifecycle.improve.body")}
            />
          </div>
        </Section>

        <Section
          icon={<Terminal className="size-5" />}
          title={t("section.beta.title")}
        >
          <p className="mb-4 leading-7">{t("section.beta.intro")}</p>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="mt-1 text-crew-copper">•</span>
              <span className="leading-7">{t("section.beta.validation")}</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 text-crew-copper">•</span>
              <span className="leading-7">{t("section.beta.openwork")}</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 text-crew-copper">•</span>
              <span className="leading-7">
                {t("section.beta.openwork.scope")}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 text-crew-copper">•</span>
              <span className="leading-7">
                {t("section.beta.stateChanges")}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 text-crew-copper">•</span>
              <span className="leading-7">{t("section.beta.modelUsage")}</span>
            </li>
          </ul>
        </Section>

        <Section
          icon={<Shield className="size-5" />}
          title={t("section.support.title")}
        >
          <p className="mb-4 leading-7">{t("section.support.intro")}</p>

          <div className="mb-6">
            <p className="mb-2 font-semibold text-crew-heading">
              {t("section.support.bugs")}
            </p>
            <a
              className="mb-3 inline-flex items-center gap-2 text-crew-copper hover:underline"
              href="https://github.com/staruhub/CrewClaw/issues"
              rel="noreferrer"
              target="_blank"
            >
              {t("section.support.github")}
              <ExternalLink className="size-3.5" />
            </a>
            <p className="mb-2 text-sm text-crew-muted">
              {t("section.support.before")}
            </p>
            <ul className="space-y-1 text-sm text-crew-muted">
              <li className="flex gap-2">
                <span>•</span>
                <span>{t("section.support.search")}</span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>{t("section.support.doctor")}</span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>{t("section.support.info")}</span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>{t("section.support.sanitize")}</span>
              </li>
            </ul>
          </div>

          <div>
            <p className="mb-2 font-semibold text-crew-heading">
              {t("section.support.security")}
            </p>
            <p className="text-sm leading-6 text-crew-muted">
              {t("section.support.securityNote")}
            </p>
          </div>
        </Section>

        <Section
          icon={<BookOpen className="size-5" />}
          title={t("section.resources.title")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ResourceLink
              href="https://github.com/staruhub/CrewClaw#readme"
              label={t("section.resources.readme")}
            />
            <ResourceLink
              href="https://github.com/staruhub/CrewClaw/blob/main/docs/releases/beta-0.8.md"
              label={t("section.resources.releases")}
            />
            <ResourceLink
              href="https://github.com/staruhub/CrewClaw/blob/main/SUPPORT.md"
              label={t("section.resources.support")}
            />
            <ResourceLink
              href="https://github.com/staruhub/CrewClaw/blob/main/SECURITY.md"
              label={t("section.resources.security")}
            />
            <ResourceLink
              href="https://github.com/staruhub/CrewClaw/blob/main/CONTRIBUTING.md"
              label={t("section.resources.contributing")}
            />
            <ResourceLink
              href="https://crewhire.fly.dev/crewclaw-demo.zh-CN.mp4"
              label={t("section.resources.demo")}
            />
          </div>
        </Section>
      </main>

      <footer className="border-t border-white/10 bg-crew-card/50 px-5 py-6 sm:px-6">
        <div className="mx-auto max-w-4xl text-center text-sm text-crew-muted">
          <Link className="text-crew-copper hover:underline" to="/">
            ← {t("footer.backHome")}
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mb-12 scroll-mt-8"
      id={title.toLowerCase().replace(/\s+/g, "-")}
    >
      <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3">
        <span className="text-crew-copper">{icon}</span>
        <h2 className="text-2xl font-light text-crew-heading">{title}</h2>
      </div>
      <div className="text-crew-body">{children}</div>
    </section>
  );
}

function StepWithCode({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-crew-heading">{label}</p>
      <pre className="overflow-x-auto rounded border border-white/10 bg-crew-card p-4 font-mono text-xs leading-relaxed text-crew-body">
        {code}
      </pre>
    </div>
  );
}

function LifecycleStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0">
        <div className="flex size-8 items-center justify-center rounded-full border border-crew-copper/30 bg-crew-copper/10 text-xs font-semibold text-crew-copper">
          ✓
        </div>
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-crew-heading">{title}</h3>
        <p className="text-sm leading-6 text-crew-body">{body}</p>
      </div>
    </div>
  );
}

function ResourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="flex items-center justify-between rounded border border-white/10 bg-crew-card px-4 py-3 text-sm text-crew-body transition-colors hover:border-crew-copper/30 hover:bg-crew-card/80"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>{label}</span>
      <ExternalLink className="size-4 text-crew-copper" />
    </a>
  );
}
