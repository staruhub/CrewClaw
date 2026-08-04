import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("employee detail is organized as an expandable resume directory", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/employee/code-review-shrimp");

  await expect(
    page.getByRole("heading", { name: "Code Review Shrimp" })
  ).toBeVisible();
  const directory = page.getByTestId("employee-profile-directory");
  await expect(directory).toBeVisible();
  await expect(directory.getByText("Resume directory")).toBeVisible();
  await expect(directory.getByRole("button")).toHaveCount(6);

  const overview = page.getByTestId("profile-module-overview");
  const overviewTrigger = overview.locator('[data-slot="accordion-trigger"]');
  await expect(overviewTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    overview.getByRole("heading", { name: "Core skills", exact: true })
  ).toBeVisible();

  const permissions = page.getByTestId("profile-module-permission-boundary");
  const permissionTrigger = permissions.locator(
    '[data-slot="accordion-trigger"]'
  );
  await expect(permissionTrigger).toHaveAttribute("aria-expanded", "false");
  await directory
    .getByRole("button", { name: /permission boundaries/i })
    .click();
  await expect(permissionTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    permissions.getByRole("heading", {
      name: "Role capability contract",
      exact: true,
    })
  ).toBeVisible();

  await permissionTrigger.click();
  await expect(permissionTrigger).toHaveAttribute("aria-expanded", "false");
  expect(consoleErrors).toEqual([]);
});

test("resume modules remain usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/employee/code-review-shrimp");

  const directory = page.getByTestId("employee-profile-directory");
  await expect(directory).toBeVisible();
  await expect(directory).not.toHaveCSS("position", "sticky");

  const trial = page.getByTestId("profile-module-trial-tasks");
  await trial.locator('[data-slot="accordion-trigger"]').click();
  await expect(trial.getByText("Copy and run a bounded trial")).toBeVisible();
  await expect(
    trial.getByRole("button", { name: /^try$/i }).first()
  ).toBeVisible();
});
