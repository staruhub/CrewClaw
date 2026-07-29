import { Link, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  GitCompareArrows,
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
import {
  acceptanceLabel,
  availabilityLabel,
  averageCostLabel,
  EMPLOYEE_EVIDENCE_FILTERS,
  employeeMatchesEvidenceFilter,
  hireHandoffUrl,
  matchesEmployeeQuery,
  reputationLabel,
  runtimeSummary,
  taskCountLabel,
  type EmployeeEvidenceFilter,
} from "@/components/employee/employeeSignals";
import { useEmployeePerformance } from "@/components/employee/useEmployeePerformance";
import type { Employee } from "@/data/employees";

const categoryLinks = [
  { label: "All", value: "" },
  { label: "AI advisory", value: "ai-advisory" },
  { label: "Community", value: "community" },
  { label: "Engineering", value: "engineering" },
  { label: "Product", value: "product" },
  { label: "Research", value: "research" },
  { label: "Sales", value: "sales" },
  { label: "Operations", value: "operations" },
  { label: "Strategy", value: "strategy" },
  { label: "Local Expert", value: "local-expert" },
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

function CompareCell({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-t border-white/10 px-3 py-3 align-top text-sm text-crew-body">
      {children}
    </td>
  );
}

function CompareEmployeeColumn({ employee }: { employee: Employee }) {
  const { loading, performance } = useEmployeePerformance(employee.employee_id);
  const runtime = runtimeSummary(employee);

  return (
    <>
      <CompareCell>
        <Link
          className="font-medium text-crew-heading hover:text-crew-copper"
          to={`/employee/${employee.employee_id}`}
        >
          {employee.name}
        </Link>
        <p className="mt-1 text-xs text-crew-muted">
          {employee.identity.title}
        </p>
      </CompareCell>
      <CompareCell>{employee.certification}</CompareCell>
      <CompareCell>
        {loading ? "Loading local KPI" : taskCountLabel(performance)}
      </CompareCell>
      <CompareCell>
        {loading ? "Loading local KPI" : acceptanceLabel(performance)}
      </CompareCell>
      <CompareCell>
        {loading ? "Loading local KPI" : averageCostLabel(performance)}
      </CompareCell>
      <CompareCell>
        <span className="block text-crew-heading">{runtime.label}</span>
        <span className="text-xs text-crew-muted">{runtime.detail}</span>
      </CompareCell>
      <CompareCell>{availabilityLabel(employee)}</CompareCell>
      <CompareCell>{reputationLabel(performance)}</CompareCell>
      <CompareCell>
        <Button
          asChild
          className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
        >
          <Link to={hireHandoffUrl(employee, "marketplace_compare")}>Hire</Link>
        </Button>
      </CompareCell>
    </>
  );
}

function MarketplaceConsoleRow({ employee }: { employee: Employee }) {
  const { performance } = useEmployeePerformance(employee.employee_id);
  const runtime = runtimeSummary(employee);
  const hasLocalPerformance = performance?.kpi.state === "available";

  return (
    <Link
      className="grid grid-cols-[1.35fr_1.2fr_0.72fr_0.8fr_0.72fr_0.95fr] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 font-mono text-[11px] text-crew-body transition-colors hover:bg-crew-copper/[0.06] hover:text-crew-heading"
      to={`/employee/${employee.employee_id}`}
    >
      <span className="min-w-0 truncate font-semibold text-crew-copper">
        {employee.name}
      </span>
      <span className="min-w-0 truncate text-crew-muted">
        {employee.identity.title}
      </span>
      <span>
        {hasLocalPerformance
          ? taskCountLabel(performance)
          : `${employee.demo_tasks.length} demos`}
      </span>
      <span className="text-emerald-300">
        {hasLocalPerformance ? acceptanceLabel(performance) : "no ledger"}
      </span>
      <span>
        {hasLocalPerformance ? averageCostLabel(performance) : employee.pricing}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span>{runtime.label}</span>
        <span className="text-emerald-300" aria-hidden="true">
          {"▮".repeat(
            Math.min(4, runtime.runtimeReady + runtime.engineService)
          )}
          {"▯".repeat(
            Math.max(
              0,
              4 - Math.min(4, runtime.runtimeReady + runtime.engineService)
            )
          )}
        </span>
      </span>
    </Link>
  );
}

function ComparePanel({
  employees,
  onClear,
}: {
  employees: Employee[];
  onClear: () => void;
}) {
  return (
    <section className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-crew-copper">
            Compare
          </p>
          <h2 className="mt-2 text-xl font-light text-crew-heading">
            Evidence-backed shortlist
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-crew-body">
            Select two or three employees to compare package evidence, runtime
            readiness, receipt-backed KPI data, permission risk, and hiring
            availability without leaving the marketplace.
          </p>
        </div>
        <Button
          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
          onClick={onClear}
          type="button"
          variant="outline"
        >
          Clear
        </Button>
      </div>
      {employees.length < 2 ? (
        <p className="mt-5 rounded-[8px] border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-crew-muted">
          Add at least one more employee. Comparison starts at two and stops at
          three so the table remains readable.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[920px] w-full border-collapse">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-crew-muted">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Cert</th>
                <th className="px-3 py-2">Tasks</th>
                <th className="px-3 py-2">Acceptance</th>
                <th className="px-3 py-2">Avg cost</th>
                <th className="px-3 py-2">Runtime</th>
                <th className="px-3 py-2">Availability</th>
                <th className="px-3 py-2">Reputation</th>
                <th className="px-3 py-2">Next</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(employee => (
                <tr key={employee.employee_id}>
                  <CompareEmployeeColumn employee={employee} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort");
  const categoryParam = searchParams.get("category") ?? "";
  const evidenceParam = searchParams.get("evidence");
  const queryParam = searchParams.get("q") ?? "";
  const [sortBy, setSortBy] = useState<EmployeeSort>(
    isEmployeeSort(sortParam) ? sortParam : "recommended"
  );
  const selectedEvidence: EmployeeEvidenceFilter =
    EMPLOYEE_EVIDENCE_FILTERS.some(option => option.value === evidenceParam)
      ? (evidenceParam as EmployeeEvidenceFilter)
      : "all";
  const [compareIds, setCompareIds] = useState<string[]>([]);
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
  const sortedEmployees = useMemo(() => {
    const categoryIds = categoryParam
      ? new Set(byCategory(categoryParam).map(employee => employee.employee_id))
      : null;
    const filtered = availableEmployees.filter(employee => {
      const categoryMatch =
        !categoryIds || categoryIds.has(employee.employee_id);
      return (
        categoryMatch &&
        matchesEmployeeQuery(employee, queryParam) &&
        employeeMatchesEvidenceFilter(employee, selectedEvidence)
      );
    });

    return sortEmployees(filtered, sortBy);
  }, [categoryParam, queryParam, selectedEvidence, sortBy]);
  const savedEmployees = useMemo(() => {
    const savedIds = new Set(saved.savedIds);
    return sortedEmployees.filter(employee =>
      savedIds.has(employee.employee_id)
    );
  }, [saved.savedIds, sortedEmployees]);
  const comparedEmployees = compareIds
    .map(id => availableEmployees.find(employee => employee.employee_id === id))
    .filter((employee): employee is Employee => Boolean(employee));

  function setMarketplaceParams(next: {
    category?: string;
    evidence?: EmployeeEvidenceFilter;
    query?: string;
    sort?: EmployeeSort;
  }) {
    const params: Record<string, string> = {};
    const query = next.query ?? queryParam;
    const category = next.category ?? categoryParam;
    const evidence = next.evidence ?? selectedEvidence;
    const sort = next.sort ?? sortBy;

    if (query) params.q = query;
    if (category) params.category = category;
    if (evidence !== "all") params.evidence = evidence;
    if (sort !== "recommended") params.sort = sort;
    if (handoffFrom) params.handoff_from = handoffFrom;
    setSearchParams(params);
  }

  function toggleCompare(employee: Employee) {
    setCompareIds(current => {
      if (current.includes(employee.employee_id)) {
        return current.filter(id => id !== employee.employee_id);
      }
      if (current.length >= 3) return current;
      return [...current, employee.employee_id];
    });
  }

  useEffect(() => {
    track("marketplace_viewed", {
      employee_count: availableEmployees.length,
    });
  }, []);

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-10 lg:py-7">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 border-b border-white/10 pb-10 md:flex-row md:items-end md:justify-between lg:gap-5 lg:pb-5">
          <div className="max-w-2xl lg:max-w-none">
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <Users className="size-3" />
              AI Employee Marketplace
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl lg:mt-3 lg:whitespace-nowrap lg:text-4xl">
              Browse agents like candidates.
            </h1>
            <p className="mt-5 text-base leading-7 text-crew-body lg:mt-2">
              Discover, compare, hire, and manage AI employees like real
              teammates.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:gap-1">
            <Button
              asChild
              className="rounded-[8px] border-white/15 lg:h-7 lg:border-transparent lg:px-2 lg:font-mono lg:text-[10px]"
              variant="outline"
            >
              <Link to="/crew">
                <Users className="size-4" />
                Crew Mode
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 lg:h-7 lg:border-transparent lg:px-2 lg:font-mono lg:text-[10px]"
              variant="outline"
            >
              <Link to="/performance">
                <BarChart3 className="size-4" />
                Performance
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 lg:h-7 lg:border-transparent lg:px-2 lg:font-mono lg:text-[10px]"
              variant="outline"
            >
              <Link to="/creator">Submit</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15 lg:h-7 lg:border-transparent lg:px-2 lg:font-mono lg:text-[10px]"
              variant="outline"
            >
              <Link to="/review">Review</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze lg:h-7 lg:px-2 lg:font-mono lg:text-[10px]"
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
          className="mt-8 flex flex-col gap-3 sm:flex-row lg:hidden"
          onSubmit={event => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const query = String(formData.get("q") ?? "").trim();

            setMarketplaceParams({ query });
            track("employee_searched", {
              query,
              source: "marketplace",
            });
          }}
        >
          <Input
            className="h-11 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
            defaultValue={queryParam || handoffQuery}
            key={queryParam || handoffQuery}
            name="q"
            placeholder="Search roles, fields, tasks, or Macao"
          />
          <Button className="h-11 rounded-[8px] bg-[#F2EDE6] px-6 text-[#17120F] hover:bg-white">
            <Search className="size-4" />
            Search
          </Button>
        </form>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_220px] lg:hidden">
          <Select
            onValueChange={value =>
              setMarketplaceParams({ category: value === "all" ? "" : value })
            }
            value={categoryParam || "all"}
          >
            <SelectTrigger className="h-10 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
              {categoryLinks.map(category => (
                <SelectItem
                  key={category.value || "all"}
                  value={category.value || "all"}
                >
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={value =>
              setMarketplaceParams({
                evidence: value as EmployeeEvidenceFilter,
              })
            }
            value={selectedEvidence}
          >
            <SelectTrigger className="h-10 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading">
              <SelectValue placeholder="Evidence" />
            </SelectTrigger>
            <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
              {EMPLOYEE_EVIDENCE_FILTERS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            asChild
            className="h-10 rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
            variant="outline"
          >
            <Link to="/marketplace">Reset filters</Link>
          </Button>
        </div>

        {compareIds.length > 0 ? (
          <ComparePanel
            employees={comparedEmployees}
            onClear={() => setCompareIds([])}
          />
        ) : null}

        <section className="mt-8 hidden overflow-hidden rounded-[3px] border border-white/10 bg-[#0a0909] shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:mt-4 lg:block">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.025] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-crew-muted">
            <span className="flex items-center gap-2">
              <span className="text-red-400">●</span>
              <span className="text-amber-300">●</span>
              <span className="text-emerald-400">●</span>
              CrewClaw marketplace
            </span>
            <span className="flex items-center gap-3">
              <label className="flex items-center gap-1.5">
                <span>category:</span>
                <select
                  aria-label="Marketplace category"
                  className="bg-transparent text-crew-heading outline-none"
                  onChange={event =>
                    setMarketplaceParams({
                      category:
                        event.target.value === "all" ? "" : event.target.value,
                    })
                  }
                  value={categoryParam || "all"}
                >
                  {categoryLinks.map(category => (
                    <option
                      className="bg-[#17120f]"
                      key={category.value || "all"}
                      value={category.value || "all"}
                    >
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span>evidence:</span>
                <select
                  aria-label="Marketplace evidence"
                  className="bg-transparent text-crew-heading outline-none"
                  onChange={event =>
                    setMarketplaceParams({
                      evidence: event.target.value as EmployeeEvidenceFilter,
                    })
                  }
                  value={selectedEvidence}
                >
                  {EMPLOYEE_EVIDENCE_FILTERS.map(option => (
                    <option
                      className="bg-[#17120f]"
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </span>
          </div>
          <form
            className="flex items-center border-b border-white/10 px-4 font-mono text-xs text-crew-muted"
            onSubmit={event => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const query = String(formData.get("q") ?? "").trim();
              setMarketplaceParams({ query });
              track("employee_searched", {
                query,
                source: "marketplace_console",
              });
            }}
          >
            <span aria-hidden="true">/</span>
            <Input
              aria-label="Search digital employees"
              className="h-10 flex-1 border-0 bg-transparent px-2 font-mono text-xs text-crew-heading shadow-none placeholder:text-crew-muted focus-visible:ring-0"
              defaultValue={queryParam || handoffQuery}
              key={`console-${queryParam || handoffQuery}`}
              name="q"
              placeholder="search digital employees…"
            />
            <Button
              className="h-7 rounded-[3px] border border-crew-copper/40 bg-transparent px-3 font-mono text-[10px] text-crew-copper hover:bg-crew-copper/10"
              type="submit"
            >
              run ↵
            </Button>
          </form>
          <div className="grid grid-cols-[1.35fr_1.2fr_0.72fr_0.8fr_0.72fr_0.95fr] gap-3 border-b border-white/10 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-crew-muted">
            <span>Employee</span>
            <span>Role</span>
            <span>Tasks / demos</span>
            <span>Field KPI</span>
            <span>Pricing</span>
            <span>Runtime</span>
          </div>
          {sortedEmployees.slice(0, 5).map(employee => (
            <MarketplaceConsoleRow
              employee={employee}
              key={employee.employee_id}
            />
          ))}
          <div className="flex items-center justify-between px-4 py-3 font-mono text-[10px] text-crew-muted">
            <span>
              {sortedEmployees.length} published · receipt-backed fields stay
              unavailable until local work exists
            </span>
            <span className="text-crew-copper">$ crewclaw market --open →</span>
          </div>
        </section>

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
              const count = category.value
                ? (categoryGroups[category.value]?.length ?? 0)
                : availableEmployees.length;

              return (
                <Link
                  className={cn(
                    "group flex min-h-24 flex-col justify-between rounded-[8px] border border-white/10 bg-white/[0.025] p-4 transition-colors hover:border-crew-copper/35 hover:bg-crew-copper/10",
                    count > 0 && "border-crew-copper/20"
                  )}
                  key={category.value}
                  to={
                    category.value
                      ? `/marketplace?category=${category.value}`
                      : "/marketplace"
                  }
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
                  setMarketplaceParams({ sort: value });
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
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-crew-muted">
            <GitCompareArrows className="size-4 text-crew-copper" />
            <span>
              {sortedEmployees.length} employee
              {sortedEmployees.length === 1 ? "" : "s"} match the current
              marketplace filters. Select 2-3 Compare buttons for an in-page
              decision table.
            </span>
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {sortedEmployees.map(employee => (
              <EmployeeCard
                compareDisabled={
                  compareIds.length >= 3 &&
                  !compareIds.includes(employee.employee_id)
                }
                compareSelected={compareIds.includes(employee.employee_id)}
                employee={employee}
                key={employee.employee_id}
                onCompareToggle={toggleCompare}
              />
            ))}
          </div>
          {sortedEmployees.length === 0 ? (
            <div className="mt-6 rounded-[8px] border border-white/10 bg-white/[0.03] p-6">
              <p className="text-lg font-light text-crew-heading">
                No employees match those filters
              </p>
              <p className="mt-2 text-sm leading-6 text-crew-body">
                Try all evidence levels or a broader role/task query. The empty
                state is based on the generated registry projection only.
              </p>
            </div>
          ) : null}
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
