import { expect, test } from "@playwright/test";

test("task run workbench exposes artifact-first panels", async ({ page }) => {
  await page.goto("/task-run/task_1719306072000");

  await expect(page).toHaveTitle(/CrewClaw/);
  await expect(page.getByRole("heading", { name: "调研火山 Seed 2.1，判断是否适合接入 CrewClaw" })).toBeVisible();
  await expect(page.getByText("TaskRun Workbench")).toBeVisible();

  await expect(page.getByText("Timeline")).toBeVisible();
  await expect(page.getByText("员工动作")).toBeVisible();
  await expect(page.getByText("制定研究计划")).toBeVisible();
  await expect(page.getByText("已拦截越权操作：write_crm")).toBeVisible();

  await expect(page.getByText("Artifacts")).toBeVisible();
  await expect(page.getByRole("button", { name: /seed-2\.1-research\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /seed-2\.1-evidence\.json/ })).toBeVisible();

  await expect(page.getByText("Preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "seed-2.1-research.md" })).toBeVisible();
  await expect(page.getByText("接入建议：先接入 Ark API 做离线评测")).toBeVisible();

  await page.getByRole("button", { name: /seed-2\.1-evidence\.json/ }).click();
  await expect(page.getByRole("heading", { name: "seed-2.1-evidence.json" })).toBeVisible();
  await expect(page.getByText('"sources": 3')).toBeVisible();

  await expect(page.getByText("Checks")).toBeVisible();
  await expect(page.getByText("验收")).toBeVisible();
  await expect(page.getByText("有效任务")).toBeVisible();
  await expect(page.getByText("✓ useful")).toBeVisible();

  await expect(page.getByText("Tools")).toBeVisible();
  await expect(page.getByText("工具与权限")).toBeVisible();
  await expect(page.getByText("write_crm")).toBeVisible();
  await expect(page.getByText("blocked · deny")).toBeVisible();

  await expect(page.getByText("Inspect")).toBeVisible();
  await expect(page.getByText("Debug / JSONL / Audit")).toBeVisible();
  await expect(page.getByText("Run Truth")).toBeVisible();
  await expect(page.getByText("artifact.write path=.crewclaw/artifacts/task_1719306072000/seed-2.1-research.md")).toBeVisible();

  await page.getByRole("button", { name: /Run pending action 3: 导出报告/ }).click();
  await expect(page.getByText("pending.run 3 export_report")).toBeVisible();
});
