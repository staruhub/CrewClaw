import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  TaskEvent,
  TaskRun,
  ToolInvocation,
  WorkbenchArtifact,
} from "@/data/task-runs";

const MAX_STATE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REGISTRY_FILE_BYTES = 1024 * 1024;
const MAX_PUBLIC_PREVIEW_CHARS = 128 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SafeIdSchema = z.string().min(1).max(200).regex(SAFE_ID);

const TaskEventSchema = z.object({
  id: z.string().min(1).max(256),
  task_id: SafeIdSchema,
  type: z.string().min(1).max(256),
  summary: z.string().max(64 * 1024),
  tool_name: z.string().max(256).nullable(),
  status: z.string().max(256).nullable(),
  timestamp: z.string().min(1).max(256),
});

const ToolInvocationSchema = z.object({
  tool_name: z.string().min(1).max(256),
  input_summary: z.string().max(64 * 1024),
  permission_level: z.string().max(256).nullable(),
  decision: z.enum(["allow", "confirm", "deny"]),
  status: z.enum(["success", "blocked"]),
  action: z
    .string()
    .max(64 * 1024)
    .optional(),
});

const RawTaskRunSchema = z.object({
  id: SafeIdSchema,
  employee_id: SafeIdSchema,
  model: z.string().max(1024).optional(),
  user_goal: z.string().max(1024 * 1024),
  status: z.string().min(1).max(256),
  events: z.array(TaskEventSchema).max(20_000),
  tool_invocations: z.array(ToolInvocationSchema).max(20_000),
  artifact: SafeIdSchema.nullable(),
  started_at: z.string().min(1).max(256),
  updated_at: z.string().min(1).max(256),
  output_valid: z.boolean().optional(),
  effective: z.boolean().optional(),
  user_feedback: z.string().max(1024).optional(),
  tokens: z.number().finite().nonnegative().optional(),
  cost: z.number().finite().nonnegative().optional(),
});

const RawArtifactSchema = z.object({
  id: SafeIdSchema,
  task_id: SafeIdSchema,
  type: z.string().min(1).max(256),
  title: z
    .string()
    .max(64 * 1024)
    .optional(),
  content: z
    .string()
    .max(4 * 1024 * 1024)
    .optional(),
  status: z.string().max(256).optional(),
  accepted: z.boolean().optional(),
  created_at: z.string().min(1).max(256),
});

const ExpertRegistrySchema = z.object({
  experts: z
    .array(
      z.object({
        name: SafeIdSchema,
        display_name: z.string().max(1024).optional(),
        description: z
          .string()
          .max(16 * 1024)
          .optional(),
      })
    )
    .max(10_000)
    .optional(),
});

type RawTaskRun = z.infer<typeof RawTaskRunSchema>;
type RawArtifact = z.infer<typeof RawArtifactSchema>;

function pathsEqual(left: string, right: string): boolean {
  const normalizeComparablePath = (value: string) => {
    let normalized = value;
    if (normalized.startsWith("\\\\?\\UNC\\")) {
      normalized = `\\\\${normalized.slice(8)}`;
    } else if (normalized.startsWith("\\\\?\\")) {
      normalized = normalized.slice(4);
    }
    return path.normalize(normalized);
  };
  const normalizedLeft = normalizeComparablePath(left);
  const normalizedRight = normalizeComparablePath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const normalizeComparablePath = (value: string) => {
    if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
    if (value.startsWith("\\\\?\\")) return value.slice(4);
    return value;
  };
  const relativePath = path.relative(
    normalizeComparablePath(root),
    normalizeComparablePath(candidate)
  );
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>
): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1 &&
    right.nlink === 1 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function validateStateDirectory(
  workspaceRoot: string,
  relativeDirectory: string
): Promise<{ workspace: string; directory: string }> {
  const workspace = await realpath(path.resolve(workspaceRoot));
  const workspaceMetadata = await lstat(workspace);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    throw new Error("unsafe workspace state root");
  }

  const directory = path.resolve(workspace, relativeDirectory);
  if (!pathIsWithin(workspace, directory)) {
    throw new Error("unsafe workspace state directory");
  }
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("unsafe workspace state directory");
  }
  const canonicalDirectory = await realpath(directory);
  if (
    !pathsEqual(canonicalDirectory, directory) ||
    !pathIsWithin(workspace, canonicalDirectory)
  ) {
    throw new Error("unsafe workspace state directory");
  }
  return { workspace, directory };
}

async function readFileHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  expectedBytes: number
): Promise<Buffer> {
  const data = Buffer.alloc(expectedBytes);
  let offset = 0;
  while (offset < expectedBytes) {
    const { bytesRead } = await handle.read(
      data,
      offset,
      expectedBytes - offset,
      offset
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const probe = Buffer.alloc(1);
  const { bytesRead: extraBytes } = await handle.read(probe, 0, 1, offset);
  if (offset !== expectedBytes || extraBytes !== 0) {
    throw new Error("workspace state file changed while reading");
  }
  return data;
}

/** Read one direct child of a fixed workspace-state namespace without following links. */
async function readWorkspaceStateText(
  workspaceRoot: string,
  relativeDirectory: string,
  fileName: string,
  maxBytes = MAX_STATE_FILE_BYTES
): Promise<string | null> {
  if (path.basename(fileName) !== fileName || path.isAbsolute(fileName)) {
    throw new Error("unsafe workspace state filename");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("invalid workspace state size limit");
  }

  let boundary;
  try {
    boundary = await validateStateDirectory(workspaceRoot, relativeDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
  const candidate = path.resolve(boundary.directory, fileName);
  if (!pathIsWithin(boundary.directory, candidate)) {
    throw new Error("unsafe workspace state path");
  }

  let before;
  try {
    before = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size <= 0 ||
    before.size > maxBytes
  ) {
    throw new Error("unsafe workspace state file");
  }
  const canonicalCandidate = await realpath(candidate);
  if (
    !pathsEqual(canonicalCandidate, candidate) ||
    !pathIsWithin(boundary.directory, canonicalCandidate)
  ) {
    throw new Error("unsafe workspace state file");
  }

  const handle = await open(
    candidate,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  );
  try {
    const opened = await handle.stat();
    if (!sameFileIdentity(before, opened)) {
      throw new Error("workspace state file changed before open");
    }
    const data = await readFileHandleBounded(handle, opened.size);
    const afterRead = await handle.stat();
    if (!sameFileIdentity(opened, afterRead)) {
      throw new Error("workspace state file changed while reading");
    }

    const after = await lstat(candidate);
    const afterCanonical = await realpath(candidate);
    const revalidatedBoundary = await validateStateDirectory(
      workspaceRoot,
      relativeDirectory
    );
    if (
      !sameFileIdentity(afterRead, after) ||
      !pathsEqual(afterCanonical, candidate) ||
      !pathsEqual(revalidatedBoundary.directory, boundary.directory)
    ) {
      throw new Error("workspace state path changed while reading");
    }
    return data.toString("utf8");
  } finally {
    await handle.close();
  }
}

function capPreview(body: string): string {
  return body
    .split(/\r?\n/)
    .slice(0, 200)
    .join("\n")
    .slice(0, MAX_PUBLIC_PREVIEW_CHARS);
}

function firstNonEmptyLine(body: string | undefined): string {
  return (
    body
      ?.split(/\r?\n/)
      .find(line => line.trim().length > 0)
      ?.trim()
      .slice(0, 4096) ?? ""
  );
}

function mapArtifactKind(type: string): WorkbenchArtifact["kind"] {
  const normalized = type.toLowerCase();
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("excel") || normalized.includes("xlsx"))
    return "excel";
  if (normalized.includes("docx") || normalized.includes("word")) return "docx";
  if (normalized.includes("pptx") || normalized.includes("slide"))
    return "pptx";
  if (normalized.includes("code")) return "code";
  if (normalized.includes("json")) return "json";
  if (
    normalized.includes("report") ||
    normalized.includes("research") ||
    normalized.includes("markdown") ||
    normalized.includes("prose")
  ) {
    return "markdown";
  }
  return "unknown";
}

function mapArtifactStatus(artifact: RawArtifact): WorkbenchArtifact["status"] {
  if (artifact.accepted === true) return "accepted";

  switch (artifact.status) {
    case "draft":
    case "ready":
    case "needs_review":
    case "accepted":
    case "rejected":
    case "exported":
    case "deleted":
      return artifact.status;
    case "delivered":
    default:
      return "ready";
  }
}

async function loadRegistryExpert(
  employeeId: string,
  workspaceRoot: string
): Promise<{ employee_name?: string; role?: string }> {
  const registryBody = await readWorkspaceStateText(
    workspaceRoot,
    "registry",
    "experts.json",
    MAX_REGISTRY_FILE_BYTES
  );
  if (!registryBody) return {};

  const registry = ExpertRegistrySchema.parse(JSON.parse(registryBody));
  const expert = registry.experts?.find(entry => entry.name === employeeId);
  return {
    employee_name: expert?.display_name,
    role: expert?.description,
  };
}

async function loadArtifact(
  workspaceRoot: string,
  artifactId: string,
  taskRunId: string
): Promise<WorkbenchArtifact | null> {
  if (!SafeIdSchema.safeParse(artifactId).success) {
    throw new Error("invalid artifact id");
  }
  const artifactBody = await readWorkspaceStateText(
    workspaceRoot,
    path.join(".crewclaw", "artifacts"),
    `${artifactId}.json`
  );
  if (!artifactBody) return null;

  const artifact = RawArtifactSchema.parse(JSON.parse(artifactBody));
  if (artifact.id !== artifactId || artifact.task_id !== taskRunId) {
    throw new Error("artifact identity mismatch");
  }
  const markdown = await readWorkspaceStateText(
    workspaceRoot,
    path.join(".crewclaw", "artifacts"),
    `${artifactId}.md`
  );
  const previewSource = markdown ?? artifact.content ?? "";

  return {
    id: artifact.id,
    name: `${artifact.id}.md`,
    kind: mapArtifactKind(artifact.type),
    path: `.crewclaw/artifacts/${artifact.id}.md`,
    status: mapArtifactStatus(artifact),
    summary:
      artifact.title?.trim().slice(0, 4096) ||
      firstNonEmptyLine(artifact.content) ||
      artifact.id,
    checks: [],
    preview: capPreview(previewSource),
  };
}

function publicTaskRunProjection(
  run: RawTaskRun,
  artifact: WorkbenchArtifact | null,
  report: string | null,
  expert: { employee_name?: string; role?: string }
): TaskRun {
  return {
    id: run.id,
    employee_id: run.employee_id,
    ...(expert.employee_name ? { employee_name: expert.employee_name } : {}),
    ...(expert.role ? { role: expert.role } : {}),
    ...(run.model ? { model: run.model } : {}),
    user_goal: run.user_goal,
    status: run.status,
    events: run.events as TaskEvent[],
    tool_invocations: run.tool_invocations as ToolInvocation[],
    artifact: run.artifact,
    artifacts: artifact ? [artifact] : [],
    pending_actions: [],
    inspect: {
      debug: [],
      raw_events: run.events.map(event => event.type),
    },
    ...(run.output_valid === undefined
      ? {}
      : { output_valid: run.output_valid }),
    ...(run.effective === undefined ? {} : { effective: run.effective }),
    ...(run.user_feedback === undefined
      ? {}
      : { user_feedback: run.user_feedback }),
    ...(run.tokens === undefined ? {} : { tokens: run.tokens }),
    ...(run.cost === undefined ? {} : { cost: run.cost }),
    started_at: run.started_at,
    updated_at: run.updated_at,
    grade: { passed: run.output_valid === true, missing: [] },
    ...(report || artifact?.preview
      ? { deliverable: capPreview(report ?? artifact?.preview ?? "") }
      : {}),
  };
}

export async function loadTaskRun(
  id: string,
  { root = process.cwd() }: { root?: string } = {}
): Promise<TaskRun | null> {
  if (!SafeIdSchema.safeParse(id).success) return null;
  try {
    const runBody = await readWorkspaceStateText(
      root,
      path.join(".crewclaw", "runs"),
      `${id}.json`
    );
    if (!runBody) return null;

    const run = RawTaskRunSchema.parse(JSON.parse(runBody));
    if (run.id !== id || run.events.some(event => event.task_id !== id)) {
      return null;
    }
    const artifact = run.artifact
      ? await loadArtifact(root, run.artifact, run.id)
      : null;
    const report = await readWorkspaceStateText(
      root,
      path.join(".crewclaw", "runs"),
      `${id}.report.md`
    );
    const expert = await loadRegistryExpert(run.employee_id, root);
    return publicTaskRunProjection(run, artifact, report, expert);
  } catch {
    // This is a public endpoint. Unsafe/corrupt state is indistinguishable from a missing run so
    // filesystem layout, link targets and parser details never cross the HTTP boundary.
    return null;
  }
}
