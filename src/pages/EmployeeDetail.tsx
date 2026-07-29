import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  Heart,
  KeyRound,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  Star,
  Tag,
  TerminalSquare,
} from "lucide-react";
import { PermissionLevelList } from "@/components/employee/PermissionLevel";
import { ToolCapabilityList } from "@/components/employee/ToolCapabilityList";
import { PricingBadge } from "@/components/PricingInfo";
import { formatPricingLabel, pricingTone } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getEmployee, type Employee } from "@/data/employees";
import { isLocalDevelopment, localCrewClawCommand } from "@/data/experts";
import { track } from "@/hooks/use-analytics";
import { useEmployeeReviews } from "@/hooks/use-reviews";
import { useSavedEmployees } from "@/hooks/use-saved";
import { writeClipboard } from "@/lib/clipboard";
import { hireHandoffUrl } from "@/components/employee/employeeSignals";
import { useEmployeePerformance } from "@/components/employee/useEmployeePerformance";
import { useI18n, useMessages } from "@/i18n";
import { localizeEmployeeContent } from "@/i18n/employee-content";
import {
  acceptanceText,
  averageCostText,
  availabilityText,
  categoryLabel,
  employeeEvidenceBadge as localizedEmployeeEvidenceBadge,
  employeeEvidenceLevel as localizedEmployeeEvidenceLevel,
  formatDurationText,
  formatMoneyText,
  formatPercentText,
  kpiStateText,
  reputationText,
  runtimeText,
  registryStatusLabel,
  taskCountText,
  type MarketplaceT,
} from "@/i18n/marketplace-format";
import { marketplaceMessages } from "@/i18n/locales/marketplace";

type ResumeSectionProps = {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
};

function ResumeSection({
  title,
  eyebrow,
  children,
  className,
}: ResumeSectionProps) {
  return (
    <Card
      className={cn(
        "rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading shadow-[0_18px_54px_rgba(0,0,0,0.18)]",
        className
      )}
    >
      <CardHeader className="gap-2">
        {eyebrow ? (
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
            {eyebrow}
          </p>
        ) : null}
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TextList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3 text-sm leading-6 text-crew-body">
      {items.map(item => (
        <li className="flex gap-3" key={item}>
          <CheckCircle2 className="mt-1 size-4 shrink-0 text-crew-copper" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center gap-2 text-crew-muted">
        <Icon className="size-4" />
        <span className="text-xs uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-crew-heading">{value}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/10 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <dt className="text-sm text-crew-muted">{label}</dt>
      <dd className="text-sm text-crew-body sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function formatReviewDate(
  value: string,
  formatDate: ReturnType<typeof useI18n>["formatDate"]
) {
  return formatDate(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatEmployeeDate(
  value: string,
  formatDate: ReturnType<typeof useI18n>["formatDate"]
) {
  return formatDate(value, { dateStyle: "medium" });
}

function ratingStars(value: number) {
  return Array.from({ length: 5 }, (_, index) => index + 1).map(star => (
    <Star
      className={cn(
        "size-4",
        star <= Math.round(value)
          ? "fill-crew-copper text-crew-copper"
          : "text-crew-muted"
      )}
      key={star}
    />
  ));
}

function demoCommand(employeeId: string, task: string) {
  return `crew run ${employeeId} "${task.replaceAll('"', '\\"')}"`;
}

function onboardingRequirements(employee: Employee, t: MarketplaceT) {
  const active = employee.tool_capabilities.filter(
    capability =>
      capability.necessity !== "disabled" &&
      capability.permission !== "disabled"
  );
  const requirements = [
    active.length > 0
      ? t(
          active.length === 1
            ? "onboardingReviewCapabilitiesOne"
            : "onboardingReviewCapabilitiesMany",
          { count: active.length }
        )
      : t("onboardingReviewCapabilityDefault"),
  ];
  const scopedReadCapabilities = active.filter(
    capability =>
      capability.operation === "read" && capability.scopes.length > 0
  );
  if (scopedReadCapabilities.length > 0) {
    requirements.push(
      t(
        scopedReadCapabilities.length === 1
          ? "onboardingReadScopesOne"
          : "onboardingReadScopesMany",
        { count: scopedReadCapabilities.length }
      )
    );
  }

  const adapterCapabilities = active.filter(
    capability => capability.availability === "adapter_required"
  );
  if (adapterCapabilities.length > 0) {
    requirements.push(
      t(
        adapterCapabilities.length === 1
          ? "onboardingAdaptersOne"
          : "onboardingAdaptersMany",
        { count: adapterCapabilities.length }
      )
    );
  }

  const approvalCapabilities = active.filter(
    capability =>
      capability.permission === "requires_authorization" ||
      capability.approval === "always"
  );
  if (approvalCapabilities.length > 0) {
    requirements.push(
      t(
        approvalCapabilities.length === 1
          ? "onboardingApprovalsOne"
          : "onboardingApprovalsMany",
        { count: approvalCapabilities.length }
      )
    );
  }

  const boundedCapabilities = active.filter(
    capability =>
      capability.limits?.max_calls_per_task !== undefined ||
      capability.limits?.timeout_ms !== undefined
  );
  if (boundedCapabilities.length > 0) {
    requirements.push(
      t(
        boundedCapabilities.length === 1
          ? "onboardingTaskLimitsOne"
          : "onboardingTaskLimitsMany",
        { count: boundedCapabilities.length }
      )
    );
  }

  if (employee.install_command) {
    requirements.push(
      isLocalDevelopment
        ? t("localLauncherAvailable", { command: localCrewClawCommand })
        : t("publicPackagePending")
    );
  }

  if (employee.repo || employee.local_source) {
    requirements.push(
      employee.repo
        ? t("sourcePackage", { source: employee.repo })
        : t("localPackage", { source: employee.local_source ?? "" })
    );
  }

  return requirements;
}

function pricingDescription(pricing: string, t: MarketplaceT) {
  const tone = pricingTone(pricing);

  if (tone === "Pro") {
    return t("pricingProDescription");
  }

  if (tone === "Custom") {
    return t("pricingCustomDescription");
  }

  return t("pricingFreeDescription");
}

function NotFound() {
  const t = useMessages(marketplaceMessages);

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Badge
          className="border-white/10 bg-white/[0.04] text-crew-muted"
          variant="outline"
        >
          {t("resume")}
        </Badge>
        <h1 className="mt-5 text-3xl font-light">{t("employeeNotFound")}</h1>
        <p className="mt-4 text-sm leading-6 text-crew-body">
          {t("employeeNotFoundDescription")}
        </p>
        <Button asChild className="mt-6 rounded-[8px]">
          <Link to="/marketplace">{t("backToMarketplace")}</Link>
        </Button>
      </section>
    </main>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const { locale, formatDate } = useI18n();
  const t = useMessages(marketplaceMessages);
  const rawEmployee = id ? getEmployee(id) : undefined;
  const employee = rawEmployee
    ? localizeEmployeeContent(rawEmployee, locale)
    : undefined;
  const saved = useSavedEmployees();
  // Fallback 0 (not the fabricated employee.rating) so the reviews average reflects only real,
  // user-submitted reviews — no invented baseline.
  const reviews = useEmployeeReviews(employee?.employee_id ?? "missing", 0);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [selectedTaskRunId, setSelectedTaskRunId] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [copiedTask, setCopiedTask] = useState<string | null>(null);
  const performanceState = useEmployeePerformance(
    employee?.employee_id ?? "missing"
  );

  useEffect(() => {
    if (!employee) return;

    track("employee_detail_viewed", {
      employee_id: employee.employee_id,
      employee_name: employee.name,
    });
  }, [employee]);

  if (!employee) return <NotFound />;

  const currentEmployee = employee;
  const requirements = onboardingRequirements(employee, t);
  const isSaved = saved.isSaved(employee.employee_id);
  const runtime = runtimeText(employee, t);
  const performance = performanceState.performance;
  const kpi = performance?.kpi;
  const effectiveTaskRunId = reviews.reviewableTasks.some(
    task => task.task_run_id === selectedTaskRunId
  )
    ? selectedTaskRunId
    : (reviews.reviewableTasks[0]?.task_run_id ?? "");

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await reviews.addReview(
      effectiveTaskRunId,
      reviewRating,
      reviewText
    );
    setReviewMessage(result.message);

    if (result.ok) {
      setReviewText("");
      setReviewRating(5);
    }
  }

  async function copyDemoTask(task: string) {
    const command = demoCommand(currentEmployee.employee_id, task);
    const copied = await writeClipboard(command);

    if (copied) {
      setCopiedTask(task);
      track("demo_task_copied", {
        employee_id: currentEmployee.employee_id,
        employee_name: currentEmployee.name,
      });
    }
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-6xl">
        <Button
          asChild
          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
          variant="outline"
        >
          <Link to="/marketplace">{t("marketplace")}</Link>
        </Button>

        <section className="mt-8 grid gap-8 border-b border-white/10 pb-10 lg:grid-cols-[1fr_340px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                {localizedEmployeeEvidenceBadge(employee, t)}
              </Badge>
              {employee.categories.map(category => (
                <Badge
                  className="border-white/10 bg-white/[0.04] text-crew-muted"
                  key={category}
                  variant="outline"
                >
                  {categoryLabel(category, t)}
                </Badge>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="grid size-20 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.04] text-3xl font-semibold text-crew-copper">
                {employee.name.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <h1 className="text-4xl font-light leading-tight md:text-6xl">
                  {employee.name}
                </h1>
                <p className="mt-3 text-xl text-crew-muted">{employee.role}</p>
                <dl className="mt-4 grid gap-2 text-sm text-crew-body sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <BriefcaseBusiness className="size-4 text-crew-copper" />
                    <span>
                      {t("creator")}: {t("creatorName")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="size-4 text-crew-copper" />
                    <span>{localizedEmployeeEvidenceLevel(employee, t)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PricingBadge pricing={employee.pricing} />
                    <span>
                      {t("hiringTerms", {
                        tone: pricingTone(employee.pricing),
                      })}
                    </span>
                  </div>
                </dl>
              </div>
            </div>

            <p className="mt-7 max-w-3xl text-lg leading-8 text-crew-body">
              {employee.identity.description}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                className="rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze"
              >
                <Link
                  onClick={() =>
                    track("hire_clicked", {
                      employee_id: employee.employee_id,
                      employee_name: employee.name,
                      source: "employee_detail_hero",
                    })
                  }
                  to={hireHandoffUrl(employee, "employee_detail_hero")}
                >
                  {t("hire")}
                </Link>
              </Button>
              <Button
                className={cn(
                  "rounded-[8px] border-white/15",
                  isSaved
                    ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                    : "text-crew-muted hover:text-crew-heading"
                )}
                onClick={() =>
                  saved.toggleSaved(employee.employee_id, employee.name)
                }
                type="button"
                variant="outline"
              >
                <Heart className={cn("size-4", isSaved && "fill-current")} />
                {isSaved ? t("saved") : t("save")}
              </Button>
              <Button
                asChild
                className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                variant="outline"
              >
                <Link to="/team">{t("viewTeam")}</Link>
              </Button>
              {employee.local_source && (
                // v0.18 Phase 2: a REAL download — the packaged employee (gzipped tar + sha256)
                // served by /api/employees/:slug/package, not just a copyable command. Gated on
                // local_source (the same field the API requires) — coming-soon employees have none.
                <Button
                  asChild
                  className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                  variant="outline"
                >
                  <a
                    href={`/api/employees/${employee.employee_id}/package`}
                    onClick={() =>
                      track("package_downloaded", {
                        employee_id: employee.employee_id,
                        employee_name: employee.name,
                      })
                    }
                  >
                    <Download className="size-4" />
                    {t("downloadPackage")}
                  </a>
                </Button>
              )}
            </div>
          </div>

          <Card className="h-fit rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading shadow-[0_18px_54px_rgba(0,0,0,0.18)]">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("resumeSnapshot")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("reportsTo")}
                  value={employee.identity.reports_to ?? t("teamOwner")}
                />
                <DetailRow
                  label={t("location")}
                  value={employee.identity.location ?? t("remote")}
                />
                <DetailRow
                  label={t("pricing")}
                  value={<PricingBadge pricing={employee.pricing} />}
                />
                <DetailRow
                  label={t("trialPeriod")}
                  value={employee.lifecycle.trial_period}
                />
                <DetailRow
                  label={t("lifecycle")}
                  value={`${employee.lifecycle.hireable ? t("hireable") : t("closed")} / ${
                    employee.lifecycle.fireable ? t("fireable") : t("locked")
                  }`}
                />
              </dl>
            </CardContent>
          </Card>
        </section>

        {/* v0.18 Phase 2: honest stats only. The fabricated Rating (4.9) and Hires (860) had no
            data source — a bundled site can't read local eval/kpi files. Show real registry facts
            (certification, version) instead; live user reviews still surface in the Reviews section
            below when they exist. */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={ShieldCheck}
            label={t("evidenceLevel")}
            value={localizedEmployeeEvidenceLevel(employee, t)}
          />
          <Stat
            icon={Tag}
            label={t("package")}
            value={registryStatusLabel(
              employee.evidence_state.package_status,
              t
            )}
          />
          <Stat
            icon={ClipboardCheck}
            label={t("labCertification")}
            value={
              employee.certified_evaluation
                ? `${Math.round(employee.certified_evaluation.success_rate * 100)}%`
                : registryStatusLabel(employee.evidence_state.lab_status, t)
            }
          />
          <Stat
            icon={Clock3}
            label={t("fieldEvidence")}
            value={registryStatusLabel(employee.evidence_state.field_status, t)}
          />
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={Gauge}
            label={t("formalTasks")}
            value={
              performanceState.loading
                ? t("loading")
                : taskCountText(performance, t)
            }
          />
          <Stat
            icon={ClipboardCheck}
            label={t("acceptance")}
            value={
              performanceState.loading
                ? t("loading")
                : acceptanceText(performance, t)
            }
          />
          <Stat
            icon={Tag}
            label={t("avgCost")}
            value={
              performanceState.loading
                ? t("loading")
                : averageCostText(performance, t)
            }
          />
          <Stat
            icon={Star}
            label={t("reputation")}
            value={
              performanceState.loading
                ? t("loading")
                : reputationText(performance, t)
            }
          />
        </section>

        <div className="mt-4 rounded-[8px] border border-white/10 bg-white/[0.025] px-5 py-4">
          {employee.certified_evaluation ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("evaluationSource")}
                </dt>
                <dd className="mt-2 text-crew-body">
                  {employee.certified_evaluation.source}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("issued")}
                </dt>
                <dd className="mt-2 text-crew-body">
                  {formatEmployeeDate(
                    employee.certified_evaluation.issued_at,
                    formatDate
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-crew-muted">
                  {t("verifiedSample")}
                </dt>
                <dd className="mt-2 text-crew-body">
                  {t("verifiedSampleValue", {
                    count: employee.certified_evaluation.sample_size,
                    percent: Math.round(
                      employee.certified_evaluation.success_confidence_low * 100
                    ),
                  })}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm leading-6 text-crew-muted">
              {t("noSignedCredential")}
            </p>
          )}
        </div>

        <ResumeSection
          className="mt-8"
          eyebrow={t("manifest")}
          title={t("hiringContractRuntime")}
        >
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <dl className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <DetailRow label={t("manifestId")} value={employee.employee_id} />
              <DetailRow label={t("version")} value={`v${employee.version}`} />
              <DetailRow
                label={t("evidence")}
                value={localizedEmployeeEvidenceLevel(employee, t)}
              />
              <DetailRow
                label={t("source")}
                value={
                  employee.repo ??
                  employee.local_source ??
                  t("packageSourceNotPublished")
                }
              />
              <DetailRow
                label={t("trial")}
                value={employee.lifecycle.trial_period}
              />
            </dl>
            <dl className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <DetailRow
                label={t("runtimeCompatibility")}
                value={`${runtime.label}; ${runtime.detail}`}
              />
              <DetailRow
                label={t("declaredTools")}
                value={
                  employee.tool_capabilities.length === 0
                    ? t("noFormalCapabilities")
                    : t("capabilityCountHighestRisk", {
                        count: employee.tool_capabilities.length,
                        risk: runtime.highestRisk,
                      })
                }
              />
              <DetailRow
                label={t("availability")}
                value={
                  employee.lifecycle.hireable && !employee.local_source
                    ? t("hireableAfterPackage")
                    : availabilityText(employee, t)
                }
              />
              <DetailRow
                label={t("handoffCarries")}
                value={t("handoffCarriesValue")}
              />
            </dl>
          </div>
        </ResumeSection>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <ResumeSection eyebrow={t("fit")} title={t("bestFor")}>
            <TextList
              items={
                employee.demo_tasks.length > 0
                  ? employee.demo_tasks
                  : employee.examples.inputs
              }
            />
          </ResumeSection>

          <ResumeSection eyebrow={t("skills")} title={t("coreSkills")}>
            <div className="flex flex-wrap gap-2">
              {employee.skills.map(skill => (
                <Badge
                  className="border-crew-copper/35 bg-crew-copper/10 text-crew-copper"
                  key={skill}
                  variant="outline"
                >
                  {skill}
                </Badge>
              ))}
            </div>
          </ResumeSection>

          <ResumeSection
            eyebrow={t("deliverables")}
            title={t("supportedDeliverables")}
          >
            <div className="space-y-4">
              <p className="text-sm leading-6 text-crew-body">
                {t("deliverablesDescription")}
              </p>
              <TextList items={employee.examples.outputs} />
            </div>
          </ResumeSection>

          <ResumeSection eyebrow={t("pricing")} title={t("hiringTermsTitle")}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <PricingBadge pricing={employee.pricing} />
                <span className="text-sm text-crew-body">
                  {formatPricingLabel(employee.pricing, locale)}
                </span>
              </div>
              <p className="text-sm leading-6 text-crew-body">
                {pricingDescription(employee.pricing, t)}
              </p>
              <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                <h3 className="text-sm font-medium text-crew-heading">
                  {t("beforeOnboarding")}
                </h3>
                <p className="mt-2 text-sm leading-6 text-crew-body">
                  {t("beforeOnboardingDescription")}
                </p>
              </div>
            </div>
          </ResumeSection>

          <ResumeSection
            className="lg:col-span-2"
            eyebrow={t("access")}
            title={t("toolCapabilities")}
          >
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                  <PackageCheck className="size-4 text-crew-copper" />
                  <p className="mt-3 text-sm font-medium text-crew-heading">
                    {runtime.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-crew-muted">
                    {runtime.detail}
                  </p>
                </div>
                <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                  <TerminalSquare className="size-4 text-crew-copper" />
                  <p className="mt-3 text-sm font-medium text-crew-heading">
                    {t("runtimeProviderHandoff")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-crew-muted">
                    {t("runtimeProviderHandoffDescription")}
                  </p>
                </div>
                <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                  <KeyRound className="size-4 text-crew-copper" />
                  <p className="mt-3 text-sm font-medium text-crew-heading">
                    {t("permissionsScoped")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-crew-muted">
                    {t("permissionsScopedDescription")}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-crew-heading">
                  {t("roleCapabilityContract")}
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-crew-body">
                  {t("roleCapabilityContractDescription")}
                </p>
                <div className="mt-4">
                  <ToolCapabilityList
                    capabilities={employee.tool_capabilities}
                  />
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div>
                <h3 className="text-sm font-medium text-crew-heading">
                  {t("dataAccessScopes")}
                </h3>
                <div className="mt-3">
                  <PermissionLevelList
                    compact
                    permissions={employee.permissions}
                  />
                </div>
              </div>
            </div>
          </ResumeSection>

          <ResumeSection eyebrow={t("tryFirst")} title={t("exampleTasks")}>
            <div className="space-y-5">
              <div className="space-y-3">
                {employee.examples.inputs.map(task => {
                  const command = demoCommand(employee.employee_id, task);

                  return (
                    <div
                      className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
                      key={task}
                    >
                      <div className="flex gap-3">
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-crew-copper" />
                        <p className="text-sm leading-6 text-crew-body">
                          {task}
                        </p>
                      </div>
                      <div className="mt-4 rounded-[8px] border border-white/10 bg-black/20 p-3">
                        <code className="break-all font-mono text-xs leading-6 text-crew-heading">
                          {command}
                        </code>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-5 text-crew-muted">
                          {t("copyCommandHint")}
                        </p>
                        <Button
                          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                          onClick={() => void copyDemoTask(task)}
                          type="button"
                          variant="outline"
                        >
                          <Copy className="size-4" />
                          {copiedTask === task ? t("copied") : t("try")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Separator className="bg-white/10" />
              <div>
                <h3 className="mb-3 text-sm font-medium text-crew-heading">
                  {t("expectedOutput")}
                </h3>
                <TextList items={employee.examples.outputs} />
              </div>
            </div>
          </ResumeSection>

          <ResumeSection eyebrow={t("onboarding")} title={t("requirements")}>
            <TextList items={requirements} />
          </ResumeSection>

          <ResumeSection eyebrow={t("risk")} title={t("limitationsSafety")}>
            <div className="space-y-5">
              <TextList items={employee.limitations} />
              <Separator className="bg-white/10" />
              <TextList items={employee.safety_notes} />
            </div>
          </ResumeSection>
        </section>

        <ResumeSection
          className="mt-5"
          eyebrow={t("kpi")}
          title={t("localKpiRecord")}
        >
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <h3 className="text-sm font-medium text-crew-heading">
                {performanceState.loading
                  ? t("loadingLocalPerformance")
                  : kpiStateText(performance, t)}
              </h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <DetailRow
                  label={t("tasks")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : taskCountText(performance, t)
                  }
                />
                <DetailRow
                  label={t("accepted")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : acceptanceText(performance, t)
                  }
                />
                <DetailRow
                  label={t("avgCost")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : averageCostText(performance, t)
                  }
                />
                <DetailRow
                  label={t("averageRuntime")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : formatDurationText(kpi?.average_duration_ms, t)
                  }
                />
                <DetailRow
                  label={t("evidenceCoverage")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : formatPercentText(kpi?.evidence_coverage, t)
                  }
                />
                <DetailRow
                  label={t("totalCost")}
                  value={
                    performanceState.loading
                      ? t("loading")
                      : formatMoneyText(kpi?.total_cost, t)
                  }
                />
              </dl>
            </div>
            <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <h3 className="text-sm font-medium text-crew-heading">
                {t("reputationProofPack")}
              </h3>
              <p className="mt-3 text-sm leading-6 text-crew-body">
                {performanceState.loading
                  ? t("loadingLocalProofPack")
                  : reputationText(performance, t)}
              </p>
              {performanceState.error ? (
                <p className="mt-3 text-xs leading-5 text-crew-muted">
                  {t("localPerformanceError", {
                    error: performanceState.error,
                  })}
                </p>
              ) : null}
              {performance?.warnings.length ? (
                <TextList items={performance.warnings} />
              ) : (
                <p className="mt-3 text-xs leading-5 text-crew-muted">
                  {t("noWarningProofPack")}
                </p>
              )}
            </div>
          </div>
        </ResumeSection>

        <ResumeSection
          className="mt-5"
          eyebrow={t("version")}
          title={t("lifecycleChangelog")}
        >
          <div className="grid gap-5 md:grid-cols-[280px_1fr]">
            <dl className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <DetailRow label={t("version")} value={`v${employee.version}`} />
              <DetailRow
                label={t("status")}
                value={registryStatusLabel(employee.status, t)}
              />
              <DetailRow
                label={t("created")}
                value={formatEmployeeDate(employee.created_at, formatDate)}
              />
            </dl>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-crew-heading">
                <FileText className="size-4 text-crew-copper" />
                <span>{t("recentChanges")}</span>
              </div>
              <TextList items={employee.changelog} />
            </div>
          </div>
        </ResumeSection>

        <ResumeSection
          className="mt-5"
          eyebrow={t("reviews")}
          title={t("teammateReviews")}
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  {ratingStars(reviews.averageRating)}
                </div>
                <span className="text-sm text-crew-body">
                  {reviews.localApiAvailable
                    ? reviews.reviewCount === 0
                      ? t("verifiedAverageNoReviews", {
                          average: reviews.averageRating.toFixed(1),
                        })
                      : t("verifiedAverageReviews", {
                          average: reviews.averageRating.toFixed(1),
                          count: reviews.reviewCount,
                          reviewLabel: t(
                            reviews.reviewCount === 1
                              ? "reviewSingular"
                              : "reviewPlural"
                          ),
                        })
                    : t("localReviewsUnavailable")}
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {reviews.reviews.length > 0 ? (
                  reviews.reviews.map(review => (
                    <article
                      className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
                      key={review.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                          {ratingStars(review.rating)}
                        </div>
                        <time className="font-mono text-xs text-crew-muted">
                          {formatReviewDate(review.created_at, formatDate)}
                        </time>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-crew-body">
                        {review.text}
                      </p>
                      <p className="mt-2 font-mono text-xs text-emerald-200">
                        {t("verifiedAcceptedTaskRun", {
                          id: review.task_run_id,
                        })}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex gap-3">
                      <MessageSquare className="mt-1 size-4 shrink-0 text-crew-copper" />
                      <p className="text-sm leading-6 text-crew-body">
                        {t("noVerifiedReviews")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {reviews.legacyNotes.length > 0 ? (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-crew-heading">
                    {t("unverifiedLocalNotes")}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-crew-muted">
                    {t("unverifiedLocalNotesDescription")}
                  </p>
                  <div className="mt-3 space-y-3">
                    {reviews.legacyNotes.map(note => (
                      <article
                        className="rounded-[8px] border border-dashed border-white/10 bg-white/[0.02] p-4"
                        key={note.id}
                      >
                        <p className="text-sm leading-6 text-crew-body">
                          {note.text}
                        </p>
                        <p className="mt-2 text-xs text-crew-muted">
                          {t("unverifiedLocalNote", { rating: note.rating })}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <form
              className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
              onSubmit={submitReview}
            >
              <h3 className="text-sm font-medium text-crew-heading">
                {t("reviewAcceptedTask")}
              </h3>
              <label
                className="mt-4 block text-xs font-medium text-crew-muted"
                htmlFor="review-task-run"
              >
                {t("acceptedTaskRunReceipt")}
              </label>
              <select
                className="mt-2 w-full rounded-[8px] border border-white/10 bg-[#17120F] px-3 py-2 text-sm text-crew-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crew-copper"
                disabled={
                  reviews.loading || reviews.reviewableTasks.length === 0
                }
                id="review-task-run"
                name="task_run_id"
                onChange={event => setSelectedTaskRunId(event.target.value)}
                value={effectiveTaskRunId}
              >
                {reviews.reviewableTasks.length === 0 ? (
                  <option value="">{t("noUnreviewedTasks")}</option>
                ) : null}
                {reviews.reviewableTasks.map(task => (
                  <option key={task.task_run_id} value={task.task_run_id}>
                    {task.goal} · {task.task_run_id}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup">
                {[1, 2, 3, 4, 5].map(rating => (
                  <Button
                    aria-checked={reviewRating === rating}
                    aria-label={t("starReviewAria", { rating })}
                    className={cn(
                      "size-10 rounded-[8px] border-white/15",
                      reviewRating >= rating
                        ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                        : "text-crew-muted hover:text-crew-heading"
                    )}
                    key={rating}
                    onClick={() => setReviewRating(rating)}
                    role="radio"
                    type="button"
                    variant="outline"
                  >
                    <Star
                      aria-hidden="true"
                      className={cn(
                        "size-4",
                        reviewRating >= rating && "fill-current"
                      )}
                    />
                  </Button>
                ))}
              </div>
              <Textarea
                aria-label={t("verifiedReviewAria")}
                className="mt-4 min-h-28 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
                disabled={reviews.reviewableTasks.length === 0}
                name="review_text"
                onChange={event => setReviewText(event.target.value)}
                placeholder={t("reviewPlaceholder")}
                value={reviewText}
              />
              {reviewMessage ? (
                <p
                  aria-live="polite"
                  className="mt-3 text-sm leading-6 text-crew-muted"
                >
                  {reviewMessage}
                </p>
              ) : null}
              <Button
                className="mt-4 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                disabled={
                  reviews.loading || reviews.reviewableTasks.length === 0
                }
              >
                {t("submitReview")}
              </Button>
            </form>
          </div>
        </ResumeSection>

        <div className="mt-8 flex flex-col gap-4 rounded-[8px] border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <ShieldCheck className="mt-1 size-5 shrink-0 text-crew-copper" />
            <div>
              <h2 className="text-base font-semibold">{t("readyToOnboard")}</h2>
              <p className="mt-1 text-sm leading-6 text-crew-body">
                {t("readyToOnboardDescription")}
              </p>
            </div>
          </div>
          <Button
            asChild
            className="rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze"
          >
            <Link
              onClick={() =>
                track("hire_clicked", {
                  employee_id: employee.employee_id,
                  employee_name: employee.name,
                  source: "employee_detail_footer",
                })
              }
              to={hireHandoffUrl(employee, "employee_detail_footer")}
            >
              {t("hire")}
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
