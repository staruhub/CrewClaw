import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  BadgeCheck,
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
import type { Employee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useSavedEmployees } from "@/hooks/use-saved";
import { cn } from "@/lib/utils";

type EmployeeCardProps = {
  employee: Employee;
  action?: ReactNode;
  className?: string;
};

function formatPricing(pricing: string) {
  return pricing
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function EmployeeCard({
  employee,
  action,
  className,
}: EmployeeCardProps) {
  const saved = useSavedEmployees();
  const isSaved = saved.isSaved(employee.employee_id);

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
            employee_name: employee.name,
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
                {employee.name}
              </Link>
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-crew-muted">
              {employee.role}
            </CardDescription>
          </div>
          <CardAction className="static col-auto row-auto flex justify-self-auto">
            <div className="flex items-center gap-2">
              <Button
                aria-label={isSaved ? "Unsave employee" : "Save employee"}
                className={cn(
                  "size-9 rounded-[8px] border-white/15",
                  isSaved
                    ? "border-crew-copper/45 bg-crew-copper/10 text-crew-copper"
                    : "text-crew-muted hover:text-crew-heading"
                )}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  saved.toggleSaved(employee.employee_id, employee.name);
                }}
                title={isSaved ? "Saved" : "Save"}
                type="button"
                variant="outline"
              >
                <Heart className={cn("size-4", isSaved && "fill-current")} />
              </Button>
              <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
                <BadgeCheck className="size-3" />
                {employee.verified ? "Verified" : "Review"}
              </Badge>
            </div>
          </CardAction>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {employee.description}
        </p>

        {/* v0.18 Phase 2b: honest facts only. rating (4.8) / hire_count (1.2k) were fabricated —
            a bundled site has no eval/kpi data source. Show real registry facts instead. */}
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 font-mono text-xs text-crew-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-crew-copper" />
            {employee.certification}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Tag className="size-3.5 text-crew-copper" />v{employee.version}
          </span>
          <span className="min-w-0 truncate text-right text-crew-heading">
            {formatPricing(employee.pricing)}
          </span>
        </div>
      </CardContent>
      <CardFooter className="gap-3">
        {action ?? (
          <Button
            asChild
            className="w-full rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze sm:w-auto"
          >
            <Link to={`/employee/${employee.employee_id}`}>
              View
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
