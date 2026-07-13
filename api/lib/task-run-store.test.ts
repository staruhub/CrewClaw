import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTaskRun } from "./task-run-store";

const roots: string[] = [];

async function temporaryRoot(prefix = "crew-task-api-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function taskRun(id = "task-safe", artifact: string | null = "artifact-safe") {
  return {
    id,
    employee_id: "code-review-shrimp",
    model: "test/model",
    user_goal: "review the boundary",
    status: "delivered",
    events: [
      {
        id: "evt_1",
        task_id: id,
        type: "state_changed",
        summary: "-> delivered",
        tool_name: null,
        status: null,
        timestamp: "2026-07-11T00:00:00.000Z",
      },
    ],
    tool_invocations: [] as Array<Record<string, unknown>>,
    artifact,
    started_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:01.000Z",
    output_valid: true,
    private_state: "must-not-cross-public-projection",
  };
}

async function seedRun(root: string, run = taskRun()) {
  const runs = path.join(root, ".crewclaw", "runs");
  const artifacts = path.join(root, ".crewclaw", "artifacts");
  await mkdir(runs, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    path.join(runs, `${run.id}.json`),
    `${JSON.stringify(run)}\n`
  );
  if (run.artifact && /^[A-Za-z0-9_-]+$/.test(run.artifact)) {
    await writeFile(
      path.join(artifacts, `${run.artifact}.json`),
      `${JSON.stringify({
        id: run.artifact,
        task_id: run.id,
        type: "research_report",
        title: "Safe report",
        status: "delivered",
        accepted: false,
        created_at: "2026-07-11T00:00:01.000Z",
        private_metadata: "must-not-cross-public-projection",
      })}\n`
    );
    await writeFile(
      path.join(artifacts, `${run.artifact}.md`),
      "# Safe report\nreviewed bytes\n"
    );
  }
  return { runs, artifacts };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("public task-run state boundary", () => {
  it("loads a valid run through a whitelist projection", async () => {
    const root = await temporaryRoot();
    await seedRun(root);

    const loaded = await loadTaskRun("task-safe", { root });

    expect(loaded?.id).toBe("task-safe");
    expect(loaded?.artifacts[0]?.preview).toContain("reviewed bytes");
    expect(loaded).not.toHaveProperty("private_state");
    expect(loaded?.artifacts[0]).not.toHaveProperty("private_metadata");
  });

  it("projects runtime audit timestamps and non-success terminal tool states", async () => {
    const root = await temporaryRoot();
    const run = {
      ...taskRun("task-audit", null),
      tool_invocations: [
        {
          tool_name: "web_fetch",
          capability: "web.fetch",
          input_summary: "https://example.test",
          permission_level: "L0",
          decision_source: "employee_policy",
          decision: "allow",
          status: "error",
          started_at: "2026-07-11T00:00:00.100Z",
          ended_at: "2026-07-11T00:00:00.942Z",
        },
        {
          tool_name: "web_search",
          input_summary: "query",
          permission_level: "L0",
          decision: "allow",
          status: "cancelled",
          elapsed_ms: 500,
        },
      ],
    };
    await seedRun(root, run);

    const loaded = await loadTaskRun("task-audit", { root });

    expect(loaded?.tool_invocations).toMatchObject([
      {
        capability: "web.fetch",
        decision_source: "employee_policy",
        status: "error",
        started_at: "2026-07-11T00:00:00.100Z",
        ended_at: "2026-07-11T00:00:00.942Z",
      },
      { status: "cancelled", elapsed_ms: 500 },
    ]);
  });

  it.each(["../../leak", "C:\\Users\\Public\\leak"])(
    "rejects an artifact id that could escape the artifact namespace: %s",
    async artifactId => {
      const root = await temporaryRoot();
      const run = taskRun("task-safe", artifactId);
      const { runs } = await seedRun(root, { ...run, artifact: null });
      await writeFile(
        path.join(runs, "task-safe.json"),
        `${JSON.stringify(run)}\n`
      );
      await writeFile(path.join(root, "leak.json"), "{}\n");
      await writeFile(path.join(root, "leak.md"), "SECRET\n");

      expect(await loadTaskRun("task-safe", { root })).toBeNull();
    }
  );

  it("rejects a persisted run id that differs from the requested id", async () => {
    const root = await temporaryRoot();
    const { runs } = await seedRun(root);
    await writeFile(
      path.join(runs, "task-safe.json"),
      `${JSON.stringify(taskRun("other-task", null))}\n`
    );

    expect(await loadTaskRun("task-safe", { root })).toBeNull();
  });

  it("rejects hardlinked run and artifact files", async () => {
    const runRoot = await temporaryRoot("crew-task-api-run-link-");
    const outsideRun = path.join(runRoot, "outside-run.json");
    const runs = path.join(runRoot, ".crewclaw", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(
      outsideRun,
      `${JSON.stringify(taskRun("task-safe", null))}\n`
    );
    await link(outsideRun, path.join(runs, "task-safe.json"));
    expect(await loadTaskRun("task-safe", { root: runRoot })).toBeNull();

    const artifactRoot = await temporaryRoot("crew-task-api-artifact-link-");
    const { artifacts } = await seedRun(artifactRoot);
    const artifactPath = path.join(artifacts, "artifact-safe.md");
    await rm(artifactPath);
    const outsideArtifact = path.join(artifactRoot, "outside-artifact.md");
    await writeFile(outsideArtifact, "SECRET\n");
    await link(outsideArtifact, artifactPath);
    expect(await loadTaskRun("task-safe", { root: artifactRoot })).toBeNull();
  });

  it("rejects a hardlinked report and an oversized artifact", async () => {
    const reportRoot = await temporaryRoot("crew-task-api-report-link-");
    const { runs } = await seedRun(reportRoot);
    const outsideReport = path.join(reportRoot, "outside-report.md");
    await writeFile(outsideReport, "SECRET\n");
    await link(outsideReport, path.join(runs, "task-safe.report.md"));
    expect(await loadTaskRun("task-safe", { root: reportRoot })).toBeNull();

    const artifactRoot = await temporaryRoot("crew-task-api-artifact-large-");
    const { artifacts } = await seedRun(artifactRoot);
    await writeFile(
      path.join(artifacts, "artifact-safe.md"),
      Buffer.alloc(8 * 1024 * 1024 + 1, 65)
    );
    expect(await loadTaskRun("task-safe", { root: artifactRoot })).toBeNull();
  });

  it("rejects a runs-directory junction or symlink", async () => {
    const root = await temporaryRoot("crew-task-api-junction-");
    const outside = await temporaryRoot("crew-task-api-junction-outside-");
    await mkdir(path.join(root, ".crewclaw"), { recursive: true });
    await writeFile(
      path.join(outside, "task-safe.json"),
      `${JSON.stringify(taskRun("task-safe", null))}\n`
    );
    await symlink(
      outside,
      path.join(root, ".crewclaw", "runs"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(await loadTaskRun("task-safe", { root })).toBeNull();
  });

  it("rejects an artifacts-directory junction or symlink", async () => {
    const root = await temporaryRoot("crew-task-api-artifact-junction-");
    const outside = await temporaryRoot(
      "crew-task-api-artifact-junction-outside-"
    );
    const runs = path.join(root, ".crewclaw", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(
      path.join(runs, "task-safe.json"),
      `${JSON.stringify(taskRun())}\n`
    );
    await mkdir(path.join(root, ".crewclaw"), { recursive: true });
    await writeFile(
      path.join(outside, "artifact-safe.json"),
      `${JSON.stringify({
        id: "artifact-safe",
        task_id: "task-safe",
        type: "research_report",
        created_at: "2026-07-11T00:00:01.000Z",
      })}\n`
    );
    await writeFile(path.join(outside, "artifact-safe.md"), "SECRET\n");
    await symlink(
      outside,
      path.join(root, ".crewclaw", "artifacts"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(await loadTaskRun("task-safe", { root })).toBeNull();
  });

  it("rejects oversized state before parsing it", async () => {
    const root = await temporaryRoot("crew-task-api-oversized-");
    const runs = path.join(root, ".crewclaw", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(
      path.join(runs, "task-safe.json"),
      Buffer.alloc(8 * 1024 * 1024 + 1, 65)
    );

    expect(await loadTaskRun("task-safe", { root })).toBeNull();
  });
});
