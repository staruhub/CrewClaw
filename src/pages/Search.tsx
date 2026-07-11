import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { SearchIcon, SlidersHorizontal } from "lucide-react";
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
import { byCategory, searchEmployees } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import {
  EMPLOYEE_SORT_OPTIONS,
  isEmployeeSort,
  sortEmployees,
} from "@/lib/employee-sort";
import { cn } from "@/lib/utils";

const categoryLinks = [
  { label: "All", value: "" },
  { label: "Research", value: "research" },
  { label: "Sales", value: "sales" },
  { label: "Operations", value: "operations" },
  { label: "Coding", value: "coding" },
  { label: "Local Expert", value: "local-expert" },
  { label: "Customer Support", value: "customer-support" },
  { label: "Marketing", value: "marketing" },
];

function toSearchUrl(query: string, category: string, sort: string) {
  const params = new URLSearchParams();

  if (query) params.set("q", query);
  if (category) params.set("category", category);
  if (sort !== "recommended") params.set("sort", sort);

  const value = params.toString();
  return value ? `/search?${value}` : "/search";
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const selectedCategory = searchParams.get("category") ?? "";
  const sortParam = searchParams.get("sort");
  const selectedSort = isEmployeeSort(sortParam) ? sortParam : "recommended";
  const results = useMemo(() => {
    const byQuery = searchEmployees(initialQuery);
    const categoryIds = selectedCategory
      ? new Set(byCategory(selectedCategory).map(item => item.employee_id))
      : null;
    const filtered = categoryIds
      ? byQuery.filter(employee => categoryIds.has(employee.employee_id))
      : byQuery;

    return sortEmployees(filtered, selectedSort);
  }, [initialQuery, selectedCategory, selectedSort]);

  useEffect(() => {
    if (!initialQuery && !selectedCategory) return;

    track("employee_searched", {
      category: selectedCategory || null,
      query: initialQuery,
      result_count: results.length,
      source: "search",
    });
  }, [initialQuery, results.length, selectedCategory]);

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
                  to={toSearchUrl(initialQuery, category.value, selectedSort)}
                >
                  {category.label}
                </Link>
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
              Sort
            </span>
            <Select
              onValueChange={value => {
                if (!isEmployeeSort(value)) return;

                const nextParams: Record<string, string> = {};
                if (initialQuery) nextParams.q = initialQuery;
                if (selectedCategory) nextParams.category = selectedCategory;
                if (value !== "recommended") nextParams.sort = value;
                setSearchParams(nextParams);
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

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-crew-muted">
            {results.length} employee{results.length === 1 ? "" : "s"} found
            {initialQuery ? ` for "${initialQuery}"` : ""}
            {selectedCategory ? ` in ${selectedCategory}` : ""}.
          </p>
          {(initialQuery || selectedCategory) && (
            <Link
              className="text-sm text-crew-copper hover:text-crew-heading"
              to="/search"
            >
              Clear search
            </Link>
          )}
        </div>

        {results.length > 0 ? (
          <section className="mt-8 grid gap-5 md:grid-cols-3">
            {results.map(employee => (
              <EmployeeCard employee={employee} key={employee.employee_id} />
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
