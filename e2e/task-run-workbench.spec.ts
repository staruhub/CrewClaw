import { expect, test } from "@playwright/test";
import { getLatestTaskRun } from "../src/data/task-runs";
import { localizeTaskRun } from "../src/i18n/task-run-content";

const run = getLatestTaskRun();
const localizedRun = localizeTaskRun(run, "en");
const fixtureArtifact = localizedRun.artifacts[0];
const primaryArtifactName = `${run.artifact}.md`;

test("task run workbench exposes event-driven supervision panels", async ({
  page,
}) => {
  await page.goto(`/task-run/${run.id}`);

  await expect(page).toHaveTitle(/CrewClaw/);
  await expect(
    page.getByRole("heading", { name: localizedRun.user_goal })
  ).toBeVisible();
  await expect(page.getByText("[1] Workbench", { exact: true })).toBeVisible();

  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();
  await expect(page.getByText("Employee actions")).toBeVisible();
  await expect(page.getByText(localizedRun.events[0].summary)).toBeVisible();
  await expect(page.getByText(localizedRun.events[2].summary)).toBeVisible();
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
    has: page.getByText(localizedRun.events[0].summary),
  });
  await firstTimelineRow.focus();
  await expect(firstTimelineRow).toBeFocused();
  await expect(firstTimelineRow).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(firstTimelineRow).toHaveAttribute("aria-selected", "true");
  const eventDetail = page
    .getByRole("heading", { name: "Event detail" })
    .locator("..");
  await expect(eventDetail).toContainText(localizedRun.events[0].summary);

  await expect(
    page.getByText("Artifacts", { exact: true }).last()
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: new RegExp(primaryArtifactName.replace(".", "\\.")),
    })
  ).toBeVisible();

  // Panel labels are uppercase <p> headers; several strings (Tools/Preview) also appear as
  // Inspect <dt> terms, so scope the label assertions to the header paragraphs (exact) and
  // rely on the panel-specific content below them for the real signal.
  await expect(
    page.getByText("Preview", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: primaryArtifactName })
  ).toBeVisible();
  await expect(
    page.getByText(fixtureArtifact.preview.split("\n")[0])
  ).toBeVisible();

  await expect(page.getByText("Checks", { exact: true })).toBeVisible();
  await expect(page.getByText(/useful/)).toBeVisible();

  await expect(
    page.getByText("Evidence", { exact: true }).last()
  ).toBeVisible();
  await expect(page.getByText("Pre-approval evidence")).toBeVisible();
  await page
    .getByRole("button", { name: /Inspect evidence/i })
    .first()
    .click();
  await expect(page.getByText("Inspect selected evidence")).toBeVisible();

  await expect(page.getByText("Approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Human delivery gate")).toBeVisible();
  await expect(
    page.getByText(/read-only projection of persisted TaskRun evidence/i)
  ).toBeVisible();
  await expect(
    page.getByText(/Open the CrewClaw TUI to execute/i)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept delivery" })
  ).toHaveCount(0);

  await expect(page.getByText("Tools and permissions")).toBeVisible();
  const toolAudit = page
    .getByRole("heading", { name: "Tools and permissions" })
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
