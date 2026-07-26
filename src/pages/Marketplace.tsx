import { Link, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Heart,
  Search,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { EmployeeCard } from "@/components/employee/EmployeeCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { availableEmployees, byCategory, getEmployee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useSavedEmployees } from "@/hooks/use-saved";
import {
  EMPLOYEE_SORT_OPTIONS,
  isEmployeeSort,
  type EmployeeSort,
  sortEmployees,
} from "@/lib/employee-sort";
import { cn } from "@/lib/utils";

const categoryLinks = [
  { label: "Research", value: "research" },
  { label: "Sales", value: "sales" },
  { label: "Operations", value: "operations" },
  { label: "Coding", value: "coding" },
  { label: "Local Expert", value: "local-expert" },
  { label: "Customer Support", value: "customer-support" },
  { label: "Marketing", value: "marketing" },
];

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-crew-copper/80">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-2xl font-light leading-tight text-crew-heading md:text-3xl">
          {title}
        </h2>
      </div>
      <p className="max-w-xl text-sm leading-6 text-crew-body">{description}</p>
    </div>
  );
}

export default function Marketplace() {
  const [searchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState<EmployeeSort>("recommended");
  const handoffFrom = searchParams.get("handoff_from");
  const departingEmployee = handoffFrom ? getEmployee(handoffFrom) : undefined;
  const handoffQuery = departingEmployee?.identity.title ?? "";
  const saved = useSavedEmployees();
  const categoryGroups = byCategory();
  // Lab-certified means a registry-published signed credential, not merely a validated package.
  const featuredEmployees = sortEmployees(
    availableEmployees,
    "recommended"
  ).slice(0, 2);
  const certifiedEmployees = sortEmployees(
    availableEmployees.filter(employee => employee.verified),
    "recommended"
  ).slice(0, 3);
  const sortedEmployees = useMemo(
    () => sortEmployees(availableEmployees, sortBy),
    [sortBy]
  );
  const savedEmployees = useMemo(() => {
    const savedIds = new Set(saved.savedIds);
    return sortedEmployees.filter(employee =>
      savedIds.has(employee.employee_id)
    );
  }, [saved.savedIds, sortedEmployees]);

  useEffect(() => {
    track("marketplace_viewed", {
      employee_count: availableEmployees.length,
    });
  }, []);

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-14">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 border-b border-white/10 pb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <Users className="size-3" />
              AI Employee Marketplace
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Hire AI employees for your crew
            </h1>
            <p className="mt-5 text-base leading-7 text-crew-body">
              Discover, hire, and manage AI agents like real teammates.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/crew">
                <Users className="size-4" />
                Crew Mode
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/performance">
                <BarChart3 className="size-4" />
                Performance
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/creator">Submit</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/review">Review</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/team">View team</Link>
            </Button>
          </div>
        </div>

        {departingEmployee ? (
          <div className="mt-8 rounded-[8px] border border-crew-copper/35 bg-crew-copper/[0.08] p-4">
            <p className="text-sm font-medium text-crew-heading">
              Successor handoff for {departingEmployee.name}
            </p>
            <p className="mt-1 text-sm leading-6 text-crew-body">
              The role query below is prefilled from the departing employee. The
              checksum-bound memory pack remains in the local offboarding
              receipt until you choose a successor.
            </p>
          </div>
        ) : null}

        <form
          action="/search"
          className="mt-8 flex flex-col gap-3 sm:flex-row"
          onSubmit={event => {
            const formData = new FormData(event.currentTarget);
            const query = String(formData.get("q") ?? "").trim();

            track("employee_searched", {
              query,
              source: "marketplace",
            });
          }}
        >
          <Input
            className="h-11 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
            defaultValue={handoffQuery}
            name="q"
            placeholder="Search roles, fields, tasks, or Macao"
          />
          <Button className="h-11 rounded-[8px] bg-[#F2EDE6] px-6 text-[#17120F] hover:bg-white">
            <Search className="size-4" />
            Search
          </Button>
        </form>

        <section className="mt-12">
          <SectionHeading
            eyebrow="Featured"
            title="Recommended employees"
            description="Platform picks for high-signal work: local research, product judgment, and code review."
          />
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {featuredEmployees.map(employee => (
              <EmployeeCard employee={employee} key={employee.employee_id} />
            ))}
          </div>
        </section>

        {savedEmployees.length > 0 ? (
          <section className="mt-12">
            <SectionHeading
              eyebrow="Saved"
              title="Saved employees"
              description="Employees you bookmarked before deciding who should join the crew."
            />
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {savedEmployees.map(employee => (
                <EmployeeCard employee={employee} key={employee.employee_id} />
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-12 rounded-[8px] border border-white/10 bg-white/[0.025] p-5">
            <div className="flex gap-3">
              <Heart className="mt-1 size-5 shrink-0 text-crew-copper" />
              <div>
                <h2 className="text-base font-semibold text-crew-heading">
                  Save employees before you hire
                </h2>
                <p className="mt-1 text-sm leading-6 text-crew-body">
                  Use the heart button on any resume card to build a shortlist
                  for your crew.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="mt-12">
          <SectionHeading
            eyebrow="Categories"
            title="Popular hiring lanes"
            description="Filter the marketplace by the kind of employee your team needs next."
          />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categoryLinks.map(category => {
              const count = categoryGroups[category.value]?.length ?? 0;

              return (
                <Link
                  className={cn(
                    "group flex min-h-24 flex-col justify-between rounded-[8px] border border-white/10 bg-white/[0.025] p-4 transition-colors hover:border-crew-copper/35 hover:bg-crew-copper/10",
                    count > 0 && "border-crew-copper/20"
                  )}
                  key={category.value}
                  to={`/search?category=${category.value}`}
                >
                  <span className="text-base text-crew-heading group-hover:text-white">
                    {category.label}
                  </span>
                  <span className="font-mono text-xs text-crew-muted">
                    {count} employee{count === 1 ? "" : "s"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-12">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              eyebrow="Browse"
              title="Employee bench"
              description="Every published employee includes a role, registry-backed evidence status, version, and pricing."
            />
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Sort
              </span>
              <Select
                onValueChange={value => {
                  if (!isEmployeeSort(value)) return;

                  setSortBy(value);
                  track("employee_sort_changed", {
                    sort: value,
                    source: "marketplace",
                  });
                }}
                value={sortBy}
              >
                <SelectTrigger className="h-10 min-w-36 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                  {EMPLOYEE_SORT_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {sortedEmployees.map(employee => (
              <EmployeeCard employee={employee} key={employee.employee_id} />
            ))}
          </div>
        </section>

        <section className="mt-12 pb-8">
          <SectionHeading
            eyebrow="Trusted"
            title="Lab-certified employees"
            description="Only employees with a registry-published, signed mock:false credential appear here. A validated package alone is C1, not certification."
          />
          {certifiedEmployees.length > 0 ? (
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {certifiedEmployees.map(employee => (
                <EmployeeCard
                  className="bg-[linear-gradient(180deg,rgba(200,121,65,0.08),rgba(255,255,255,0.025))]"
                  employee={employee}
                  key={employee.employee_id}
                  action={
                    <Button
                      asChild
                      className="w-full rounded-[8px] border-crew-copper/30 bg-crew-copper/10 text-crew-heading hover:bg-crew-copper/16 sm:w-auto"
                      variant="outline"
                    >
                      <Link to={`/employee/${employee.employee_id}`}>
                        <Trophy className="size-4" />
                        View
                      </Link>
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-[8px] border border-white/10 bg-white/[0.025] px-5 py-4 text-sm leading-6 text-crew-muted">
              No employee currently has a published signed lab credential.
              Validated C1 packages remain hireable for trial work, with their
              status shown explicitly.
            </p>
          )}
        </section>

        <div className="border-t border-white/10 py-8">
          <Button
            asChild
            className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/search">
              <Sparkles className="size-4" />
              Explore all employees
            </Link>
          </Button>
          <Button
            asChild
            className="ml-3 rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/metrics">
              <BarChart3 className="size-4" />
              Metrics
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
