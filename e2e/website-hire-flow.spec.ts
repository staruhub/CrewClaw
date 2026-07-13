import { expect, test } from "@playwright/test";

// Browser-side marketplace → employee → hire → team flow (the "download an employee from the
// website" path). Complements website-install.spec.ts, which covers the homepage CLI docs + the
// actual CLI hire. Here we drive the SPA the way a visitor would and assert the hire persists.

test.describe.configure({ mode: "serial" });

test("marketplace lists real registry employees and shows no stale absolute path", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", m => {
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

// v0.18 收束3: the website projects the registry (employees.generated.json), so every available
// expert — including whale and Zeneth, which the old hand-copied dataset dropped — must have a
// reachable detail page rendering its real hire.yaml facts.
test("all 5 available employees have reachable detail pages", async ({
  page,
}) => {
  const expected: Array<[string, string]> = [
    ["code-review-shrimp", "Code Review Shrimp"],
    ["product-prd-crab", "Product PRD Crab"],
    ["ai-adoption-whale", "AI 落地鲸"],
    ["zeneth", "社群运营美人鱼 Zeneth"],
    ["macao-networking-agent", "Macao Networking Agent"],
  ];

  for (const [employeeId, displayName] of expected) {
    await page.goto(`/employee/${employeeId}`);
    await expect(
      page.getByRole("heading", { name: displayName }).first(),
      `${employeeId} detail page should render`
    ).toBeVisible();
  }
});

test("a visitor can hire an employee end to end and see it join the crew", async ({
  page,
}) => {
  const employeeId = "macao-networking-agent";
  const displayName = "Macao Networking Agent";

  await page.goto(`/employee/${employeeId}`);
  await expect(
    page.getByRole("heading", { name: displayName }).first()
  ).toBeVisible();
  await expect(page.getByText("contacts.read", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Optional · Off by default", { exact: true }).first()
  ).toBeVisible();

  // Enter the hire confirmation flow.
  await page
    .getByRole("link", { name: /^hire$/i })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/hire/${employeeId}$`));
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`Review capabilities before hiring ${displayName}`, "i"),
    })
  ).toBeVisible();

  const requiredSearch = page.getByRole("checkbox", {
    name: "web.search required capability",
  });
  await expect(requiredSearch).toBeChecked();
  await expect(requiredSearch).toBeDisabled();
  const optionalContacts = page.getByRole("checkbox", {
    name: "contacts.read capability",
  });
  await expect(optionalContacts).not.toBeChecked();
  await expect(optionalContacts).toBeEnabled();
  const conditionalPlaces = page.getByRole("checkbox", {
    name: "places.search capability",
  });
  await expect(conditionalPlaces).toBeChecked();
  await expect(conditionalPlaces).toBeEnabled();

  // Prove the actual hire controls work without a pointer: `contacts.read`
  // follows `places.search` in the declared capability order.
  await conditionalPlaces.focus();
  await page.keyboard.press("Tab");
  await expect(optionalContacts).toBeFocused();
  await page.keyboard.press("Space");
  await expect(optionalContacts).toBeChecked();

  await conditionalPlaces.focus();
  await page.keyboard.press("Space");
  await expect(conditionalPlaces).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Main risk" }).locator("..")
  ).toContainText("Highest enabled risk tier: P3");
  const disabledCrm = page.getByRole("checkbox", {
    name: "crm.write policy-disabled capability",
  });
  await expect(disabledCrm).not.toBeChecked();
  await expect(disabledCrm).toBeDisabled();

  // Simulated checkout, then the real hire. Exact names — the disabled hire button reads
  // "Confirm simulated checkout first" until checkout is confirmed, so a loose regex is ambiguous.
  await page
    .getByRole("button", { name: "Confirm simulated checkout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and hire", exact: true })
    .click();

  await expect(
    page.getByText(/your new AI employee has joined the crew/i)
  ).toBeVisible();

  // The hire is persisted as a WorkspaceEmployee record.
  const stored = await page.evaluate(() =>
    localStorage.getItem("crewclaw.team.v1")
  );
  expect(stored).toBeTruthy();
  const team = JSON.parse(stored ?? "[]") as Array<{
    employee_id: string;
    status: string;
    permissions_granted: string[];
  }>;
  expect(
    team.some(e => e.employee_id === employeeId && e.status === "active")
  ).toBe(true);
  expect(
    team.find(e => e.employee_id === employeeId)?.permissions_granted
  ).toContain("capability:contacts.read");
  expect(
    team.find(e => e.employee_id === employeeId)?.permissions_granted
  ).toContain("capability:web.search");
  expect(
    team.find(e => e.employee_id === employeeId)?.permissions_granted
  ).not.toContain("capability:places.search");
  expect(
    team.find(e => e.employee_id === employeeId)?.permissions_granted
  ).not.toContain("capability:calendar.availability.read");
  expect(
    team.find(e => e.employee_id === employeeId)?.permissions_granted
  ).not.toContain("capability:crm.write");

  // And it shows up on the team dashboard.
  await page.goto("/team");
  await expect(
    page.getByRole("heading", { name: /your AI crew/i })
  ).toBeVisible();
  await expect(page.getByText(displayName).first()).toBeVisible();
});
