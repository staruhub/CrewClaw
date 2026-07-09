import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Heart,
  MessageSquare,
  ShieldCheck,
  Star,
  Tag,
} from "lucide-react";
import { PermissionLevelList } from "@/components/employee/PermissionLevel";
import { formatPricingLabel, PricingBadge, pricingTone } from "@/components/PricingInfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getEmployee, type Employee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useEmployeeReviews } from "@/hooks/use-reviews";
import { useSavedEmployees } from "@/hooks/use-saved";
import { writeClipboard } from "@/lib/clipboard";

type ResumeSectionProps = {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
};

function ResumeSection({ title, eyebrow, children, className }: ResumeSectionProps) {
  return (
    <Card
      className={cn(
        "rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading shadow-[0_18px_54px_rgba(0,0,0,0.18)]",
        className,
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
      {items.map((item) => (
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/10 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <dt className="text-sm text-crew-muted">{label}</dt>
      <dd className="text-sm text-crew-body sm:max-w-[65%] sm:text-right">{value}</dd>
    </div>
  );
}

function formatReviewDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ratingStars(value: number) {
  return Array.from({ length: 5 }, (_, index) => index + 1).map((star) => (
    <Star
      className={cn(
        "size-4",
        star <= Math.round(value) ? "fill-crew-copper text-crew-copper" : "text-crew-muted",
      )}
      key={star}
    />
  ));
}

function demoCommand(employeeId: string, task: string) {
  return `crew run ${employeeId} "${task.replaceAll('"', '\\"')}"`;
}

function toolLabel(tool: string) {
  const labels: Record<string, string> = {
    browser: "Browser",
    skills: "Skills",
    terminal: "Terminal",
    read_file: "File reader",
  };

  return labels[tool] ?? tool;
}

function onboardingRequirements(employee: Employee) {
  const requirements = ["Confirm permissions before onboarding this employee."];

  if (employee.tools.includes("browser")) {
    requirements.push("Browser access for public web research.");
  }

  if (employee.tools.includes("terminal") || employee.tools.includes("read_file")) {
    requirements.push("Local read-only project context when task work needs repository files.");
  }

  if (employee.install_command) {
    requirements.push(`Hermes profile command available: ${employee.install_command}`);
  }

  if (employee.repo || employee.local_source) {
    requirements.push(employee.repo ? `Source package: ${employee.repo}` : `Local package: ${employee.local_source}`);
  }

  return requirements;
}

function pricingDescription(pricing: string) {
  const tone = pricingTone(pricing);

  if (tone === "Pro") {
    return "This employee is shown with paid-market pricing. The hire flow uses a simulated checkout for the demo and does not charge a real card.";
  }

  if (tone === "Custom") {
    return "This employee uses custom commercial terms. The demo hire flow still treats checkout as a simulation before onboarding.";
  }

  return "This employee can join your local demo crew without payment. Any checkout screen in this prototype is clearly marked as simulated.";
}

function NotFound() {
  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Badge className="border-white/10 bg-white/[0.04] text-crew-muted" variant="outline">
          Resume
        </Badge>
        <h1 className="mt-5 text-3xl font-light">Employee not found</h1>
        <p className="mt-4 text-sm leading-6 text-crew-body">
          This AI employee is not available in the marketplace.
        </p>
        <Button asChild className="mt-6 rounded-[8px]">
          <Link to="/marketplace">Back to marketplace</Link>
        </Button>
      </section>
    </main>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const employee = id ? getEmployee(id) : undefined;
  const saved = useSavedEmployees();
  // Fallback 0 (not the fabricated employee.rating) so the reviews average reflects only real,
  // user-submitted reviews — no invented baseline.
  const reviews = useEmployeeReviews(employee?.employee_id ?? "missing", 0);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [copiedTask, setCopiedTask] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;

    track("employee_detail_viewed", {
      employee_id: employee.employee_id,
      employee_name: employee.name,
    });
  }, [employee]);

  if (!employee) return <NotFound />;

  const currentEmployee = employee;
  const requirements = onboardingRequirements(employee);
  const isSaved = saved.isSaved(employee.employee_id);

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = reviews.addReview(reviewRating, reviewText);
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
          <Link to="/marketplace">Marketplace</Link>
        </Button>

        <section className="mt-8 grid gap-8 border-b border-white/10 pb-10 lg:grid-cols-[1fr_340px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                {employee.verified ? "Verified Employee" : "In Review"}
              </Badge>
              {employee.categories.map((category) => (
                <Badge
                  className="border-white/10 bg-white/[0.04] text-crew-muted"
                  key={category}
                  variant="outline"
                >
                  {category}
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
                    <span>Creator: ChaoGeek</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="size-4 text-crew-copper" />
                    <span>{employee.certification} certified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PricingBadge pricing={employee.pricing} />
                    <span>{pricingTone(employee.pricing)} hiring terms</span>
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
                  to={`/hire/${employee.employee_id}`}
                >
                  Hire
                </Link>
              </Button>
              <Button
                className={cn(
                  "rounded-[8px] border-white/15",
                  isSaved
                    ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                    : "text-crew-muted hover:text-crew-heading",
                )}
                onClick={() => saved.toggleSaved(employee.employee_id, employee.name)}
                type="button"
                variant="outline"
              >
                <Heart className={cn("size-4", isSaved && "fill-current")} />
                {isSaved ? "Saved" : "Save"}
              </Button>
              <Button
                asChild
                className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                variant="outline"
              >
                <Link to="/team">View team</Link>
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
                    Download package
                  </a>
                </Button>
              )}
            </div>
          </div>

          <Card className="h-fit rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading shadow-[0_18px_54px_rgba(0,0,0,0.18)]">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Resume snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow label="Reports to" value={employee.identity.reports_to ?? "Team owner"} />
                <DetailRow label="Location" value={employee.identity.location ?? "Remote"} />
                <DetailRow label="Pricing" value={<PricingBadge pricing={employee.pricing} />} />
                <DetailRow label="Trial period" value={employee.lifecycle.trial_period} />
                <DetailRow
                  label="Lifecycle"
                  value={`${employee.lifecycle.hireable ? "Hireable" : "Closed"} / ${
                    employee.lifecycle.fireable ? "Fireable" : "Locked"
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
        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <Stat icon={ShieldCheck} label="Certification" value={employee.certification} />
          <Stat icon={Tag} label="Version" value={`v${employee.version}`} />
          <Stat icon={Clock3} label="Updated" value={new Date(employee.updated_at).toLocaleDateString()} />
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <ResumeSection eyebrow="Fit" title="Best for">
            <TextList items={employee.demo_tasks.length > 0 ? employee.demo_tasks : employee.examples.inputs} />
          </ResumeSection>

          <ResumeSection eyebrow="Skills" title="Core skills">
            <div className="flex flex-wrap gap-2">
              {employee.skills.map((skill) => (
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

          <ResumeSection eyebrow="Pricing" title="Hiring terms">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <PricingBadge pricing={employee.pricing} />
                <span className="text-sm text-crew-body">
                  {formatPricingLabel(employee.pricing)}
                </span>
              </div>
              <p className="text-sm leading-6 text-crew-body">
                {pricingDescription(employee.pricing)}
              </p>
              <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                <h3 className="text-sm font-medium text-crew-heading">Before onboarding</h3>
                <p className="mt-2 text-sm leading-6 text-crew-body">
                  Choose a Free or Pro mock plan during hire confirmation, then review
                  permissions before this employee joins your crew.
                </p>
              </div>
            </div>
          </ResumeSection>

          <ResumeSection eyebrow="Access" title="Tools and permissions">
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-crew-heading">Tools</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {employee.tools.map((tool) => (
                    <Badge
                      className="border-white/10 bg-white/[0.04] text-crew-muted"
                      key={tool}
                      variant="outline"
                    >
                      {toolLabel(tool)}
                    </Badge>
                  ))}
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div>
                <h3 className="text-sm font-medium text-crew-heading">Permissions</h3>
                <div className="mt-3">
                  <PermissionLevelList compact permissions={employee.permissions} />
                </div>
              </div>
            </div>
          </ResumeSection>

          <ResumeSection eyebrow="Try first" title="Example tasks">
            <div className="space-y-5">
              <div className="space-y-3">
                {employee.examples.inputs.map((task) => {
                  const command = demoCommand(employee.employee_id, task);

                  return (
                    <div
                      className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
                      key={task}
                    >
                      <div className="flex gap-3">
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-crew-copper" />
                        <p className="text-sm leading-6 text-crew-body">{task}</p>
                      </div>
                      <div className="mt-4 rounded-[8px] border border-white/10 bg-black/20 p-3">
                        <code className="break-all font-mono text-xs leading-6 text-crew-heading">
                          {command}
                        </code>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-5 text-crew-muted">
                          Copy this command and run it locally when this employee has joined
                          your crew.
                        </p>
                        <Button
                          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                          onClick={() => void copyDemoTask(task)}
                          type="button"
                          variant="outline"
                        >
                          <Copy className="size-4" />
                          {copiedTask === task ? "Copied" : "Try"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Separator className="bg-white/10" />
              <div>
                <h3 className="mb-3 text-sm font-medium text-crew-heading">Expected output</h3>
                <TextList items={employee.examples.outputs} />
              </div>
            </div>
          </ResumeSection>

          <ResumeSection eyebrow="Onboarding" title="Requirements">
            <TextList items={requirements} />
          </ResumeSection>

          <ResumeSection eyebrow="Risk" title="Limitations and safety notes">
            <div className="space-y-5">
              <TextList items={employee.limitations} />
              <Separator className="bg-white/10" />
              <TextList items={employee.safety_notes} />
            </div>
          </ResumeSection>
        </section>

        <ResumeSection className="mt-5" eyebrow="Version" title="Lifecycle and changelog">
          <div className="grid gap-5 md:grid-cols-[280px_1fr]">
            <dl className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
              <DetailRow label="Version" value={`v${employee.version}`} />
              <DetailRow label="Status" value={employee.status} />
              <DetailRow label="Created" value={new Date(employee.created_at).toLocaleDateString()} />
            </dl>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-crew-heading">
                <FileText className="size-4 text-crew-copper" />
                <span>Recent changes</span>
              </div>
              <TextList items={employee.changelog} />
            </div>
          </div>
        </ResumeSection>

        <ResumeSection className="mt-5" eyebrow="Reviews" title="Teammate reviews">
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  {ratingStars(reviews.averageRating)}
                </div>
                <span className="text-sm text-crew-body">
                  {reviews.averageRating.toFixed(1)} average from{" "}
                  {reviews.reviewCount === 0
                    ? "marketplace signal"
                    : `${reviews.reviewCount} review${reviews.reviewCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {reviews.reviews.length > 0 ? (
                  reviews.reviews.map((review) => (
                    <article
                      className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
                      key={review.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                          {ratingStars(review.rating)}
                        </div>
                        <time className="font-mono text-xs text-crew-muted">
                          {formatReviewDate(review.created_at)}
                        </time>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-crew-body">{review.text}</p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex gap-3">
                      <MessageSquare className="mt-1 size-4 shrink-0 text-crew-copper" />
                      <p className="text-sm leading-6 text-crew-body">
                        No teammate reviews yet. Add the first review after this employee
                        helps your crew.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <form
              className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4"
              onSubmit={submitReview}
            >
              <h3 className="text-sm font-medium text-crew-heading">Review this employee</h3>
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <Button
                    aria-checked={reviewRating === rating}
                    aria-label={`${rating} star review`}
                    className={cn(
                      "size-10 rounded-[8px] border-white/15",
                      reviewRating >= rating
                        ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                        : "text-crew-muted hover:text-crew-heading",
                    )}
                    key={rating}
                    onClick={() => setReviewRating(rating)}
                    role="radio"
                    type="button"
                    variant="outline"
                  >
                    <Star className={cn("size-4", reviewRating >= rating && "fill-current")} />
                  </Button>
                ))}
              </div>
              <Textarea
                className="mt-4 min-h-28 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
                onChange={(event) => setReviewText(event.target.value)}
                placeholder="Share what this AI employee helped with and where it still needs attention."
                value={reviewText}
              />
              {reviewMessage ? (
                <p className="mt-3 text-sm leading-6 text-crew-muted">{reviewMessage}</p>
              ) : null}
              <Button className="mt-4 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze">
                Submit review
              </Button>
            </form>
          </div>
        </ResumeSection>

        <div className="mt-8 flex flex-col gap-4 rounded-[8px] border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <ShieldCheck className="mt-1 size-5 shrink-0 text-crew-copper" />
            <div>
              <h2 className="text-base font-semibold">Ready to onboard this AI employee?</h2>
              <p className="mt-1 text-sm leading-6 text-crew-body">
                Review tool access and confirmation points before this employee joins your team.
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
              to={`/hire/${employee.employee_id}`}
            >
              Hire
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
