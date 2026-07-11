import { useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Eye,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { PermissionLevelList } from "@/components/employee/PermissionLevel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { track } from "@/hooks/use-analytics";
import type { CreatorSubmission } from "@/hooks/use-submissions";
import { useSubmissions } from "@/hooks/use-submissions";
import { cn } from "@/lib/utils";

function formatDate(value: string | null) {
  if (!value) return "Not yet";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function submissionStatus(submission: CreatorSubmission) {
  if (submission.disabled) return "Disabled";
  if (submission.status === "submitted") return "Pending";
  if (submission.status === "published") return "Verified Employee";
  if (submission.status === "rejected") return "Rejected";
  return "Draft";
}

function StatusBadge({ submission }: { submission: CreatorSubmission }) {
  const className = submission.disabled
    ? "border-zinc-400/35 bg-zinc-400/10 text-zinc-200"
    : submission.status === "published"
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
      : submission.status === "submitted"
        ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
        : submission.status === "rejected"
          ? "border-red-300/35 bg-red-400/10 text-red-100"
          : "border-white/15 bg-white/[0.04] text-crew-muted";

  return (
    <Badge className={cn("rounded-[8px] border", className)} variant="outline">
      {submissionStatus(submission)}
    </Badge>
  );
}

function RiskBadge({ submission }: { submission: CreatorSubmission }) {
  if (submission.high_risk_permissions.length === 0) {
    return (
      <Badge
        className="rounded-[8px] border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
        variant="outline"
      >
        Standard
      </Badge>
    );
  }

  return (
    <Badge
      className="gap-1 rounded-[8px] border-amber-300/35 bg-amber-300/10 text-amber-100"
      variant="outline"
    >
      <ShieldAlert className="size-3" />
      High risk
    </Badge>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-crew-heading">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <Badge
            className="max-w-full rounded-[8px] border-white/10 bg-white/[0.04] text-crew-muted"
            key={item}
            variant="outline"
          >
            <span className="truncate">{item}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function SubmissionDetail({ submission }: { submission: CreatorSubmission }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
            Employee
          </p>
          <h3 className="mt-2 text-xl font-semibold text-crew-heading">
            {submission.manifest.name}
          </h3>
          <p className="mt-1 text-sm text-crew-muted">
            {submission.manifest.role}
          </p>
        </div>
        <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
            Creator
          </p>
          <h3 className="mt-2 text-xl font-semibold text-crew-heading">
            {submission.manifest.creator}
          </h3>
          <p className="mt-1 text-sm text-crew-muted">
            v{submission.manifest.version}
          </p>
        </div>
      </div>

      <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-crew-heading">
          Manifest summary
        </h3>
        <p className="mt-3 text-sm leading-6 text-crew-body">
          {submission.manifest.description}
        </p>
        <p className="mt-3 text-sm leading-6 text-crew-body">
          {submission.manifest.identity}
        </p>
      </div>

      {submission.high_risk_permissions.length > 0 ? (
        <Alert className="rounded-[8px] border-amber-300/30 bg-amber-300/10 text-amber-100">
          <ShieldAlert className="size-4" />
          <AlertTitle>High-risk permissions require manual review</AlertTitle>
          <AlertDescription className="text-amber-100/85">
            {submission.high_risk_permissions.join(", ")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <SummaryList label="Skills" items={submission.manifest.skills} />
        <SummaryList label="Tools" items={submission.manifest.tools} />
        <SummaryList
          label="Onboarding"
          items={submission.manifest.install_requirements}
        />
        <SummaryList
          label="Limitations"
          items={submission.manifest.limitations}
        />
        <SummaryList
          label="Input examples"
          items={submission.manifest.input_examples}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-crew-heading">
          Permissions
        </h3>
        <PermissionLevelList
          compact
          permissions={submission.manifest.permissions}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-crew-muted">
        <Icon className="size-4 text-crew-copper" />
        <span className="font-mono text-xs uppercase tracking-[0.14em]">
          {label}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-crew-heading">{value}</p>
    </div>
  );
}

function RejectDialog({
  onReject,
  submission,
}: {
  onReject: (id: string, reason: string) => void;
  submission: CreatorSubmission;
}) {
  const [reason, setReason] = useState(
    "High-risk write permissions need clearer confirmation language."
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="rounded-[8px]" size="sm" variant="destructive">
          <XCircle className="size-4" />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
        <DialogHeader>
          <DialogTitle>Reject {submission.manifest.name}?</DialogTitle>
          <DialogDescription className="text-crew-body">
            The creator will see these review notes and can edit the employee
            draft.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
          onChange={event => setReason(event.target.value)}
          value={reason}
        />
        <DialogFooter>
          <Button
            className="rounded-[8px]"
            onClick={() => onReject(submission.submission_id, reason)}
            variant="destructive"
          >
            Reject employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewQueue() {
  const submissionsApi = useSubmissions();
  const submissions = submissionsApi.list();
  const [message, setMessage] = useState<string | null>(null);
  const pending = submissions.filter(
    submission => submission.status === "submitted"
  );
  const published = submissions.filter(
    submission => submission.status === "published"
  );
  const highRiskCount = pending.filter(
    submission => submission.high_risk_permissions.length > 0
  ).length;
  // 与上面 pending/published 同款的直接 filter——手写 useMemo 反而让 React Compiler 无法保留
  // 记忆化并跳过整个组件的编译（收益为负）；这个过滤本身开销可忽略。
  const rows = submissions.filter(
    submission =>
      submission.status === "submitted" || submission.status === "published"
  );

  function approve(id: string) {
    const result = submissionsApi.approve(id);
    if (result.ok && result.submission) {
      track("employee_published", {
        employee_id: result.submission.manifest.id,
        employee_name: result.submission.manifest.name,
        submission_id: result.submission.submission_id,
      });
    }
    setMessage(result.message);
  }

  function reject(id: string, reason: string) {
    const result = submissionsApi.reject(id, reason);
    setMessage(result.message);
  }

  function disable(id: string) {
    const result = submissionsApi.disable(id);
    setMessage(result.message);
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              Review Queue
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Verify employee submissions
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Review manifest quality, flag risky permissions, and only publish
              employees after operator approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/creator">Creator Console</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/marketplace">Marketplace</Link>
            </Button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Metric
            icon={AlertTriangle}
            label="Pending"
            value={pending.length.toString()}
          />
          <Metric
            icon={ShieldAlert}
            label="High risk"
            value={highRiskCount.toString()}
          />
          <Metric
            icon={BadgeCheck}
            label="Published"
            value={published.length.toString()}
          />
        </section>

        {message ? (
          <Alert className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CheckCircle2 className="size-4 text-crew-copper" />
            <AlertTitle>Review update</AlertTitle>
            <AlertDescription className="text-crew-body">
              {message}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert className="mt-6 rounded-[8px] border-crew-copper/25 bg-crew-copper/10 text-crew-heading">
          <ShieldAlert className="size-4 text-crew-copper" />
          <AlertTitle>Safety policy</AlertTitle>
          <AlertDescription className="text-crew-body">
            Mail sending, contacts write, payment, and delete permissions must
            be reviewed before an employee receives Verified Employee status.
          </AlertDescription>
        </Alert>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="px-6 pb-8">
                <h2 className="text-2xl font-light">
                  No employees waiting for review.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                  Submitted employees from Creator Console will appear here
                  before they can become public Verified Employees.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="px-5 text-crew-muted">
                      Employee
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      Manifest summary
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">Risk</TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      Status
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      Submitted
                    </TableHead>
                    <TableHead className="px-5 text-right text-crew-muted">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(submission => (
                    <TableRow
                      className="border-white/10 hover:bg-white/[0.025]"
                      key={submission.submission_id}
                    >
                      <TableCell className="px-5 py-5">
                        <div className="font-medium text-crew-heading">
                          {submission.manifest.name}
                        </div>
                        <div className="mt-1 text-xs text-crew-muted">
                          {submission.manifest.role} ·{" "}
                          {submission.manifest.creator}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[340px] px-5 py-5">
                        <p className="line-clamp-2 text-sm leading-6 text-crew-body">
                          {submission.manifest.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {submission.manifest.tools.slice(0, 3).map(tool => (
                            <Badge
                              className="rounded-[8px] border-white/10 bg-white/[0.04] text-crew-muted"
                              key={tool}
                              variant="outline"
                            >
                              {tool}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <RiskBadge submission={submission} />
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <StatusBadge submission={submission} />
                      </TableCell>
                      <TableCell className="px-5 py-5 text-sm text-crew-body">
                        {formatDate(submission.submitted_at)}
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                className="rounded-[8px] border-white/15"
                                size="sm"
                                variant="outline"
                              >
                                <Eye className="size-4" />
                                Review
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[86vh] overflow-auto rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-4xl">
                              <DialogHeader>
                                <DialogTitle>
                                  {submission.manifest.name}
                                </DialogTitle>
                                <DialogDescription className="text-crew-body">
                                  Manifest summary, permissions, onboarding, and
                                  safety notes.
                                </DialogDescription>
                              </DialogHeader>
                              <SubmissionDetail submission={submission} />
                            </DialogContent>
                          </Dialog>

                          {submission.status === "submitted" ? (
                            <>
                              <Button
                                className="rounded-[8px] bg-emerald-600 text-white hover:bg-emerald-500"
                                onClick={() =>
                                  approve(submission.submission_id)
                                }
                                size="sm"
                              >
                                <CheckCircle2 className="size-4" />
                                Approve
                              </Button>
                              <RejectDialog
                                onReject={reject}
                                submission={submission}
                              />
                            </>
                          ) : null}

                          {submission.status === "published" &&
                          !submission.disabled ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  className="rounded-[8px]"
                                  size="sm"
                                  variant="destructive"
                                >
                                  <Ban className="size-4" />
                                  Disable
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Disable {submission.manifest.name}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="leading-6 text-crew-body">
                                    This employee will be taken off the public
                                    bench and will lose Verified Employee
                                    status.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-[8px] border-white/15">
                                    Keep published
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="rounded-[8px] bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() =>
                                      disable(submission.submission_id)
                                    }
                                  >
                                    Disable employee
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
