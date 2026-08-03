import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Clock3,
  Heart,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type Employee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useSavedEmployees } from "@/hooks/use-saved";
import { useI18n, useMessages } from "@/i18n";
import { localizeEmployeeContent } from "@/i18n/employee-content";
import {
  acceptanceText,
  averageCostText,
  availabilityText,
  employeeEvidenceBadge,
  employeeEvidenceLevel,
  kpiStateText,
  runtimeText,
  taskCountText,
} from "@/i18n/marketplace-format";
import { marketplaceMessages } from "@/i18n/locales/marketplace";
import { cn } from "@/lib/utils";
import { useEmployeePerformance } from "./useEmployeePerformance";

type EmployeeCardProps = {
  employee: Employee;
  action?: ReactNode;
  className?: string;
  compareDisabled?: boolean;
  compareSelected?: boolean;
  onCompareToggle?: (employee: Employee) => void;
};

export function EmployeeCard({
  employee,
  action,
  className,
  compareDisabled = false,
  compareSelected = false,
  onCompareToggle,
}: EmployeeCardProps) {
  const { locale } = useI18n();
  const t = useMessages(marketplaceMessages);
  const displayEmployee = localizeEmployeeContent(employee, locale);
  const saved = useSavedEmployees();
  const isSaved = saved.isSaved(employee.employee_id);
  const performanceState = useEmployeePerformance(employee.employee_id);
  const performance = performanceState.performance;
  const runtime = runtimeText(employee, t);
  const kpiCopy = performanceState.loading
    ? t("loadingLocalKpiLong")
    : kpiStateText(performance, t);

  return (
    <Card
      className={cn(
        "h-full gap-4 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading shadow-[0_18px_54px_rgba(0,0,0,0.22)] transition-colors hover:border-crew-copper/35 hover:bg-white/[0.045]",
        className
      )}
      onClickCapture={event => {
        if (!(event.target instanceof Element)) return;

        const anchor = event.target.closest("a");
        if (
          anchor?.getAttribute("href") === `/employee/${employee.employee_id}`
        ) {
          track("employee_card_clicked", {
            employee_id: employee.employee_id,
            employee_name: displayEmployee.name,
          });
        }
      }}
    >
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-lg font-semibold leading-tight md:text-xl">
              <Link
                className="hover:text-crew-copper"
                to={`/employee/${employee.employee_id}`}
              >
                {displayEmployee.name}
              </Link>
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-crew-muted">
              {displayEmployee.role}
            </CardDescription>
          </div>
          <CardAction className="static col-auto row-auto flex justify-self-auto">
            <div className="flex items-center gap-2">
              <Button
                aria-label={isSaved ? t("unsaveEmployee") : t("saveEmployee")}
                className={cn(
                  "size-9 rounded-[8px] border-white/15",
                  isSaved
                    ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                    : "text-crew-muted hover:text-crew-heading"
                )}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  saved.toggleSaved(employee.employee_id, displayEmployee.name);
                }}
                title={isSaved ? t("saved") : t("save")}
                type="button"
                variant="outline"
              >
                <Heart className={cn("size-4", isSaved && "fill-current")} />
              </Button>
              <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                <BadgeCheck className="size-3" />
                {employeeEvidenceBadge(employee, t)}
              </Badge>
            </div>
          </CardAction>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            className="border-crew-copper/25 bg-crew-copper/[0.07] text-crew-body"
            title={t("growthStartTitle")}
            variant="outline"
          >
            {t("growthStart")}
          </Badge>
          <Badge
            className="border-white/10 bg-white/[0.04] text-crew-muted"
            title={availabilityText(employee, t)}
            variant="outline"
          >
            <Clock3 className="size-3" />
            {availabilityText(employee, t)}
          </Badge>
          {employee.tags.slice(0, 4).map(tag => (
            <Badge
              className="border-white/10 bg-white/[0.04] text-crew-muted"
              key={tag}
              variant="outline"
            >
              {tag}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="line-clamp-3 text-sm leading-6 text-crew-body">
          {displayEmployee.description}
        </p>

        {/* v0.18 Phase 2b: honest facts only. rating (4.8) / hire_count (1.2k) were fabricated —
            a bundled site has no eval/kpi data source. Show real registry facts instead. */}
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 font-mono text-xs text-crew-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-crew-copper" />
            {employeeEvidenceLevel(employee, t)}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Tag className="size-3.5 text-crew-copper" />v{employee.version}
          </span>
          <span className="min-w-0 truncate text-right text-crew-heading">
            {t("openSource")}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
            <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
              {t("formalTasks")}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-crew-heading">
              {performanceState.loading
                ? t("loading")
                : taskCountText(performance, t)}
            </dd>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
            <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
              {t("acceptance")}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-crew-heading">
              {performanceState.loading
                ? t("loading")
                : acceptanceText(performance, t)}
            </dd>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
            <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
              {t("avgCost")}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-crew-heading">
              {performanceState.loading
                ? t("loading")
                : averageCostText(performance, t)}
            </dd>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
            <dt className="font-mono uppercase tracking-[0.12em] text-crew-muted">
              {t("runtime")}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-crew-heading">
              {runtime.label}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-crew-muted">
          {t("cardKpiSummary", {
            kpi: kpiCopy,
            risk: runtime.highestRisk,
            runtimeDetail: runtime.detail,
          })}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        {onCompareToggle ? (
          <Button
            aria-pressed={compareSelected}
            className={cn(
              "rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading",
              compareSelected &&
                "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
            )}
            disabled={compareDisabled && !compareSelected}
            onClick={() => onCompareToggle(employee)}
            type="button"
            variant="outline"
          >
            {compareSelected ? <Check className="size-4" /> : null}
            {compareSelected ? t("compared") : t("compare")}
          </Button>
        ) : null}
        {action ?? (
          <Button
            asChild
            className="w-full rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze sm:w-auto"
          >
            <Link to={`/employee/${employee.employee_id}`}>
              {t("view")}
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
