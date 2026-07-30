import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getLatestTaskRun } from "../src/data/task-runs";
import { localizeTaskRun } from "../src/i18n/task-run-content";

export async function seedTaskRunFixture(root: string) {
  const run = getLatestTaskRun();
  const localizedRun = localizeTaskRun(run, "en");
  const fixtureArtifact = localizedRun.artifacts[0];
  if (!run.artifact || !fixtureArtifact) {
    throw new Error("TaskRun E2E requires an artifact fixture");
  }

  const runs = join(root, ".crewclaw", "runs");
  const artifacts = join(root, ".crewclaw", "artifacts");
  await mkdir(runs, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    join(runs, `${run.id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(artifacts, `${run.artifact}.json`),
    `${JSON.stringify(
      {
        id: run.artifact,
        task_id: run.id,
        type: "report",
        title: fixtureArtifact.summary,
        content: fixtureArtifact.preview,
        status: "accepted",
        accepted: true,
        created_at: run.started_at,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(artifacts, `${run.artifact}.md`),
    `${fixtureArtifact.preview}\n`,
    "utf8"
  );
  await writeFile(
    join(runs, `${run.id}.evidence.json`),
    `${JSON.stringify([{ source_url: run.sources?.[0] }], null, 2)}\n`,
    "utf8"
  );
}
