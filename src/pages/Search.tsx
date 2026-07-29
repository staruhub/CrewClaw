import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { GitCompareArrows, SearchIcon, SlidersHorizontal } from "lucide-react";
import { EmployeeCard } from "@/components/employee/EmployeeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  availableEmployees,
  byCategory,
  type Employee,
} from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import {
  EMPLOYEE_SORT_OPTIONS,
  isEmployeeSort,
  sortEmployees,
} from "@/lib/employee-sort";
import { cn } from "@/lib/utils";
import {
  acceptanceLabel,
  averageCostLabel,
  EMPLOYEE_EVIDENCE_FILTERS,
  employeeMatchesEvidenceFilter,
  hireHandoffUrl,
  matchesEmployeeQuery,
  runtimeSummary,
  taskCountLabel,
  type EmployeeEvidenceFilter,
} from "@/components/employee/employeeSignals";
import { useEmployeePerformance } from "@/components/employee/useEmployeePerformance";

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

function toSearchUrl(
  query: string,
  category: string,
  sort: string,
  evidence: EmployeeEvidenceFilter
) {
  const params = new URLSearchParams();

  if (query) params.set("q", query);
  if (category) params.set("category", category);
  if (sort !== "recommended") params.set("sort", sort);
  if (evidence !== "all") params.set("evidence", evidence);

  const value = params.toString();
  return value ? `/search?${value}` : "/search";
}

function SearchCompareRow({ employee }: { employee: Employee }) {
  const { loading, performance } = useEmployeePerformance(employee.employee_id);
  const runtime = runtimeSummary(employee);

  return (
    <article className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="text-base font-semibold text-crew-heading hover:text-crew-copper"
            to={`/employee/${employee.employee_id}`}
          >
            {employee.name}
          </Link>
          <p className="mt-1 text-sm text-crew-muted">{employee.role}</p>
        </div>
        <Button
          asChild
          className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
        >
          <Link to={hireHandoffUrl(employee, "search_compare")}>Hire</Link>
        </Button>
      </div>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            Tasks
          </dt>
          <dd className="mt-1 text-crew-heading">
            {loading ? "Loading" : taskCountLabel(performance)}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            Acceptance
          </dt>
          <dd className="mt-1 text-crew-heading">
            {loading ? "Loading" : acceptanceLabel(performance)}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            Cost
          </dt>
          <dd className="mt-1 text-crew-heading">
            {loading ? "Loading" : averageCostLabel(performance)}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            Runtime
          </dt>
          <dd className="mt-1 text-crew-heading">{runtime.label}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const selectedCategory = searchParams.get("category") ?? "";
  const sortParam = searchParams.get("sort");
  const selectedSort = isEmployeeSort(sortParam) ? sortParam : "recommended";
  const evidenceParam = searchParams.get("evidence");
  const selectedEvidence: EmployeeEvidenceFilter =
    EMPLOYEE_EVIDENCE_FILTERS.some(option => option.value === evidenceParam)
      ? (evidenceParam as EmployeeEvidenceFilter)
      : "all";
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const results = useMemo(() => {
    const categoryIds = selectedCategory
      ? new Set(byCategory(selectedCategory).map(item => item.employee_id))
      : null;
    const filtered = availableEmployees.filter(employee => {
      const categoryMatch =
        !categoryIds || categoryIds.has(employee.employee_id);
      return (
        categoryMatch &&
        matchesEmployeeQuery(employee, initialQuery) &&
        employeeMatchesEvidenceFilter(employee, selectedEvidence)
      );
    });

    return sortEmployees(filtered, selectedSort);
  }, [initialQuery, selectedCategory, selectedEvidence, selectedSort]);
  const comparedEmployees = compareIds
    .map(id => availableEmployees.find(employee => employee.employee_id === id))
    .filter((employee): employee is Employee => Boolean(employee));

  function nextParams(overrides: {
    category?: string;
    evidence?: EmployeeEvidenceFilter;
    query?: string;
    sort?: string;
  }) {
    const params: Record<string, string> = {};
    const query = overrides.query ?? initialQuery;
    const category = overrides.category ?? selectedCategory;
    const evidence = overrides.evidence ?? selectedEvidence;
    const sort = overrides.sort ?? selectedSort;

    if (query) params.q = query;
    if (category) params.category = category;
    if (evidence !== "all") params.evidence = evidence;
    if (sort !== "recommended") params.sort = sort;
    return params;
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
    if (!initialQuery && !selectedCategory && selectedEvidence === "all")
      return;

    track("employee_searched", {
      category: selectedCategory || null,
      evidence: selectedEvidence,
      query: initialQuery,
      result_count: results.length,
      source: "search",
    });
  }, [initialQuery, results.length, selectedCategory, selectedEvidence]);

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-14">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-crew-muted">
              Search Results
            </p>
            <h1 className="mt-3 text-3xl font-light md:text-5xl">
              Find your next AI employee
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-crew-body">
              Search by role, field, task, category, or local expertise before
              you hire.
            </p>
          </div>
          <Button asChild className="rounded-[8px]" variant="outline">
            <Link to="/marketplace">Marketplace</Link>
          </Button>
        </div>

        <form
          className="mt-8 flex flex-col gap-3 sm:flex-row"
          onSubmit={event => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const nextParams: Record<string, string> = {};
            const trimmed = String(formData.get("q") ?? "").trim();

            if (trimmed) nextParams.q = trimmed;
            if (selectedCategory) nextParams.category = selectedCategory;
            if (selectedEvidence !== "all")
              nextParams.evidence = selectedEvidence;
            if (selectedSort !== "recommended") nextParams.sort = selectedSort;

            setSearchParams(nextParams);
          }}
        >
          <Input
            className="h-11 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
            defaultValue={initialQuery}
            key={initialQuery}
            name="q"
            placeholder="Try Macao, research, PRD, review"
          />
          <Button className="h-11 rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze">
            <SearchIcon className="size-4" />
            Search
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-crew-muted">
              <SlidersHorizontal className="size-3.5" />
              Category
            </span>
            {categoryLinks.map(category => (
              <Button
                asChild
                className={cn(
                  "h-9 rounded-[8px] border-white/10 px-3 text-xs",
                  selectedCategory === category.value
                    ? "border-crew-copper/40 bg-crew-copper/12 text-crew-heading"
                    : "text-crew-muted hover:text-crew-heading"
                )}
                key={category.value || "all"}
                variant="outline"
              >
                <Link
                  to={toSearchUrl(
                    initialQuery,
                    category.value,
                    selectedSort,
                    selectedEvidence
                  )}
                >
                  {category.label}
                </Link>
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Evidence
              </span>
              <Select
                onValueChange={value =>
                  setSearchParams(
                    nextParams({
                      evidence: value as EmployeeEvidenceFilter,
                    })
                  )
                }
                value={selectedEvidence}
              >
                <SelectTrigger className="h-10 min-w-44 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                  {EMPLOYEE_EVIDENCE_FILTERS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                Sort
              </span>
              <Select
                onValueChange={value => {
                  if (!isEmployeeSort(value)) return;

                  setSearchParams(nextParams({ sort: value }));
                  track("employee_sort_changed", {
                    sort: value,
                    source: "search",
                  });
                }}
                value={selectedSort}
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
        </div>

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-crew-muted">
            {results.length} employee{results.length === 1 ? "" : "s"} found
            {initialQuery ? ` for "${initialQuery}"` : ""}
            {selectedCategory ? ` in ${selectedCategory}` : ""}
            {selectedEvidence !== "all" ? ` with ${selectedEvidence}` : ""}.
          </p>
          {(initialQuery || selectedCategory || selectedEvidence !== "all") && (
            <Link
              className="text-sm text-crew-copper hover:text-crew-heading"
              to="/search"
            >
              Clear search
            </Link>
          )}
        </div>

        {compareIds.length > 0 ? (
          <section className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <GitCompareArrows className="mt-1 size-5 shrink-0 text-crew-copper" />
                <div>
                  <h2 className="text-lg font-light text-crew-heading">
                    Search comparison
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-crew-body">
                    Compare two or three results using registry fields and
                    receipt-backed local KPI data when it exists.
                  </p>
                </div>
              </div>
              <Button
                className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                onClick={() => setCompareIds([])}
                type="button"
                variant="outline"
              >
                Clear
              </Button>
            </div>
            <div className="mt-5 grid gap-3">
              {comparedEmployees.length < 2 ? (
                <p className="rounded-[8px] border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-crew-muted">
                  Add at least one more employee to compare.
                </p>
              ) : (
                comparedEmployees.map(employee => (
                  <SearchCompareRow
                    employee={employee}
                    key={employee.employee_id}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        {results.length > 0 ? (
          <section className="mt-8 grid gap-5 md:grid-cols-3">
            {results.map(employee => (
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
          </section>
        ) : (
          <section className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.03] p-8">
            <p className="text-xl font-light text-crew-heading">
              No employees found
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
              Try a broader role, task, or category. Macao, research, review,
              and PRD all match available employees.
            </p>
            <Button
              asChild
              className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/marketplace">Back to marketplace</Link>
            </Button>
          </section>
        )}
      </section>
    </main>
  );
}
