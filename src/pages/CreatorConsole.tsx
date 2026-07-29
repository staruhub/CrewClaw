import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  AlertCircle,
  BadgeCheck,
  FileText,
  Plus,
  Send,
  ShieldAlert,
} from "lucide-react";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_MANIFEST_FIELDS,
  findHighRiskPermissions,
  type CreatorSubmission,
  type SubmissionManifestFields,
  useSubmissions,
} from "@/hooks/use-submissions";
import { track } from "@/hooks/use-analytics";
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

type CreatorFormValues = {
  id: string;
  name: string;
  role: string;
  version: string;
  creator: string;
  description: string;
  identity: string;
  soul: string;
  skills: string;
  tools: string;
  permissions: string;
  input_examples: string;
  output_examples: string;
  limitations: string;
  install_requirements: string;
};

const ACTION_MESSAGE_KEYS = {
  "Only draft or rejected submissions can be edited.": "hookOnlyDraftEditable",
  "Draft saved.": "hookDraftSaved",
  "Submission not found.": "hookSubmissionNotFound",
  "Only draft or rejected employees can be submitted.":
    "hookOnlyDraftSubmittable",
  "Required manifest fields are missing.": "hookRequiredFieldsMissing",
  "Employee submitted for review.": "hookEmployeeSubmitted",
} as const satisfies Record<string, AdminMessageKey>;

function createListText(t: Translate) {
  return z.string().refine(value => parseList(value).length > 0, {
    message: t("validationListRequired"),
  });
}

function createCreatorFormSchema(t: Translate) {
  const listText = createListText(t);

  return z.object({
    id: z.string().trim().min(1, t("validationEmployeeIdRequired")),
    name: z.string().trim().min(1, t("validationEmployeeNameRequired")),
    role: z.string().trim().min(1, t("validationRoleRequired")),
    version: z.string().trim().min(1, t("validationVersionRequired")),
    creator: z.string().trim().min(1, t("validationCreatorRequired")),
    description: z.string().trim().min(1, t("validationDescriptionRequired")),
    identity: z.string().trim().min(1, t("validationIdentityRequired")),
    soul: z.string().trim().min(1, t("validationSoulRequired")),
    skills: listText,
    tools: listText,
    permissions: listText,
    input_examples: listText,
    output_examples: listText,
    limitations: listText,
    install_requirements: listText,
  });
}

function parseList(value: string) {
  return value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function listToText(value: string[]) {
  return value.join("\n");
}

function manifestToForm(manifest: SubmissionManifestFields): CreatorFormValues {
  return {
    id: manifest.id,
    name: manifest.name,
    role: manifest.role,
    version: manifest.version,
    creator: manifest.creator,
    description: manifest.description,
    identity: manifest.identity,
    soul: manifest.soul,
    skills: listToText(manifest.skills),
    tools: listToText(manifest.tools),
    permissions: listToText(manifest.permissions),
    input_examples: listToText(manifest.input_examples),
    output_examples: listToText(manifest.output_examples),
    limitations: listToText(manifest.limitations),
    install_requirements: listToText(manifest.install_requirements),
  };
}

function formToManifest(values: CreatorFormValues): SubmissionManifestFields {
  return {
    id: values.id,
    name: values.name,
    role: values.role,
    version: values.version,
    creator: values.creator,
    description: values.description,
    identity: values.identity,
    soul: values.soul,
    skills: parseList(values.skills),
    tools: parseList(values.tools),
    permissions: parseList(values.permissions),
    input_examples: parseList(values.input_examples),
    output_examples: parseList(values.output_examples),
    limitations: parseList(values.limitations),
    install_requirements: parseList(values.install_requirements),
  };
}

function localizedActionMessage(message: string, t: Translate) {
  const key = ACTION_MESSAGE_KEYS[message as keyof typeof ACTION_MESSAGE_KEYS];
  return key ? t(key) : message;
}

function statusLabel(submission: CreatorSubmission, t: Translate) {
  if (submission.disabled) return t("statusDisabled");
  if (submission.status === "draft") return t("statusDraft");
  if (submission.status === "submitted") return t("statusPending");
  if (submission.status === "rejected") return t("statusRejected");
  return t("statusApproved");
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
      {statusLabel(submission, t)}
    </Badge>
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

function SubmissionTable({
  empty,
  formatDate,
  onSelect,
  submissions,
  t,
  title,
}: {
  empty: string;
  formatDate: (value: string | null) => string;
  onSelect: (id: string) => void;
  submissions: CreatorSubmission[];
  t: Translate;
  title: string;
}) {
  return (
    <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {submissions.length === 0 ? (
          <p className="px-6 pb-6 text-sm leading-6 text-crew-body">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="px-5 text-crew-muted">
                  {t("tableEmployee")}
                </TableHead>
                <TableHead className="px-5 text-crew-muted">
                  {t("tableStatus")}
                </TableHead>
                <TableHead className="px-5 text-crew-muted">
                  {t("tableUpdated")}
                </TableHead>
                <TableHead className="px-5 text-right text-crew-muted">
                  {t("tableAction")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map(submission => (
                <TableRow
                  className="border-white/10 hover:bg-white/[0.025]"
                  key={submission.submission_id}
                >
                  <TableCell className="px-5 py-4">
                    <div className="font-medium text-crew-heading">
                      {submission.manifest.name || t("creatorUntitledEmployee")}
                    </div>
                    <div className="mt-1 text-xs text-crew-muted">
                      {submission.manifest.role ||
                        submission.manifest.id ||
                        t("creatorDraftRole")}
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-4">
                    <StatusBadge submission={submission} t={t} />
                  </TableCell>
                  <TableCell className="px-5 py-4 text-sm text-crew-body">
                    {formatDate(submission.updated_at)}
                  </TableCell>
                  <TableCell className="px-5 py-4 text-right">
                    <Button
                      className="rounded-[8px] border-white/15"
                      onClick={() => onSelect(submission.submission_id)}
                      size="sm"
                      variant="outline"
                    >
                      {t("actionEdit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function CreatorConsole() {
  const t = useMessages(adminMessages);
  const { formatDate: formatLocaleDate } = useI18n();
  const submissionsApi = useSubmissions();
  const submissions = submissionsApi.list();
  const [activeId, setActiveId] = useState<string | null>(
    submissions[0]?.submission_id ?? null
  );
  const [message, setMessage] = useState<string | null>(null);
  const activeSubmission = activeId ? submissionsApi.get(activeId) : undefined;
  const creatorFormSchema = useMemo(() => createCreatorFormSchema(t), [t]);
  const formatSubmissionDate = (value: string | null) =>
    value
      ? formatLocaleDate(value, { dateStyle: "medium", timeStyle: "short" })
      : t("notYet");
  const form = useForm<CreatorFormValues>({
    resolver: zodResolver(creatorFormSchema),
    defaultValues: manifestToForm(EMPTY_MANIFEST_FIELDS),
  });
  const currentPermissions = useWatch({
    control: form.control,
    name: "permissions",
  });
  const liveHighRiskPermissions = useMemo(
    () => findHighRiskPermissions(parseList(currentPermissions ?? "")),
    [currentPermissions]
  );
  const drafts = submissions.filter(
    submission => submission.status === "draft"
  );
  const reviewStatuses = submissions.filter(
    submission => submission.status !== "draft"
  );
  const published = submissions.filter(
    submission => submission.status === "published" && !submission.disabled
  );
  const pendingCount = submissions.filter(
    submission => submission.status === "submitted"
  ).length;

  useEffect(() => {
    if (!activeSubmission) return;
    form.reset(manifestToForm(activeSubmission.manifest));
  }, [activeSubmission, form]);

  function createNewDraft() {
    const draft = submissionsApi.createDraft({
      version: "0.1.0",
      creator: "Local Creator",
    });
    setActiveId(draft.submission_id);
    setMessage(t("creatorDraftCreated"));
  }

  function saveDraft(values: CreatorFormValues) {
    if (!activeSubmission) return;

    const result = submissionsApi.updateDraft(
      activeSubmission.submission_id,
      formToManifest(values)
    );
    setMessage(localizedActionMessage(result.message, t));
  }

  function submitActive(values: CreatorFormValues) {
    if (!activeSubmission) return;

    const result = submissionsApi.submit(
      activeSubmission.submission_id,
      formToManifest(values)
    );
    if (result.ok) {
      track("employee_submitted", {
        employee_id: result.submission?.manifest.id ?? values.id,
        employee_name: result.submission?.manifest.name ?? values.name,
        submission_id: activeSubmission.submission_id,
      });
    }
    setMessage(
      result.ok
        ? localizedActionMessage(result.message, t)
        : `${localizedActionMessage(result.message, t)} ${
            result.missingFields?.join(", ") ?? ""
          }`.trim()
    );
  }

  const editable =
    activeSubmission?.status === "draft" ||
    activeSubmission?.status === "rejected";

  return (
    <main className="min-h-screen bg-crew-bg px-4 py-10 text-crew-heading sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="border-crew-copper/40 bg-crew-copper/12 text-crew-copper">
              {t("creatorBadge")}
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              {t("creatorTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              {t("creatorDescription")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/marketplace">{t("navMarketplace")}</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/review">{t("navReviewQueue")}</Link>
            </Button>
            <Button
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              onClick={createNewDraft}
            >
              <Plus className="size-4" />
              {t("creatorNewDraft")}
            </Button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Metric
            icon={FileText}
            label={t("metricDrafts")}
            value={drafts.length.toString()}
          />
          <Metric
            icon={Send}
            label={t("metricPending")}
            value={pendingCount.toString()}
          />
          <Metric
            icon={BadgeCheck}
            label={t("metricPublished")}
            value={published.length.toString()}
          />
        </section>

        {message ? (
          <Alert className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <AlertCircle className="size-4 text-crew-copper" />
            <AlertTitle>{t("creatorUpdateTitle")}</AlertTitle>
            <AlertDescription className="text-crew-body">
              {message}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="space-y-5">
            <SubmissionTable
              empty={t("creatorDraftsEmpty")}
              formatDate={formatSubmissionDate}
              onSelect={setActiveId}
              submissions={drafts}
              t={t}
              title={t("creatorDraftsTitle")}
            />
            <SubmissionTable
              empty={t("creatorReviewStatusEmpty")}
              formatDate={formatSubmissionDate}
              onSelect={setActiveId}
              submissions={reviewStatuses}
              t={t}
              title={t("creatorReviewStatusTitle")}
            />
            <SubmissionTable
              empty={t("creatorPublishedEmpty")}
              formatDate={formatSubmissionDate}
              onSelect={setActiveId}
              submissions={published}
              t={t}
              title={t("creatorPublishedTitle")}
            />
          </div>

          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-xl font-semibold">
                    {activeSubmission
                      ? t("creatorManifestTitle")
                      : t("creatorNoDraftSelected")}
                  </CardTitle>
                  <p className="mt-2 text-sm leading-6 text-crew-body">
                    {t("creatorManifestHelp")}
                  </p>
                </div>
                {activeSubmission ? (
                  <StatusBadge submission={activeSubmission} t={t} />
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {!activeSubmission ? (
                <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-6">
                  <h2 className="text-xl font-light">
                    {t("creatorStartDraftTitle")}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                    {t("creatorStartDraftBody")}
                  </p>
                  <Button
                    className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                    onClick={createNewDraft}
                  >
                    <Plus className="size-4" />
                    {t("creatorNewDraft")}
                  </Button>
                </div>
              ) : (
                <Form {...form}>
                  <form
                    className="space-y-8"
                    onSubmit={form.handleSubmit(saveDraft)}
                  >
                    {activeSubmission.status === "rejected" &&
                    activeSubmission.rejection_reason ? (
                      <Alert className="rounded-[8px] border-red-300/25 bg-red-400/10 text-red-100">
                        <AlertCircle className="size-4" />
                        <AlertTitle>{t("creatorRejectedTitle")}</AlertTitle>
                        <AlertDescription className="text-red-100/85">
                          {activeSubmission.rejection_reason}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {liveHighRiskPermissions.length > 0 ? (
                      <Alert className="rounded-[8px] border-amber-300/30 bg-amber-300/10 text-amber-100">
                        <ShieldAlert className="size-4" />
                        <AlertTitle>{t("creatorHighRiskTitle")}</AlertTitle>
                        <AlertDescription className="text-amber-100/85">
                          {t("creatorHighRiskBody", {
                            permissions: liveHighRiskPermissions.join(", "),
                          })}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <fieldset
                      disabled={!editable}
                      className="space-y-8 disabled:opacity-70"
                    >
                      <div className="grid gap-5 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldId")}</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderEmployeeId")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldName")}</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderEmployeeName")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="role"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldRole")}</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderEmployeeRole")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="version"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldVersion")}</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderVersion")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="creator"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldCreator")}</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderCreator")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid gap-5 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldDescription")}</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderDescription")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="identity"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("fieldIdentity")}</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderIdentity")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="soul"
                          render={({ field }) => (
                            <FormItem className="md:col-span-2">
                              <FormLabel>{t("fieldSoul")}</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder={t("placeholderSoul")}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid gap-5 md:grid-cols-2">
                        {[
                          ["skills", t("descriptionSkills")],
                          ["tools", t("descriptionTools")],
                          ["permissions", t("descriptionPermissions")],
                          [
                            "install_requirements",
                            t("descriptionInstallRequirements"),
                          ],
                          ["input_examples", t("descriptionInputExamples")],
                          ["output_examples", t("descriptionOutputExamples")],
                          ["limitations", t("descriptionLimitations")],
                        ].map(([name, description]) => (
                          <FormField
                            control={form.control}
                            key={name}
                            name={name as keyof CreatorFormValues}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  {t(
                                    `field${name
                                      .split("_")
                                      .map(
                                        part =>
                                          part.charAt(0).toUpperCase() +
                                          part.slice(1)
                                      )
                                      .join("")}` as AdminMessageKey
                                  )}
                                </FormLabel>
                                <FormControl>
                                  <Textarea
                                    className="min-h-32 rounded-[8px] border-white/10 bg-white/[0.04]"
                                    {...field}
                                  />
                                </FormControl>
                                <FormDescription className="text-crew-muted">
                                  {description}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                    </fieldset>

                    <div className="flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-crew-muted">
                        {t("creatorSubmittedAt", {
                          date: formatSubmissionDate(
                            activeSubmission.submitted_at
                          ),
                        })}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              className="rounded-[8px] border-white/15"
                              variant="outline"
                            >
                              {t("creatorPreviewManifest")}
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[80vh] overflow-auto rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-3xl">
                            <DialogHeader>
                              <DialogTitle>
                                {t("creatorManifestPreviewTitle")}
                              </DialogTitle>
                              <DialogDescription className="text-crew-body">
                                {t("creatorManifestPreviewDescription")}
                              </DialogDescription>
                            </DialogHeader>
                            <pre className="overflow-auto rounded-[8px] border border-white/10 bg-black/25 p-4 text-xs leading-5 text-crew-body">
                              {JSON.stringify(
                                activeSubmission.contract_manifest,
                                null,
                                2
                              )}
                            </pre>
                          </DialogContent>
                        </Dialog>
                        {editable ? (
                          <>
                            <Button
                              className="rounded-[8px] border-white/15"
                              type="submit"
                              variant="outline"
                            >
                              {t("creatorSaveDraft")}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                                  type="button"
                                >
                                  <Send className="size-4" />
                                  {t("creatorSubmit")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("creatorSubmitDialogTitle")}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="leading-6 text-crew-body">
                                    {t("creatorSubmitDialogDescription")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-[8px] border-white/15">
                                    {t("creatorKeepEditing")}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                                    onClick={form.handleSubmit(submitActive)}
                                  >
                                    {t("creatorSubmit")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </section>
      </section>
    </main>
  );
}
