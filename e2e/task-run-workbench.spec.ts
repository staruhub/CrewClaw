import { expect, test } from "@playwright/test";

test("task run workbench exposes artifact-first panels", async ({ page }) => {
  await page.goto("/task-run/task_1782348262131");

  await expect(page).toHaveTitle(/CrewClaw/);
  await expect(page.getByRole("heading", { name: /调研火山引擎 Seed 2\.1/ })).toBeVisible();
  await expect(page.getByText("TaskRun Workbench")).toBeVisible();

  await expect(page.getByText("Timeline")).toBeVisible();
  await expect(page.getByText("员工动作")).toBeVisible();
  await expect(page.getByText("-> planned")).toBeVisible();
  await expect(page.getByText("正在阅读 en.wikipedia.org")).toBeVisible();

  await expect(page.getByText("Artifacts")).toBeVisible();
  await expect(page.getByRole("button", { name: /artifact_1782348310459\.md/ })).toBeVisible();

  await expect(page.getByText("Preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "artifact_1782348310459.md" })).toBeVisible();
  await expect(page.getByText("（已达工具调用步数上限）")).toBeVisible();

  await expect(page.getByText("Checks")).toBeVisible();
  await expect(page.getByText("验收")).toBeVisible();
  await expect(page.getByText("有效任务")).toBeVisible();
  await expect(page.getByText("✗ missing feedback")).toBeVisible();

  await expect(page.getByText("Tools")).toBeVisible();
  await expect(page.getByText("工具与权限")).toBeVisible();
  await expect(page.getByText("web_search")).toBeVisible();
  await expect(page.getByText("success · allow")).toBeVisible();

  await expect(page.getByText("Inspect")).toBeVisible();
  await expect(page.getByText("Debug / JSONL / Audit")).toBeVisible();
  await expect(page.getByText("Run Truth")).toBeVisible();
  await expect(page.getByText("tool_called")).toBeVisible();
});
