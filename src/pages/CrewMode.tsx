import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Copy,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { getEmployee, type Employee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";
import { cn } from "@/lib/utils";

type CrewContribution = {
  employee: Employee;
  focus: string;
  output: string;
  handoff: string;
};

function commandBrief(brief: string) {
  const normalized = brief.trim().replace(/\s+/g, " ");
  return (normalized || "Plan a useful first task for this AI crew.").replace(/"/g, "'");
}

function buildContribution(employee: Employee, brief: string, index: number): CrewContribution {
  const topSkills = employee.skills.slice(0, 2).map((skill) => skill.replaceAll("-", " "));
  const role = employee.role.toLowerCase();
  const focus =
    role.includes("code")
      ? "Review the implementation path, risks, and merge conditions."
      : role.includes("product")
        ? "Turn the brief into acceptance criteria, edge cases, and launch signals."
        : role.includes("network")
          ? "Map public context, local entry points, and human-reviewed outreach angles."
          : "Own one workstream and return a concise teammate-ready update.";

  return {
    employee,
    focus,
    output: `${employee.name} uses ${topSkills.join(" + ")} to advance: ${brief || employee.first_task}`,
    handoff: `Workstream ${index + 1} returns blockers, next actions, and a clean handoff for the crew lead.`,
  };
}

export default function CrewMode() {
  const { list } = useTeam();
  const employees = useMemo(
    () =>
      list()
        .filter((workspaceEmployee) => workspaceEmployee.status === "active")
        .map((workspaceEmployee) => getEmployee(workspaceEmployee.employee_id))
        .filter((employee): employee is Employee => Boolean(employee)),
    [list],
  );
  const [brief, setBrief] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [planVersion, setPlanVersion] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    track("team_viewed", {
      source: "crew_mode",
      active_employee_count: employees.length,
    });
  }, [employees.length]);

  // 不再用 effect 修剪 selectedIds（setState-in-effect 触发级联渲染）：selectedEmployees 本身
  // 就按现存员工过滤，凡是消费"有效选择"的地方都用它派生——失效 id 留在原始 state 里无副作用。
  const selectedEmployees = useMemo(
    () => employees.filter((employee) => selectedIds.includes(employee.employee_id)),
    [employees, selectedIds],
  );
  const contributions = useMemo(
    () => selectedEmployees.map((employee, index) => buildContribution(employee, brief, index)),
    [brief, selectedEmployees],
  );
  const cliCommand = `crew standup "${commandBrief(brief)}"`;
  const canGenerate = selectedEmployees.length > 0 && brief.trim().length > 0;

  function toggleEmployee(employeeId: string, checked: boolean) {
    setPlanVersion(0);
    setSelectedIds((current) =>
      checked ? [...current, employeeId] : current.filter((id) => id !== employeeId),
    );
  }

  function generatePlan() {
    if (!canGenerate) return;

    for (const employee of selectedEmployees) {
      track("doctor_started", {
        employee_id: employee.employee_id,
        source: "crew_mode",
        task_brief_length: brief.trim().length,
      });
      track("doctor_completed", {
        employee_id: employee.employee_id,
        source: "crew_mode",
        issue_count: 1,
        suggestion_count: 1,
      });
    }

    setCopied(false);
    setPlanVersion((current) => current + 1);
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    track("demo_task_copied", {
      source: "crew_mode",
      // 派生的有效选择（不含已下架员工的失效 id）。
      selected_employee_ids: selectedEmployees.map((e) => e.employee_id),
    });
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6 md:py-14">
      <section className="mx-auto max-w-6xl">
        <Button
          asChild
          className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
          variant="outline"
        >
          <Link to="/marketplace">
            <ArrowLeft className="size-4" />
            Marketplace
          </Link>
        </Button>

        <div className="mt-8 flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <Users className="size-3" />
              Crew Mode
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Put multiple AI employees on one task
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Select teammates who have joined your crew, write the assignment, and preview how
              they will divide the work before running the real CLI crew.
            </p>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
              Active employees
            </p>
            <p className="mt-2 text-3xl font-semibold text-crew-heading">{employees.length}</p>
          </div>
        </div>

        {employees.length === 0 ? (
          <section className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold text-crew-heading">Hire employees first</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-crew-body">
              Crew Mode only assigns active employees. Hire at least two employees, then come back
              to run a multi-teammate standup.
            </p>
            <Button className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze" asChild>
              <Link to="/marketplace">Browse employees</Link>
            </Button>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                    Team roster
                  </p>
                  <h2 className="mt-2 text-2xl font-light text-crew-heading">
                    Choose who joins this standup
                  </h2>
                </div>
                <div className="grid gap-3">
                  {employees.map((employee) => {
                    const checked = selectedIds.includes(employee.employee_id);

                    return (
                      <label
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-4 transition-colors",
                          checked && "border-crew-copper/40 bg-crew-copper/10",
                        )}
                        key={employee.employee_id}
                      >
                        <Checkbox
                          checked={checked}
                          className="mt-1 border-white/20 data-[state=checked]:border-crew-copper data-[state=checked]:bg-crew-copper"
                          onCheckedChange={(value) => toggleEmployee(employee.employee_id, value === true)}
                        />
                        <span>
                          <span className="block text-base font-medium text-crew-heading">
                            {employee.name}
                          </span>
                          <span className="mt-1 block text-sm text-crew-body">{employee.role}</span>
                          <span className="mt-3 flex flex-wrap gap-2">
                            {employee.skills.slice(0, 3).map((skill) => (
                              <Badge
                                className="rounded-[6px] border-white/10 bg-white/[0.04] text-crew-muted"
                                key={skill}
                                variant="outline"
                              >
                                {skill}
                              </Badge>
                            ))}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                  Assignment brief
                </p>
                <Textarea
                  className="mt-3 min-h-40 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
                  onChange={(event) => {
                    setPlanVersion(0);
                    setBrief(event.target.value);
                  }}
                  placeholder="Example: Review the CrewClaw P2 frontend and split product, code, and launch-risk workstreams."
                  value={brief}
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Button
                    className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                    disabled={!canGenerate}
                    onClick={generatePlan}
                    type="button"
                  >
                    <Play className="size-4" />
                    Generate crew plan
                  </Button>
                  <Button
                    className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                    disabled={employees.length === selectedEmployees.length}
                    onClick={() => {
                      setPlanVersion(0);
                      setSelectedIds(employees.map((employee) => employee.employee_id));
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Sparkles className="size-4" />
                    Select all
                  </Button>
                </div>

                <div className="mt-6 rounded-[8px] border border-white/10 bg-[#17120F] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                        Real CLI crew
                      </p>
                      <code className="mt-2 block break-all rounded-[6px] bg-black/20 px-3 py-2 text-sm text-crew-heading">
                        {cliCommand}
                      </code>
                    </div>
                    <Button
                      className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                      onClick={copyCommand}
                      type="button"
                      variant="outline"
                    >
                      {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {planVersion > 0 && (
              <section className="mt-10">
                <div className="flex items-center gap-2">
                  <Clipboard className="size-5 text-crew-copper" />
                  <h2 className="text-2xl font-light text-crew-heading">Parallel work split</h2>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {contributions.map((contribution) => (
                    <Card
                      className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading"
                      key={contribution.employee.employee_id}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg font-semibold">
                          {contribution.employee.name}
                        </CardTitle>
                        <p className="text-sm text-crew-muted">{contribution.employee.role}</p>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm font-medium text-crew-copper">Focus</p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">{contribution.focus}</p>
                        <p className="mt-4 text-sm font-medium text-crew-copper">Mock contribution</p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">{contribution.output}</p>
                        <p className="mt-4 text-sm font-medium text-crew-copper">Handoff</p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">{contribution.handoff}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
