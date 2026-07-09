import { expect, test } from "@playwright/test";

// Browser-side marketplace → employee → hire → team flow (the "download an employee from the
// website" path). Complements website-install.spec.ts, which covers the homepage CLI docs + the
// actual CLI hire. Here we drive the SPA the way a visitor would and assert the hire persists.

test.describe.configure({ mode: "serial" });

test("marketplace lists real registry employees and shows no stale absolute path", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/marketplace");

  // Employees are derived from registry/experts.json — assert a couple of the curated ones render.
  await expect(page.getByText("Macao Networking Agent").first()).toBeVisible();
  await expect(page.getByText("Code Review Shrimp").first()).toBeVisible();

  // Regression guard for the cross-platform launcher-command fix: the old hardcoded macOS path
  // `/Volumes/Ventoy/...` must never appear anywhere the site renders a command.
  await page.goto("/");
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("/Volumes/Ventoy");

  expect(consoleErrors).toEqual([]);
});

test("a visitor can hire an employee end to end and see it join the crew", async ({ page }) => {
  const employeeId = "macao-networking-agent";
  const displayName = "Macao Networking Agent";

  await page.goto(`/employee/${employeeId}`);
  await expect(page.getByRole("heading", { name: displayName }).first()).toBeVisible();

  // Enter the hire confirmation flow.
  await page.getByRole("link", { name: /^hire$/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/hire/${employeeId}$`));
  await expect(page.getByRole("heading", { name: new RegExp(`Confirm permissions before hiring ${displayName}`, "i") })).toBeVisible();

  // Simulated checkout, then the real hire. Exact names — the disabled hire button reads
  // "Confirm simulated checkout first" until checkout is confirmed, so a loose regex is ambiguous.
  await page.getByRole("button", { name: "Confirm simulated checkout", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and hire", exact: true }).click();

  await expect(page.getByText(/your new AI employee has joined the crew/i)).toBeVisible();

  // The hire is persisted as a WorkspaceEmployee record.
  const stored = await page.evaluate(() => localStorage.getItem("crewclaw.team.v1"));
  expect(stored).toBeTruthy();
  const team = JSON.parse(stored ?? "[]") as Array<{ employee_id: string; status: string }>;
  expect(team.some((e) => e.employee_id === employeeId && e.status === "active")).toBe(true);

  // And it shows up on the team dashboard.
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: /your AI crew/i })).toBeVisible();
  await expect(page.getByText(displayName).first()).toBeVisible();
});
