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
import { cn } from "@/lib/utils";

const listText = z.string().refine(value => parseList(value).length > 0, {
  message: "Add at least one item.",
});

const creatorFormSchema = z.object({
  id: z.string().trim().min(1, "Employee id is required."),
  name: z.string().trim().min(1, "Employee name is required."),
  role: z.string().trim().min(1, "Role is required."),
  version: z.string().trim().min(1, "Version is required."),
  creator: z.string().trim().min(1, "Creator is required."),
  description: z.string().trim().min(1, "Description is required."),
  identity: z.string().trim().min(1, "Identity is required."),
  soul: z.string().trim().min(1, "Soul is required."),
  skills: listText,
  tools: listText,
  permissions: listText,
  input_examples: listText,
  output_examples: listText,
  limitations: listText,
  install_requirements: listText,
});

type CreatorFormValues = z.infer<typeof creatorFormSchema>;

const STATUS_COPY = {
  draft: "Draft",
  submitted: "Pending",
  rejected: "Rejected",
  published: "Approved",
} as const;

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

function formatDate(value: string | null) {
  if (!value) return "Not yet";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(submission: CreatorSubmission) {
  if (submission.disabled) return "Disabled";
  return STATUS_COPY[submission.status];
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
      {statusLabel(submission)}
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
  onSelect,
  submissions,
  title,
}: {
  empty: string;
  onSelect: (id: string) => void;
  submissions: CreatorSubmission[];
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
                <TableHead className="px-5 text-crew-muted">Employee</TableHead>
                <TableHead className="px-5 text-crew-muted">Status</TableHead>
                <TableHead className="px-5 text-crew-muted">Updated</TableHead>
                <TableHead className="px-5 text-right text-crew-muted">
                  Action
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
                      {submission.manifest.name || "Untitled employee"}
                    </div>
                    <div className="mt-1 text-xs text-crew-muted">
                      {submission.manifest.role ||
                        submission.manifest.id ||
                        "Draft role"}
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-4">
                    <StatusBadge submission={submission} />
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
                      Edit
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
  const submissionsApi = useSubmissions();
  const submissions = submissionsApi.list();
  const [activeId, setActiveId] = useState<string | null>(
    submissions[0]?.submission_id ?? null
  );
  const [message, setMessage] = useState<string | null>(null);
  const activeSubmission = activeId ? submissionsApi.get(activeId) : undefined;
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
    setMessage("New employee draft created.");
  }

  function saveDraft(values: CreatorFormValues) {
    if (!activeSubmission) return;

    const result = submissionsApi.updateDraft(
      activeSubmission.submission_id,
      formToManifest(values)
    );
    setMessage(result.message);
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
        ? result.message
        : `${result.message} ${result.missingFields?.join(", ") ?? ""}`.trim()
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
              Creator Console
            </Badge>
            <h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">
              Submit AI employees
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-crew-body">
              Create drafts, complete the employee manifest, and send it into
              review before it can become a Verified Employee.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/marketplace">Marketplace</Link>
            </Button>
            <Button
              asChild
              className="rounded-[8px] border-white/15"
              variant="outline"
            >
              <Link to="/review">Review queue</Link>
            </Button>
            <Button
              className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
              onClick={createNewDraft}
            >
              <Plus className="size-4" />
              New draft
            </Button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Metric
            icon={FileText}
            label="Drafts"
            value={drafts.length.toString()}
          />
          <Metric icon={Send} label="Pending" value={pendingCount.toString()} />
          <Metric
            icon={BadgeCheck}
            label="Published"
            value={published.length.toString()}
          />
        </section>

        {message ? (
          <Alert className="mt-6 rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <AlertCircle className="size-4 text-crew-copper" />
            <AlertTitle>Console update</AlertTitle>
            <AlertDescription className="text-crew-body">
              {message}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="space-y-5">
            <SubmissionTable
              empty="No drafts yet. Create a draft to start an employee package."
              onSelect={setActiveId}
              submissions={drafts}
              title="Drafts"
            />
            <SubmissionTable
              empty="No review status yet. Submitted employees appear here as Pending, Approved, or Rejected."
              onSelect={setActiveId}
              submissions={reviewStatuses}
              title="Review status"
            />
            <SubmissionTable
              empty="No Verified Employees published from this console yet."
              onSelect={setActiveId}
              submissions={published}
              title="Published employees"
            />
          </div>

          <Card className="rounded-[8px] border-white/10 bg-white/[0.03] text-crew-heading">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-xl font-semibold">
                    {activeSubmission
                      ? "Employee manifest"
                      : "No draft selected"}
                  </CardTitle>
                  <p className="mt-2 text-sm leading-6 text-crew-body">
                    All required fields must be complete before Submit is
                    enabled by validation.
                  </p>
                </div>
                {activeSubmission ? (
                  <StatusBadge submission={activeSubmission} />
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {!activeSubmission ? (
                <div className="rounded-[8px] border border-white/10 bg-white/[0.025] p-6">
                  <h2 className="text-xl font-light">Start with a draft.</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-crew-body">
                    Creator Console stores drafts locally for this front-end
                    demo.
                  </p>
                  <Button
                    className="mt-5 rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                    onClick={createNewDraft}
                  >
                    <Plus className="size-4" />
                    New draft
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
                        <AlertTitle>Rejected</AlertTitle>
                        <AlertDescription className="text-red-100/85">
                          {activeSubmission.rejection_reason}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {liveHighRiskPermissions.length > 0 ? (
                      <Alert className="rounded-[8px] border-amber-300/30 bg-amber-300/10 text-amber-100">
                        <ShieldAlert className="size-4" />
                        <AlertTitle>High-risk permissions flagged</AlertTitle>
                        <AlertDescription className="text-amber-100/85">
                          {liveHighRiskPermissions.join(", ")} will be
                          highlighted for operator review.
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
                              <FormLabel>id</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="macao-networking-agent"
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
                              <FormLabel>name</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="Macao Networking Agent"
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
                              <FormLabel>role</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="Macao Networking Specialist"
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
                              <FormLabel>version</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="1.0.0"
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
                              <FormLabel>creator</FormLabel>
                              <FormControl>
                                <Input
                                  className="rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="CrewClaw Labs"
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
                              <FormLabel>description</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="One-line employee promise."
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
                              <FormLabel>identity</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="Who this employee is and where it fits."
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
                              <FormLabel>soul</FormLabel>
                              <FormControl>
                                <Textarea
                                  className="min-h-28 rounded-[8px] border-white/10 bg-white/[0.04]"
                                  placeholder="Working style, principles, tone, and boundaries."
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
                          ["skills", "One skill per line."],
                          [
                            "tools",
                            "browser, calendar, contacts, or local tools.",
                          ],
                          [
                            "permissions",
                            "Use human-readable scopes such as read-only or mailbox:send.",
                          ],
                          [
                            "install_requirements",
                            "Onboarding requirements and environment needs.",
                          ],
                          ["input_examples", "Example user requests."],
                          ["output_examples", "Expected employee outputs."],
                          [
                            "limitations",
                            "Risks, boundaries, and failure cases.",
                          ],
                        ].map(([name, description]) => (
                          <FormField
                            control={form.control}
                            key={name}
                            name={name as keyof CreatorFormValues}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{name}</FormLabel>
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
                        Submitted at {formatDate(activeSubmission.submitted_at)}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              className="rounded-[8px] border-white/15"
                              variant="outline"
                            >
                              Preview manifest
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[80vh] overflow-auto rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading sm:max-w-3xl">
                            <DialogHeader>
                              <DialogTitle>
                                Contract manifest preview
                              </DialogTitle>
                              <DialogDescription className="text-crew-body">
                                This is the generated CrewClaw employee manifest
                                shape.
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
                              Save draft
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                                  type="button"
                                >
                                  <Send className="size-4" />
                                  Submit
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-[8px] border-white/10 bg-[#17120F] text-crew-heading">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Submit employee for review?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="leading-6 text-crew-body">
                                    Missing required manifest fields will block
                                    submission. High-risk permissions will stay
                                    flagged for the operator.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-[8px] border-white/15">
                                    Keep editing
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="rounded-[8px] bg-crew-copper text-white hover:bg-crew-bronze"
                                    onClick={form.handleSubmit(submitActive)}
                                  >
                                    Submit
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
