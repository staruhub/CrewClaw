import { expect, test, type Page } from "@playwright/test";
import { getLatestTaskRun } from "../src/data/task-runs";
import { commonEn } from "../src/i18n/locales/en/common";
import { commonZhCN } from "../src/i18n/locales/zh-CN/common";
import { localeStorageKey } from "../src/i18n/locale";

const run = getLatestTaskRun();

test.use({ locale: "en-US" });

async function gotoWithClearedLocale(page: Page, path: string) {
  await page.goto("/");
  await page.evaluate(key => {
    window.localStorage.removeItem(key);
  }, localeStorageKey);
  await page.goto(path);
}

async function switchToChinese(page: Page) {
  await page
    .getByTestId("locale-switcher")
    .first()
    .getByRole("button", { name: /Simplified Chinese|简体中文/ })
    .click();
}

async function switchToEnglish(page: Page) {
  await page
    .getByTestId("locale-switcher")
    .first()
    .getByRole("button", { name: "English" })
    .click();
}

test("renders the public chrome in English by default", async ({ page }) => {
  await gotoWithClearedLocale(page, "/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(commonEn.metaTitle);
  await expect(
    page.getByRole("heading", { name: "Hire AI like you hire people." })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Why" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Boundary" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Hire an employee" })
  ).toBeVisible();
  await expect(page.getByTestId("locale-switcher").first()).toHaveAttribute(
    "aria-label",
    "Language"
  );
  await expect(
    page.getByTestId("locale-switcher").first().getByRole("button", {
      name: "English",
    })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "像招聘员工一样雇佣 AI。" })
  ).toHaveCount(0);
});

test("persists zh-CN across reloads and routes, then switches back to English", async ({
  page,
}) => {
  await gotoWithClearedLocale(page, "/");

  await switchToChinese(page);

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle(commonZhCN.metaTitle);
  await expect(
    page.getByRole("heading", { name: "像招聘员工一样雇佣 AI。" })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(key => localStorage.getItem(key), localeStorageKey)
    )
    .toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle(commonZhCN.metaTitle);
  await expect(
    page.getByRole("heading", { name: "像招聘员工一样雇佣 AI。" })
  ).toBeVisible();

  await page.goto(`/task-run/${run.id}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText("[1] 工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("人工交付门禁", { exact: true })).toBeVisible();

  await switchToEnglish(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(commonEn.metaTitle);
  await expect(page.getByText("[1] Workbench", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(key => localStorage.getItem(key), localeStorageKey)
    )
    .toBe("en");
});

test("localizes registry display content while preserving employee IDs", async ({
  page,
}) => {
  await gotoWithClearedLocale(page, "/");

  await expect(page.getByText("Code Review Shrimp").first()).toBeVisible();
  await expect(page.getByText("Code Review Engineer").first()).toBeVisible();
  await expect(
    page.locator('a[href="/employee/code-review-shrimp"]').first()
  ).toBeVisible();
  await expect(
    page.getByText("Evidence", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText("Runtime", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText("Permission", { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText("Cost", { exact: true }).first()).toBeVisible();

  await switchToChinese(page);

  await expect(page.getByText("代码评审虾").first()).toBeVisible();
  await expect(page.getByText("代码评审工程师").first()).toBeVisible();
  await expect(
    page.locator('a[href="/employee/code-review-shrimp"]').first()
  ).toBeVisible();
  await expect(page.getByText("证据", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("运行时", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("权限", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("成本", { exact: true }).first()).toBeVisible();
});

test("keeps employee detail and hire confirmation in the selected language", async ({
  page,
}) => {
  await gotoWithClearedLocale(page, "/hire/code-review-shrimp");

  await expect(
    page.getByRole("heading", {
      name: "Review capabilities before hiring Code Review Shrimp",
    })
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/[\p{Script=Han}]/u);

  await switchToChinese(page);
  await expect(
    page.getByRole("heading", { name: "雇佣 代码评审虾 前检查能力" })
  ).toBeVisible();

  await page.goto("/employee/code-review-shrimp");
  await expect(page.getByText("远程 / 工程", { exact: true })).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toBeVisible();
  await expect(page.getByText("未测试", { exact: true })).toBeVisible();
  await expect(page.getByText("证据不足", { exact: true })).toBeVisible();
  await expect(page.getByText("已发布", { exact: true })).toBeVisible();
  await expect(
    page.getByText("免费预览", { exact: true }).first()
  ).toBeVisible();
});

test("localizes workbench static chrome while keeping technical identifiers intact", async ({
  page,
}) => {
  await gotoWithClearedLocale(page, `/task-run/${run.id}`);

  await switchToChinese(page);

  await expect(page.getByText("[1] 工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("时间线", { exact: true })).toBeVisible();
  await expect(page.getByText("员工动作", { exact: true })).toBeVisible();
  await expect(page.getByText("事件详情", { exact: true })).toBeVisible();
  await expect(
    page.getByText("产物", { exact: true }).filter({ visible: true }).first()
  ).toBeVisible();
  await expect(page.getByText("验收", { exact: true })).toBeVisible();
  await expect(page.getByText("人工交付门禁", { exact: true })).toBeVisible();
  await expect(page.getByText("工具与权限", { exact: true })).toBeVisible();
  await expect(
    page.getByText("调试 / JSONL / 审计", { exact: true })
  ).toBeVisible();

  await expect(
    page.getByText("web_search", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText("web.search", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "artifact_1719306072123.md" })
  ).toBeVisible();
});
