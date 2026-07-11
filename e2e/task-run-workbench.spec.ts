import { expect, test } from "@playwright/test";
import { getLatestTaskRun } from "../src/data/task-runs";

const run = getLatestTaskRun();
const primaryArtifact = run.artifacts[0];

test("task run workbench exposes artifact-first panels", async ({ page }) => {
  await page.goto(`/task-run/${run.id}`);

  await expect(page).toHaveTitle(/CrewClaw/);
  await expect(
    page.getByRole("heading", { name: run.user_goal })
  ).toBeVisible();
  await expect(page.getByText("TaskRun Workbench")).toBeVisible();

  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();
  await expect(page.getByText("员工动作")).toBeVisible();
  await expect(page.getByText(run.events[0].summary)).toBeVisible();
  await expect(page.getByText(run.events[2].summary)).toBeVisible();

  await expect(page.getByText("Artifacts", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: new RegExp(primaryArtifact.name.replace(".", "\\.")),
    })
  ).toBeVisible();

  // Panel labels are uppercase <p> headers; several strings (Tools/Preview) also appear as
  // Inspect <dt> terms, so scope the label assertions to the header paragraphs (exact) and
  // rely on the panel-specific content below them for the real signal.
  await expect(
    page.getByText("Preview", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: primaryArtifact.name })
  ).toBeVisible();
  await expect(
    page.getByText(primaryArtifact.preview.split("\n")[0])
  ).toBeVisible();

  await expect(page.getByText("Checks", { exact: true })).toBeVisible();
  await expect(page.getByText(primaryArtifact.checks[0].label)).toBeVisible();
  await expect(page.getByText(primaryArtifact.checks[1].label)).toBeVisible();

  await expect(page.getByText("工具与权限")).toBeVisible();
  await expect(page.getByText("web_search").first()).toBeVisible();
  await expect(page.getByText("success · allow").first()).toBeVisible();

  const inspectPanel = page
    .getByRole("heading", { name: "Debug / JSONL / Audit" })
    .locator("..");
  await expect(inspectPanel.getByText("Run Truth")).toBeVisible();
  await expect(inspectPanel.locator("pre")).toContainText(
    run.inspect.raw_events[1]
  );
});
