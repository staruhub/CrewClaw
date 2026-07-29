import { expect, test } from "@playwright/test";
import { getLatestTaskRun } from "../src/data/task-runs";

const run = getLatestTaskRun();
const primaryArtifact = run.artifacts[0];

test("task run workbench exposes event-driven supervision panels", async ({
  page,
}) => {
  await page.goto(`/task-run/${run.id}`);

  await expect(page).toHaveTitle(/CrewClaw/);
  await expect(
    page.getByRole("heading", { name: run.user_goal })
  ).toBeVisible();
  await expect(page.getByText("[1] Workbench", { exact: true })).toBeVisible();

  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();
  await expect(page.getByText("员工动作")).toBeVisible();
  await expect(page.getByText(run.events[0].summary)).toBeVisible();
  await expect(page.getByText(run.events[2].summary)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Time" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Actor" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Title" })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Progress / cost" })
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Status" })
  ).toBeVisible();

  await expect(page.getByText("Employee", { exact: true })).toBeVisible();
  await expect(page.getByText("Queue", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Event detail")).toBeVisible();
  const firstTimelineRow = page.getByRole("row").filter({
    has: page.getByText(run.events[0].summary),
  });
  await firstTimelineRow.focus();
  await expect(firstTimelineRow).toBeFocused();
  await expect(firstTimelineRow).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(firstTimelineRow).toHaveAttribute("aria-selected", "true");
  const eventDetail = page
    .getByRole("heading", { name: "Event detail" })
    .locator("..");
  await expect(eventDetail).toContainText(run.events[0].summary);

  await expect(
    page.getByText("Artifacts", { exact: true }).last()
  ).toBeVisible();
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
  await expect(
    page.getByText(primaryArtifact.checks[0].label).first()
  ).toBeVisible();
  await expect(
    page.getByText(primaryArtifact.checks[1].label).first()
  ).toBeVisible();

  await expect(
    page.getByText("Evidence", { exact: true }).last()
  ).toBeVisible();
  await expect(page.getByText("审批前证据")).toBeVisible();
  await page
    .getByRole("button", { name: /Inspect evidence/i })
    .first()
    .click();
  await expect(page.getByText("Inspect selected evidence")).toBeVisible();

  await expect(page.getByText("Approval", { exact: true })).toBeVisible();
  await expect(page.getByText("人工交付门禁")).toBeVisible();
  await expect(page.getByText("Accept delivery")).toBeVisible();
  await page
    .getByPlaceholder("Missing source, wrong scope, unclear claim...")
    .fill("Price source is not current enough");
  await page
    .getByPlaceholder("Ask employee to revise pricing section...")
    .fill("Re-check pricing against official source");
  await page.getByRole("button", { name: "Create revision" }).click();
  await expect(page.getByText(/pending\.run \{"type":/)).toBeVisible();
  await expect(page.getByText(/"reason":/)).toBeVisible();
  await expect(page.getByText(/"revisionTask":/)).toBeVisible();

  await expect(page.getByText("工具与权限")).toBeVisible();
  const toolAudit = page
    .getByRole("heading", { name: "工具与权限" })
    .locator("..");
  const searchRow = toolAudit.getByRole("row").filter({
    has: page.getByText("web.search", { exact: true }),
  });
  const searchCells = searchRow.getByRole("cell");
  await expect(searchCells.nth(0)).toContainText("web_search");
  await expect(searchCells.nth(0)).toContainText("web.search");
  await expect(searchCells.nth(2)).toContainText("employee policy");
  await expect(searchCells.nth(2)).toContainText("L0 · allow");
  await expect(searchCells.nth(3)).toContainText("success");
  await expect(searchCells.nth(4)).toHaveText("842 ms");

  const fetchRow = toolAudit.getByRole("row").filter({
    has: page.getByText("web.fetch_extract", { exact: true }),
  });
  await expect(fetchRow.getByRole("cell").nth(0)).toContainText("web_fetch");

  const inspectPanel = page
    .getByRole("heading", { name: "Debug / JSONL / Audit" })
    .locator("..");
  await expect(inspectPanel.getByText("Run Truth")).toBeVisible();
  await expect(inspectPanel.locator("pre")).toContainText(
    run.inspect.raw_events[1]
  );
});
