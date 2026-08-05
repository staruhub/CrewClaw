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
import { useI18n, useMessages } from "@/i18n";
import { localizeEmployees } from "@/i18n/employee-content";
import {
  availabilityText,
  categoryLabel,
  evidenceFilterLabel,
  type MarketplaceT,
  runtimeText,
} from "@/i18n/marketplace-format";
import {
  marketplaceMessages,
  type MarketplaceMessageKey,
} from "@/i18n/locales/marketplace";
import {
  EMPLOYEE_SORT_OPTIONS,
  isEmployeeSort,
  sortEmployees,
} from "@/lib/employee-sort";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_EVIDENCE_FILTERS,
  employeeMatchesEvidenceFilter,
  hireHandoffUrl,
  matchesEmployeeQuery,
  type EmployeeEvidenceFilter,
} from "@/components/employee/employeeSignals";

const categoryLinks = [
  { value: "" },
  { value: "ai-advisory" },
  { value: "community" },
  { value: "engineering" },
  { value: "product" },
  { value: "research" },
  { value: "sales" },
  { value: "operations" },
  { value: "strategy" },
  { value: "local-expert" },
  { value: "marketing" },
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

function SearchCompareRow({
  employee,
  t,
}: {
  employee: Employee;
  t: MarketplaceT;
}) {
  const runtime = runtimeText(employee, t);

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
          <Link to={hireHandoffUrl(employee, "search_compare")}>
            {t("hire")}
          </Link>
        </Button>
      </div>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            {t("demoTasks")}
          </dt>
          <dd className="mt-1 text-crew-heading">
            {employee.demo_tasks.length}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            {t("runtime")}
          </dt>
          <dd className="mt-1 text-crew-heading">{runtime.label}</dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            {t("availability")}
          </dt>
          <dd className="mt-1 text-crew-heading">
            {availabilityText(employee, t)}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
            {t("license")}
          </dt>
          <dd className="mt-1 text-crew-heading">Apache-2.0</dd>
        </div>
      </dl>
    </article>
  );
}

export default function Search() {
  const { locale } = useI18n();
  const t = useMessages(marketplaceMessages);
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
  const localizedAvailableEmployees = useMemo(
    () => localizeEmployees(availableEmployees, locale),
    [locale]
  );
  const results = useMemo(() => {
    const categoryIds = selectedCategory
      ? new Set(byCategory(selectedCategory).map(item => item.employee_id))
      : null;
    const filtered = localizedAvailableEmployees.filter(employee => {
      const categoryMatch =
        !categoryIds || categoryIds.has(employee.employee_id);
      return (
        categoryMatch &&
        matchesEmployeeQuery(employee, initialQuery) &&
        employeeMatchesEvidenceFilter(employee, selectedEvidence)
      );
    });

    return sortEmployees(filtered, selectedSort);
  }, [
    initialQuery,
    localizedAvailableEmployees,
    selectedCategory,
    selectedEvidence,
    selectedSort,
  ]);
  const comparedEmployees = compareIds
    .map(id =>
      localizedAvailableEmployees.find(employee => employee.employee_id === id)
    )
    .filter((employee): employee is Employee => Boolean(employee));
  const resultSummary = t(
    results.length === 1 ? "searchResultsOne" : "searchResultsMany",
    {
      category: selectedCategory
        ? t("searchResultsCategory", {
            category: categoryLabel(selectedCategory, t),
          })
        : "",
      count: results.length,
      evidence:
        selectedEvidence !== "all"
          ? t("searchResultsEvidence", {
              evidence: evidenceFilterLabel(selectedEvidence, t),
            })
          : "",
      query: initialQuery
        ? t("searchResultsQuery", { query: initialQuery })
        : "",
    }
  );

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
              {t("searchEyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-light md:text-5xl">
              {t("searchTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-crew-body">
              {t("searchDescription")}
            </p>
          </div>
          <Button asChild className="rounded-[8px]" variant="outline">
            <Link to="/marketplace">{t("marketplace")}</Link>
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
            placeholder={t("searchPlaceholder")}
          />
          <Button className="h-11 rounded-[8px] bg-crew-copper px-6 text-white hover:bg-crew-bronze">
            <SearchIcon className="size-4" />
            {t("search")}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-crew-muted">
              <SlidersHorizontal className="size-3.5" />
              {t("category")}
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
                  {categoryLabel(category.value, t)}
                </Link>
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                {t("evidence")}
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
                      {evidenceFilterLabel(option.value, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
                {t("sort")}
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
                      {t(option.labelKey as MarketplaceMessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-crew-muted">{resultSummary}</p>
          {(initialQuery || selectedCategory || selectedEvidence !== "all") && (
            <Link
              className="text-sm text-crew-copper hover:text-crew-heading"
              to="/search"
            >
              {t("clearSearch")}
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
                    {t("searchComparisonTitle")}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-crew-body">
                    {t("searchComparisonDescription")}
                  </p>
                </div>
              </div>
              <Button
                className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                onClick={() => setCompareIds([])}
                type="button"
                variant="outline"
              >
                {t("clear")}
              </Button>
            </div>
            <div className="mt-5 grid gap-3">
              {comparedEmployees.length < 2 ? (
                <p className="rounded-[8px] border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-crew-muted">
                  {t("searchCompareNeedMore")}
                </p>
              ) : (
                comparedEmployees.map(employee => (
                  <SearchCompareRow
                    employee={employee}
                    key={employee.employee_id}
                    t={t}
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
              {t("noSearchResultsTitle")}
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
              {t("noSearchResultsDescription")}
            </p>
            <Button
              asChild
              className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/marketplace">{t("backToMarketplace")}</Link>
            </Button>
          </section>
        )}
      </section>
    </main>
  );
}
