import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import {
  AcceptedTaskProjectionSchema,
  SubmitVerifiedReviewSchema,
  VerifiedEmployeeReviewSchema,
  type AcceptedTaskProjection,
} from "../../contracts/local-review";
import {
  LocalTeamError,
  readLocalTeam,
  type LocalTeamOptions,
} from "./local-team";
import {
  listStateFiles,
  readStateFile,
  withStateOwnerLock,
  writeStateFileAtomic,
} from "./local-state";

function rootFor(options: LocalTeamOptions) {
  return resolve(options.root ?? process.env.CREWCLAW_ROOT ?? process.cwd());
}

async function readReviews(root: string, employeeId: string) {
  const bytes = await readStateFile(
    root,
    `reviews/${employeeId}.json`,
    1024 * 1024
  );
  if (!bytes) return [];
  return z
    .array(VerifiedEmployeeReviewSchema)
    .max(4_096)
    .parse(JSON.parse(bytes.toString("utf8")));
}

export async function listAcceptedTasks(
  employeeId: string,
  options: LocalTeamOptions = {}
): Promise<AcceptedTaskProjection[]> {
  const root = rootFor(options);
  const team = await readLocalTeam(options);
  if (!team.some(record => record.employee_id === employeeId)) return [];
  const reviews = await readReviews(root, employeeId);
  const reviewed = new Set(reviews.map(review => review.task_run_id));
  const files = await listStateFiles(root, "runs");
  const tasks: AcceptedTaskProjection[] = [];

  for (const file of files) {
    const match = /^runs\/([A-Za-z0-9_-]+)\.json$/.exec(file);
    if (!match) continue;
    const taskRunId = match[1];
    const runBytes = await readStateFile(root, file, 1024 * 1024);
    if (!runBytes) continue;
    let run: Record<string, unknown>;
    try {
      run = JSON.parse(runBytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      run.id !== taskRunId ||
      run.employee_id !== employeeId ||
      run.status !== "accepted"
    ) {
      continue;
    }
    const proofBytes = await readStateFile(
      root,
      `runs/${taskRunId}.proofpack.json`,
      1024 * 1024
    );
    if (!proofBytes) continue;
    let proof: Record<string, unknown>;
    try {
      proof = JSON.parse(proofBytes.toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }
    const approval = proof.user_approval as Record<string, unknown> | undefined;
    if (proof.task_run_id !== taskRunId || approval?.decision !== "accept")
      continue;
    const acceptedAt =
      typeof approval.at === "string"
        ? approval.at
        : typeof run.updated_at === "string"
          ? run.updated_at
          : new Date(0).toISOString();
    tasks.push(
      AcceptedTaskProjectionSchema.parse({
        task_run_id: taskRunId,
        goal:
          typeof run.user_goal === "string" ? run.user_goal : "Accepted task",
        accepted_at: acceptedAt,
        reviewed: reviewed.has(taskRunId),
      })
    );
  }
  return tasks.sort((left, right) =>
    right.accepted_at.localeCompare(left.accepted_at)
  );
}

export async function readVerifiedReviewState(
  employeeId: string,
  options: LocalTeamOptions = {}
) {
  const root = rootFor(options);
  return {
    accepted_tasks: await listAcceptedTasks(employeeId, options),
    verified_reviews: await readReviews(root, employeeId),
  };
}

export async function submitVerifiedReview(
  employeeId: string,
  inputValue: unknown,
  options: LocalTeamOptions = {}
) {
  const input = SubmitVerifiedReviewSchema.parse(inputValue);
  const root = rootFor(options);
  const team = await readLocalTeam(options);
  if (!team.some(record => record.employee_id === employeeId)) {
    throw new LocalTeamError(
      "Hire this employee before reviewing its work.",
      409,
      "EMPLOYEE_NOT_HIRED"
    );
  }
  const relative = `reviews/${employeeId}.json`;
  return withStateOwnerLock(root, relative, async () => {
    const tasks = await listAcceptedTasks(employeeId, options);
    const task = tasks.find(
      candidate => candidate.task_run_id === input.task_run_id
    );
    if (!task) {
      throw new LocalTeamError(
        "This review must reference a real accepted TaskRun receipt.",
        422,
        "ACCEPTED_TASK_REQUIRED"
      );
    }
    const reviews = await readReviews(root, employeeId);
    if (reviews.some(review => review.task_run_id === input.task_run_id)) {
      throw new LocalTeamError(
        "This accepted task has already been reviewed.",
        409,
        "TASK_ALREADY_REVIEWED"
      );
    }
    const review = VerifiedEmployeeReviewSchema.parse({
      id: `review:${employeeId}:${randomUUID()}`,
      employee_id: employeeId,
      task_run_id: input.task_run_id,
      rating: input.rating,
      text: input.text,
      created_at: new Date().toISOString(),
    });
    const next = [...reviews, review];
    await writeStateFileAtomic(
      root,
      relative,
      Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8")
    );
    return {
      review,
      verified_reviews: next,
      accepted_tasks: tasks.map(candidate =>
        candidate.task_run_id === review.task_run_id
          ? { ...candidate, reviewed: true }
          : candidate
      ),
    };
  });
}
