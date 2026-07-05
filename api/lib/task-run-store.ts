import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TaskEvent, TaskRun, ToolInvocation, WorkbenchArtifact } from "@/data/task-runs";

type RawTaskRun = {
  id: string;
  employee_id: string;
  user_goal: string;
  status: string;
  events: TaskEvent[];
  tool_invocations: ToolInvocation[];
  artifact: string | null;
  started_at: string;
  updated_at: string;
  output_valid?: boolean;
  effective?: boolean;
  user_feedback?: string;
  tokens?: number;
  cost?: number;
};

type RawArtifact = {
  id: string;
  task_id: string;
  type: string;
  title?: string;
  content?: string;
  status?: string;
  accepted?: boolean;
  created_at: string;
};

type ExpertRegistry = {
  experts?: {
    name: string;
    display_name?: string;
    description?: string;
  }[];
};

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

function capPreview(body: string): string {
  return body.split(/\r?\n/).slice(0, 200).join("\n");
}

function firstNonEmptyLine(body: string | undefined): string {
  return body?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function mapArtifactKind(type: string): WorkbenchArtifact["kind"] {
  const normalized = type.toLowerCase();
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("excel") || normalized.includes("xlsx")) return "excel";
  if (normalized.includes("docx") || normalized.includes("word")) return "docx";
  if (normalized.includes("pptx") || normalized.includes("slide")) return "pptx";
  if (normalized.includes("code")) return "code";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("report") || normalized.includes("research") || normalized.includes("markdown") || normalized.includes("prose")) {
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

async function loadRegistryExpert(employeeId: string): Promise<{ employee_name?: string; role?: string }> {
  const registryPath = path.resolve(process.cwd(), "registry", "experts.json");
  const registryBody = await readTextIfExists(registryPath);
  if (!registryBody) return {};

  const registry = parseJson<ExpertRegistry>(registryBody);
  const expert = registry.experts?.find((entry) => entry.name === employeeId);
  return {
    employee_name: expert?.display_name,
    role: expert?.description,
  };
}

async function loadArtifact(artifactId: string): Promise<WorkbenchArtifact | null> {
  const artifactJsonPath = path.resolve(process.cwd(), ".crewclaw", "artifacts", `${artifactId}.json`);
  const artifactBody = await readTextIfExists(artifactJsonPath);
  if (!artifactBody) return null;

  const artifact = parseJson<RawArtifact>(artifactBody);
  const artifactMarkdownPath = path.resolve(process.cwd(), ".crewclaw", "artifacts", `${artifactId}.md`);
  const markdown = await readTextIfExists(artifactMarkdownPath);
  const previewSource = markdown ?? artifact.content ?? "";

  return {
    id: artifact.id,
    name: `${artifact.id}.md`,
    kind: mapArtifactKind(artifact.type),
    path: `.crewclaw/artifacts/${artifact.id}.md`,
    status: mapArtifactStatus(artifact),
    summary: artifact.title?.trim() || firstNonEmptyLine(artifact.content) || artifact.id,
    checks: [],
    preview: capPreview(previewSource),
  };
}

// `id` arrives from the URL param, so it must never be able to escape the runs dir.
// Restrict to the safe charset the CLI actually uses for run ids (e.g. task_1782348262131).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export async function loadTaskRun(id: string): Promise<TaskRun | null> {
  if (!SAFE_ID.test(id)) return null;
  const runPath = path.resolve(process.cwd(), ".crewclaw", "runs", `${id}.json`);
  const runBody = await readTextIfExists(runPath);
  if (!runBody) return null;

  const run = parseJson<RawTaskRun>(runBody);
  const artifact = run.artifact ? await loadArtifact(run.artifact) : null;
  const reportPath = path.resolve(process.cwd(), ".crewclaw", "runs", `${run.id}.report.md`);
  const report = await readTextIfExists(reportPath);
  const expert = await loadRegistryExpert(run.employee_id);

  return {
    ...run,
    ...expert,
    artifacts: artifact ? [artifact] : [],
    pending_actions: [],
    inspect: {
      debug: [],
      raw_events: run.events.map((event) => event.type),
    },
    grade: { passed: !!run.output_valid, missing: [] },
    deliverable: report ?? artifact?.preview,
  };
}
