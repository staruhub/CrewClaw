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
import { useI18n, useMessages, type MessageValues } from "@/i18n";
import { adminEn } from "@/i18n/locales/en/admin";
import { adminZhCN } from "@/i18n/locales/zh-CN/admin";
import { cn } from "@/lib/utils";

const adminMessages = {
  en: adminEn,
  "zh-CN": adminZhCN,
} as const;

type AdminMessageKey = keyof typeof adminEn;
type Translate = (key: AdminMessageKey, values?: MessageValues) => string;

const ACTION_MESSAGE_KEYS = {
  "Submission not found.": "hookSubmissionNotFound",
  "Only pending submissions can be approved.": "hookOnlyPendingApprovable",
  "Employee published.": "hookEmployeePublished",
  "Only pending submissions can be rejected.": "hookOnlyPendingRejectable",
  "Employee returned to creator with review notes.": "hookEmployeeReturned",
  "Only published employees can be disabled.": "hookOnlyPublishedDisable",
  "Employee disabled and removed from the public bench.":
    "hookEmployeeDisabled",
} as const satisfies Record<string, AdminMessageKey>;

function localizedActionMessage(message: string, t: Translate) {
  const key = ACTION_MESSAGE_KEYS[message as keyof typeof ACTION_MESSAGE_KEYS];
  return key ? t(key) : message;
}

function submissionStatus(submission: CreatorSubmission, t: Translate) {
  if (submission.disabled) return t("statusDisabled");
  if (submission.status === "submitted") return t("statusPending");
  if (submission.status === "published") return t("statusPublished");
  if (submission.status === "rejected") return t("statusRejected");
  return t("statusDraft");
}

function StatusBadge({
  submission,
  t,
}: {
  submission: CreatorSubmission;
  t: Translate;
}) {
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
      {submissionStatus(submission, t)}
    </Badge>
  );
}

function RiskBadge({
  submission,
  t,
}: {
  submission: CreatorSubmission;
  t: Translate;
}) {
  if (submission.high_risk_permissions.length === 0) {
    return (
      <Badge
        className="rounded-[8px] border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
        variant="outline"
      >
        {t("riskStandard")}
      </Badge>
    );
  }

  return (
    <Badge
      className="gap-1 rounded-[8px] border-amber-300/35 bg-amber-300/10 text-amber-100"
      variant="outline"
    >
      <ShieldAlert className="size-3" />
      {t("riskHigh")}
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

function SubmissionDetail({
  submission,
  t,
}: {
  submission: CreatorSubmission;
  t: Translate;
}) {
  const flags = evidenceFlags(submission, t);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-crew-muted">
            {t("reviewEmployeeLabel")}
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
            {t("reviewCreatorLabel")}
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
          {t("reviewManifestSummaryTitle")}
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
          <AlertTitle>{t("reviewHighRiskManualTitle")}</AlertTitle>
          <AlertDescription className="text-amber-100/85">
            {submission.high_risk_permissions.join(", ")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-crew-heading">
          {t("reviewEvidenceFlagsTitle")}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {flags.map(flag => (
            <Badge
              className={cn(
                "rounded-[8px] border",
                flag.tone === "warning"
                  ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
                  : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              )}
              key={flag.label}
              variant="outline"
            >
              {flag.label}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-crew-muted">
          {t("reviewEvidenceGateBody")}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <SummaryList
          label={t("reviewSkills")}
          items={submission.manifest.skills}
        />
        <SummaryList
          label={t("reviewTools")}
          items={submission.manifest.tools}
        />
        <SummaryList
          label={t("reviewOnboarding")}
          items={submission.manifest.install_requirements}
        />
        <SummaryList
          label={t("reviewLimitations")}
          items={submission.manifest.limitations}
        />
        <SummaryList
          label={t("reviewInputExamples")}
          items={submission.manifest.input_examples}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-crew-heading">
          {t("reviewPermissions")}
        </h3>
        <PermissionLevelList
          compact
          permissions={submission.manifest.permissions}
        />
      </div>
    </div>
  );
}

function evidenceFlags(submission: CreatorSubmission, t: Translate) {
  const flags: { label: string; tone: "ok" | "warning" }[] = [];
  if (submission.high_risk_permissions.length > 0) {
    flags.push({ label: t("evidenceHighRiskPermission"), tone: "warning" });
  }
  if (submission.manifest.input_examples.length === 0) {
    flags.push({ label: t("evidenceNoInputExamples"), tone: "warning" });
  }
  if (submission.manifest.limitations.length === 0) {
    flags.push({ label: t("evidenceNoLimitations"), tone: "warning" });
  }
  if (submission.manifest.tools.length === 0) {
    flags.push({ label: t("evidenceNoToolEvidence"), tone: "warning" });
  }
  if (flags.length === 0) {
    flags.push({ label: t("evidenceManifestReviewed"), tone: "ok" });
  }
  return flags;
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
  t,
}: {
  onReject: (id: string, reason: string) => void;
  submission: CreatorSubmission;
  t: Translate;
}) {
  const [reason, setReason] = useState(t("rejectDefaultReason"));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="rounded-[8px]" size="sm" variant="destructive">
          <XCircle className="size-4" />
          {t("actionReject")}
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
        <DialogHeader>
          <DialogTitle>
            {t("rejectDialogTitle", { name: submission.manifest.name })}
          </DialogTitle>
          <DialogDescription className="text-crew-body">
            {t("rejectDialogDescription")}
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
            {t("rejectEmployee")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewQueue() {
  const t = useMessages(adminMessages);
  const { formatDate: formatLocaleDate } = useI18n();
  const submissionsApi = useSubmissions();
  const submissions = submissionsApi.list();
  const [message, setMessage] = useState<string | null>(null);
  const [reviewedSubmissionIds, setReviewedSubmissionIds] = useState<string[]>(
    []
  );
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
  const formatSubmissionDate = (value: string | null) =>
    value
      ? formatLocaleDate(value, { dateStyle: "medium", timeStyle: "short" })
      : t("notYet");

  function approve(id: string) {
    if (!reviewedSubmissionIds.includes(id)) {
      setMessage(t("approveNeedsReview"));
      return;
    }
    const result = submissionsApi.approve(id);
    if (result.ok && result.submission) {
      track("employee_published", {
        employee_id: result.submission.manifest.id,
        employee_name: result.submission.manifest.name,
        submission_id: result.submission.submission_id,
      });
    }
    setMessage(localizedActionMessage(result.message, t));
  }

  function markReviewed(id: string) {
    setReviewedSubmissionIds(current =>
      current.includes(id) ? current : [...current, id]
    );
  }

  function reject(id: string, reason: string) {
    const result = submissionsApi.reject(id, reason);
    setMessage(localizedActionMessage(result.message, t));
  }

  function disable(id: string) {
    const result = submissionsApi.disable(id);
    setMessage(localizedActionMessage(result.message, t));
  }

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              {t("reviewBadge")}
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              {t("reviewTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              {t("reviewDescription")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/creator">{t("navCreatorConsole")}</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
            >
              <Link to="/marketplace">{t("navMarketplace")}</Link>
            </Button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Metric
            icon={AlertTriangle}
            label={t("metricPending")}
            value={pending.length.toString()}
          />
          <Metric
            icon={ShieldAlert}
            label={t("metricHighRisk")}
            value={highRiskCount.toString()}
          />
          <Metric
            icon={BadgeCheck}
            label={t("metricPublished")}
            value={published.length.toString()}
          />
        </section>

        {message ? (
          <Alert className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CheckCircle2 className="size-4 text-crew-copper" />
            <AlertTitle>{t("reviewUpdateTitle")}</AlertTitle>
            <AlertDescription className="text-crew-body">
              {message}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert className="mt-6 rounded-[8px] border-crew-copper/25 bg-crew-copper/10 text-crew-heading">
          <ShieldAlert className="size-4 text-crew-copper" />
          <AlertTitle>{t("reviewSafetyPolicyTitle")}</AlertTitle>
          <AlertDescription className="text-crew-body">
            {t("reviewSafetyPolicyBody")}
          </AlertDescription>
        </Alert>

        <Card className="mt-8 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              {t("reviewQueueTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="px-6 pb-8">
                <h2 className="text-2xl font-light">{t("reviewEmptyTitle")}</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                  {t("reviewEmptyBody")}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="px-5 text-crew-muted">
                      {t("tableEmployee")}
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      {t("tableManifestSummary")}
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      {t("tableRisk")}
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      {t("tableStatus")}
                    </TableHead>
                    <TableHead className="px-5 text-crew-muted">
                      {t("tableSubmitted")}
                    </TableHead>
                    <TableHead className="px-5 text-right text-crew-muted">
                      {t("tableActions")}
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
                        <RiskBadge submission={submission} t={t} />
                      </TableCell>
                      <TableCell className="px-5 py-5">
                        <StatusBadge submission={submission} t={t} />
                      </TableCell>
                      <TableCell className="px-5 py-5 text-sm text-crew-body">
                        {formatSubmissionDate(submission.submitted_at)}
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
                                {t("actionReview")}
                              </Button>
                            </DialogTrigger>
                            <DialogContent
                              className="max-h-[86vh] overflow-auto rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-4xl"
                              onOpenAutoFocus={() =>
                                markReviewed(submission.submission_id)
                              }
                            >
                              <DialogHeader>
                                <DialogTitle>
                                  {submission.manifest.name}
                                </DialogTitle>
                                <DialogDescription className="text-crew-body">
                                  {t("reviewDialogDescription")}
                                </DialogDescription>
                              </DialogHeader>
                              <SubmissionDetail submission={submission} t={t} />
                            </DialogContent>
                          </Dialog>

                          {submission.status === "submitted" ? (
                            <>
                              <Button
                                className="rounded-[8px] bg-emerald-600 text-white hover:bg-emerald-500"
                                disabled={
                                  !reviewedSubmissionIds.includes(
                                    submission.submission_id
                                  )
                                }
                                onClick={() =>
                                  approve(submission.submission_id)
                                }
                                size="sm"
                                title={
                                  reviewedSubmissionIds.includes(
                                    submission.submission_id
                                  )
                                    ? t("approveReviewedTitle")
                                    : t("approveOpenReviewTitle")
                                }
                              >
                                <CheckCircle2 className="size-4" />
                                {t("actionApprove")}
                              </Button>
                              <RejectDialog
                                onReject={reject}
                                submission={submission}
                                t={t}
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
                                  {t("actionDisable")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("disableDialogTitle", {
                                      name: submission.manifest.name,
                                    })}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="leading-6 text-crew-body">
                                    {t("disableDialogDescription")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-[8px] border-white/15">
                                    {t("disableKeepPublished")}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="rounded-[8px] bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() =>
                                      disable(submission.submission_id)
                                    }
                                  >
                                    {t("disableEmployee")}
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
