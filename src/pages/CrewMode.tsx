import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Copy,
  Eye,
  FileDiff,
  FileWarning,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { getEmployee, type Employee } from "@/data/employees";
import { track } from "@/hooks/use-analytics";
import { useTeam } from "@/hooks/use-team";
import { defineCatalog, type MessageValues, useMessages } from "@/i18n";
import { operationsEn } from "@/i18n/locales/en/operations";
import { operationsZhCN } from "@/i18n/locales/zh-CN/operations";
import { cn } from "@/lib/utils";

const operationsMessages = defineCatalog(operationsEn, operationsZhCN);
type OperationsTranslator = (
  key: keyof typeof operationsEn,
  values?: MessageValues
) => string;

type CrewContribution = {
  employee: Employee;
  focus: string;
  output: string;
  handoff: string;
};

type LearningProposal = {
  worked: string[];
  failed: string[];
  knowledge: string[];
  playbookDiff: { before: string; after: string };
  memoryUpdate: string;
};

function commandBrief(brief: string, t: OperationsTranslator) {
  const normalized = brief.trim().replace(/\s+/g, " ");
  return (normalized || t("commandBriefFallback")).replace(/"/g, "'");
}

function buildContribution(
  employee: Employee,
  brief: string,
  index: number,
  t: OperationsTranslator
): CrewContribution {
  const topSkills = employee.skills
    .slice(0, 2)
    .map(skill => skill.replaceAll("-", " "));
  const role = employee.role.toLowerCase();
  const focus = role.includes("code")
    ? t("contributionFocusCode")
    : role.includes("product")
      ? t("contributionFocusProduct")
      : role.includes("network")
        ? t("contributionFocusNetwork")
        : t("contributionFocusDefault");

  return {
    employee,
    focus,
    output: t("contributionOutput", {
      name: employee.name,
      skills: topSkills.join(" + "),
      brief: brief || employee.first_task,
    }),
    handoff: t("contributionHandoff", { index: index + 1 }),
  };
}

function buildLearningProposal(
  brief: string,
  contributions: CrewContribution[],
  t: OperationsTranslator
): LearningProposal {
  const ownerNames = contributions
    .map(contribution => contribution.employee.name)
    .join(", ");
  return {
    worked: [
      t("learningWorkedSplit", {
        owners: ownerNames || t("selectedEmployees"),
      }),
      t("learningWorkedHandoff"),
    ],
    failed: [t("learningFailedNoReceipt"), t("learningFailedNoReview")],
    knowledge: [
      t("learningKnowledgeAssignment", { brief: commandBrief(brief, t) }),
      t("learningKnowledgeSplit"),
    ],
    playbookDiff: {
      before: t("playbookBefore"),
      after: t("playbookAfter"),
    },
    memoryUpdate: t("stagedMemoryUpdate"),
  };
}

export default function CrewMode() {
  const { list } = useTeam();
  const t = useMessages(operationsMessages);
  const employees = useMemo(
    () =>
      list()
        .filter(workspaceEmployee => workspaceEmployee.status === "active")
        .map(workspaceEmployee => getEmployee(workspaceEmployee.employee_id))
        .filter((employee): employee is Employee => Boolean(employee)),
    [list]
  );
  const [brief, setBrief] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [planVersion, setPlanVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [learningReviewed, setLearningReviewed] = useState(false);
  const [learningDecision, setLearningDecision] = useState<
    "pending" | "approved" | "rejected"
  >("pending");

  useEffect(() => {
    track("team_viewed", {
      source: "crew_mode",
      active_employee_count: employees.length,
    });
  }, [employees.length]);

  // Avoid trimming selectedIds in an effect: selectedEmployees already filters
  // stale ids at every consumption site without triggering cascaded renders.
  const selectedEmployees = useMemo(
    () =>
      employees.filter(employee => selectedIds.includes(employee.employee_id)),
    [employees, selectedIds]
  );
  const contributions = useMemo(
    () =>
      selectedEmployees.map((employee, index) =>
        buildContribution(employee, brief, index, t)
      ),
    [brief, selectedEmployees, t]
  );
  const cliCommand = `pnpm run crewclaw -- standup "${commandBrief(brief, t)}"`;
  const canGenerate = selectedEmployees.length > 0 && brief.trim().length > 0;
  const learningProposal = useMemo(
    () => buildLearningProposal(brief, contributions, t),
    [brief, contributions, t]
  );

  function toggleEmployee(employeeId: string, checked: boolean) {
    setPlanVersion(0);
    setSelectedIds(current =>
      checked
        ? [...current, employeeId]
        : current.filter(id => id !== employeeId)
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
    setLearningReviewed(false);
    setLearningDecision("pending");
    setPlanVersion(current => current + 1);
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    track("demo_task_copied", {
      source: "crew_mode",
      selected_employee_ids: selectedEmployees.map(e => e.employee_id),
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
            {t("marketplace")}
          </Link>
        </Button>

        <div className="mt-8 flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <Badge className="gap-1 border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              <Users className="size-3" />
              {t("crewModeBadge")}
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              {t("crewModeTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              {t("crewModeDescription")}
            </p>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.025] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
              {t("activeEmployees")}
            </p>
            <p className="mt-2 text-3xl font-semibold text-crew-heading">
              {employees.length}
            </p>
          </div>
        </div>

        {employees.length === 0 ? (
          <section className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold text-crew-heading">
              {t("hireEmployeesFirst")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-crew-body">
              {t("hireEmployeesFirstDescription")}
            </p>
            <Button
              className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              asChild
            >
              <Link to="/marketplace">{t("browseEmployees")}</Link>
            </Button>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                    {t("teamRoster")}
                  </p>
                  <h2 className="mt-2 text-2xl font-light text-crew-heading">
                    {t("chooseStandupMembers")}
                  </h2>
                </div>
                <div className="grid gap-3">
                  {employees.map(employee => {
                    const checked = selectedIds.includes(employee.employee_id);

                    return (
                      <label
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-4 transition-colors",
                          checked && "border-crew-copper/40 bg-crew-copper/10"
                        )}
                        key={employee.employee_id}
                      >
                        <Checkbox
                          checked={checked}
                          className="mt-1 border-white/20 data-[state=checked]:border-crew-copper data-[state=checked]:bg-crew-copper"
                          onCheckedChange={value =>
                            toggleEmployee(employee.employee_id, value === true)
                          }
                        />
                        <span>
                          <span className="block text-base font-medium text-crew-heading">
                            {employee.name}
                          </span>
                          <span className="mt-1 block text-sm text-crew-body">
                            {employee.role}
                          </span>
                          <span className="mt-3 flex flex-wrap gap-2">
                            {employee.skills.slice(0, 3).map(skill => (
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
                  {t("assignmentBrief")}
                </p>
                <Textarea
                  className="mt-3 min-h-40 rounded-[8px] border-white/10 bg-white/[0.04] text-crew-heading placeholder:text-crew-muted"
                  onChange={event => {
                    setPlanVersion(0);
                    setBrief(event.target.value);
                  }}
                  placeholder={t("assignmentBriefPlaceholder")}
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
                    {t("generateCrewPlan")}
                  </Button>
                  <Button
                    className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                    disabled={employees.length === selectedEmployees.length}
                    onClick={() => {
                      setPlanVersion(0);
                      setSelectedIds(
                        employees.map(employee => employee.employee_id)
                      );
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Sparkles className="size-4" />
                    {t("selectAll")}
                  </Button>
                </div>

                <div className="mt-6 rounded-[8px] border border-white/10 bg-[#17120F] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                        {t("realCliCrew")}
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
                      {copied ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied ? t("copied") : t("copy")}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {planVersion > 0 && (
              <section className="mt-10">
                <div className="flex items-center gap-2">
                  <Clipboard className="size-5 text-crew-copper" />
                  <h2 className="text-2xl font-light text-crew-heading">
                    {t("parallelWorkSplit")}
                  </h2>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {contributions.map(contribution => (
                    <Card
                      className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading"
                      key={contribution.employee.employee_id}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg font-semibold">
                          {contribution.employee.name}
                        </CardTitle>
                        <p className="text-sm text-crew-muted">
                          {contribution.employee.role}
                        </p>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm font-medium text-crew-copper">
                          {t("focus")}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">
                          {contribution.focus}
                        </p>
                        <p className="mt-4 text-sm font-medium text-crew-copper">
                          {t("mockContribution")}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">
                          {contribution.output}
                        </p>
                        <p className="mt-4 text-sm font-medium text-crew-copper">
                          {t("handoff")}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-crew-body">
                          {contribution.handoff}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                          <FileDiff className="size-5 text-crew-copper" />
                          {t("dreamReviewProposal")}
                        </CardTitle>
                        <p className="mt-2 text-sm leading-6 text-crew-body">
                          {t("dreamReviewDescription")}
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          "rounded-[8px] border",
                          learningDecision === "approved"
                            ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                            : learningDecision === "rejected"
                              ? "border-red-300/35 bg-red-400/10 text-red-100"
                              : "border-amber-300/35 bg-amber-300/10 text-amber-100"
                        )}
                        variant="outline"
                      >
                        {learningDecision === "pending"
                          ? t("awaitingHumanReview")
                          : learningDecision === "approved"
                            ? t("approvedAsStagedNote")
                            : t("rejected")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                          {t("worked")}
                        </h3>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
                          {learningProposal.worked.map(item => (
                            <li
                              className="rounded-[8px] border border-white/10 bg-white/[0.025] px-3 py-2"
                              key={item}
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                          {t("failedUnknown")}
                        </h3>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
                          {learningProposal.failed.map(item => (
                            <li
                              className="rounded-[8px] border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2"
                              key={item}
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-4">
                        <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                          {t("knowledgeCandidate")}
                        </h3>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-crew-body">
                          {learningProposal.knowledge.map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-[8px] border border-white/10 bg-[#17120F] p-4">
                        <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
                          {t("playbookDiff")}
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-red-100">
                          - {learningProposal.playbookDiff.before}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-emerald-100">
                          + {learningProposal.playbookDiff.after}
                        </p>
                      </div>
                    </div>
                    <Alert className="mt-5 rounded-[8px] border-amber-300/25 bg-amber-300/10 text-crew-heading">
                      <FileWarning className="size-4 text-amber-100" />
                      <AlertTitle>{t("controlledMemoryUpdate")}</AlertTitle>
                      <AlertDescription className="text-amber-100/85">
                        {t("memoryUpdateDisclaimer", {
                          update: learningProposal.memoryUpdate,
                        })}
                      </AlertDescription>
                    </Alert>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <Button
                        className="rounded-[8px] border-white/15 text-crew-muted hover:text-crew-heading"
                        onClick={() => {
                          setLearningReviewed(true);
                          track("team_viewed", {
                            source: "crew_mode",
                            action: "dream_proposal_reviewed",
                            selected_employee_ids: selectedEmployees.map(
                              employee => employee.employee_id
                            ),
                          });
                        }}
                        type="button"
                        variant="outline"
                      >
                        <Eye className="size-4" />
                        {t("markReviewed")}
                      </Button>
                      <Button
                        className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                        disabled={!learningReviewed}
                        onClick={() => {
                          setLearningDecision("approved");
                          track("team_viewed", {
                            source: "crew_mode",
                            action: "dream_proposal_approved_staged",
                          });
                        }}
                        type="button"
                      >
                        {t("approveStagedNote")}
                      </Button>
                      <Button
                        className="rounded-[8px]"
                        disabled={!learningReviewed}
                        onClick={() => {
                          setLearningDecision("rejected");
                          track("team_viewed", {
                            source: "crew_mode",
                            action: "dream_proposal_rejected",
                          });
                        }}
                        type="button"
                        variant="destructive"
                      >
                        {t("rejectUpdate")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
