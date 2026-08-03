import { expect, test, type Page } from "@playwright/test";
import type { LocalEmployeePerformance } from "../contracts/local-performance";
import { getLatestTaskRun } from "../src/data/task-runs";
import { localizeTaskRun } from "../src/i18n/task-run-content";

const teamStorageKey = "crewclaw.team.v1";
const analyticsStorageKey = "crewclaw.analytics.events.v1";
const employeeId = "macao-networking-agent";
const employeeName = "Macao Networking Agent";
const employeeVersion = "0.2.0";
const run = getLatestTaskRun();
const localizedRun = localizeTaskRun(run, "en");

test.use({ locale: "en-US" });

function selectedCapabilities() {
  return ["capability:web.search", "capability:places.search"];
}

function workspaceEmployee() {
  return {
    workspace_employee_id: `${employeeId}-closed-loop-e2e`,
    employee_id: employeeId,
    version: employeeVersion,
    hire_source: "website",
    status: "active",
    hired_at: "2026-07-29T00:00:00.000Z",
    fired_at: null,
    permissions_granted: selectedCapabilities(),
  };
}

function performanceRecord(id: string): LocalEmployeePerformance {
  const available = id === employeeId;
  return {
    employee_id: id,
    kpi: {
      state: available ? "available" : "absent",
      contract: available ? "crewclaw.kpi/v2" : null,
      tasks: available ? 3 : null,
      successful: available ? 2 : null,
      completed: available ? 3 : null,
      accepted: available ? 1 : null,
      auto_accepted: available ? 1 : null,
      correctly_blocked: available ? 1 : null,
      rejected: available ? 1 : null,
      revision_requested: 0,
      failed: 0,
      chat_turns: available ? 8 : null,
      artifact_actions: available ? 2 : null,
      total_cost: available ? 0.42 : null,
      cost_currency: available ? "USD" : null,
      average_cost: available ? 0.14 : null,
      average_duration_ms: available ? 42_000 : null,
      evidence_coverage: available ? 0.67 : null,
      permission_violations: 0,
      safety_violations: 0,
      first_hired_at: available ? 1_779_840_000 : null,
      outcomes_count: available ? 3 : null,
      legacy_unclassified_tasks: 2,
      legacy_accepted_claims: 1,
      legacy_total_cost: 0.19,
    },
    evaluation: {
      state: available ? "available" : "absent",
      score: available ? 82 : null,
      verdict: available ? "PASS" : null,
      mock: available ? false : null,
      certified: false,
      model: available ? "e2e-local-evaluator" : null,
      evaluated_at: available ? 1_779_840_000 : null,
    },
    proof_pack: {
      state: "available",
      generated_at: available ? "2026-07-29T00:00:00.000Z" : null,
      evidence_level: available ? "C1" : null,
      package_status: available ? "validated" : null,
      lab_status: available ? "untested" : null,
      field_status: available ? "pilot" : null,
      credential_id: null,
      profile_id: null,
      sample_size: available ? 3 : null,
      success_rate: available ? 0.67 : null,
      success_confidence_low: available ? 0.5 : null,
      correct_stop_rate: available ? 0.33 : null,
      evidence_coverage: available ? 0.67 : null,
      content_hash: null,
      warnings: available ? ["Evidence gap"] : [],
    },
    accepted_tasks: available
      ? [
          {
            task_run_id: run.id,
            goal: run.user_goal,
            accepted_at: "2026-07-29T00:00:00.000Z",
            reviewed: true,
          },
        ]
      : [],
    verified_reviews: available
      ? [
          {
            id: "review-closed-loop-e2e",
            employee_id: id,
            task_run_id: run.id,
            rating: 5,
            text: "Accepted after checking evidence and approval gates.",
            created_at: "2026-07-29T00:00:00.000Z",
          },
        ]
      : [],
    warnings: available ? ["Evidence gap"] : [],
  };
}

async function mockLocalApis(page: Page) {
  await page.route("**/api/local/team", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          team: [workspaceEmployee()],
          employee: workspaceEmployee(),
          message: "Employee hired from accepted trial.",
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { source: "e2e", team: [workspaceEmployee()] },
    });
  });
  await page.route("**/api/local/employees/*/performance", async route => {
    const id = decodeURIComponent(route.request().url().split("/").at(-2)!);
    await route.fulfill({
      contentType: "application/json",
      json: performanceRecord(id),
    });
  });
  await page.route("**/api/local/employees/*/doctor", async route => {
    const body = route.request().postDataJSON() as {
      permissions_granted?: string[];
    };
    const blocked =
      body.permissions_granted?.includes("places.search") ?? false;
    await route.fulfill({
      contentType: "application/json",
      json: {
        contract: "crewclaw.local-doctor/v1",
        employee_id: employeeId,
        status: blocked ? "broken" : "warning",
        checks: [
          {
            name: "tool.places.search",
            ok: !blocked,
            detail: blocked
              ? "places.search has no configured provider"
              : "places.search is not granted for this trial",
          },
        ],
        missing: blocked ? ["places.search"] : [],
        impact: blocked
          ? "The selected capability cannot execute."
          : "Optional capabilities remain disabled.",
        fixes: blocked
          ? ["Disable places.search or configure its provider."]
          : [],
        allow_degrade: !blocked,
        degraded_level: blocked ? "L3" : "L2",
        capability_resolution: [
          {
            capability: "places.search",
            runtime_tool: null,
            availability: blocked ? "unbound" : "not_granted",
            reason: blocked
              ? "No provider is configured."
              : "Not granted for this trial.",
            authorization: blocked ? "per_call" : "not_granted",
            timeout_ms: 30_000,
          },
        ],
        checked_at: "2026-07-29T00:00:00.000Z",
      },
    });
  });
  const trialResponse = (decision: boolean) => ({
    contract: "crewclaw.local-trial/v1",
    employee_id: employeeId,
    task_run_id: "trial-closed-loop-e2e",
    status: decision ? "accepted" : "delivered",
    artifact_id: "artifact-trial-closed-loop-e2e",
    evidence_count: 1,
    tool_invocations: 1,
    permissions_granted: selectedCapabilities(),
    doctor_status: "warning",
    decision: decision ? "accept" : null,
    next_action: decision ? "hire_employee" : "approve_trial",
    started_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:01.000Z",
  });
  await page.route(
    "**/api/local/employees/*/trials/*/decision",
    async route => {
      await route.fulfill({
        contentType: "application/json",
        json: trialResponse(true),
      });
    }
  );
  await page.route("**/api/local/employees/*/trials", async route => {
    await route.fulfill({
      contentType: "application/json",
      json: trialResponse(false),
    });
  });
}

test.describe.configure({ mode: "serial" });

test("discovery carries a visitor from landing to marketplace comparison and a real profile", async ({
  page,
}) => {
  await mockLocalApis(page);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hire AI like you hire people." })
  ).toBeVisible();
  await expect(page.getByText("KPI / Dream review")).toBeVisible();

  await page.getByRole("link", { name: "Browse AI employees" }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(
    page.getByRole("heading", { name: "Browse agents like candidates." })
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Compare", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Compare", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence-backed shortlist" })
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Acceptance" })
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Reputation" })
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Search digital employees" })
    .fill("Macao");
  await page.getByRole("button", { name: "run ↵" }).click();
  await expect(
    page.getByText(/1 employee match(?:es)? the current marketplace filters/)
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: employeeName }).first()
  ).toBeVisible();

  await page.getByRole("link", { name: employeeName }).first().click();
  await expect(page).toHaveURL(new RegExp(`/employee/${employeeId}$`));
  await expect(page.getByRole("heading", { name: employeeName })).toBeVisible();
  await expect(page.getByText("Role capability contract")).toBeVisible();
  await expect(page.getByText("Local KPI record")).toBeVisible();
  await expect(page.getByText("Receipt-backed local KPI")).toBeVisible();
});

test("activation gates require Doctor and accepted trial before hire intent", async ({
  page,
}) => {
  await mockLocalApis(page);

  await page.goto(`/hire/${employeeId}`);
  await expect(
    page.getByRole("heading", {
      name: new RegExp(
        `Review capabilities before hiring ${employeeName}`,
        "i"
      ),
    })
  ).toBeVisible();

  const activateButton = page.getByRole("button", {
    name: "Pass Doctor and accept trial first",
  });
  await expect(activateButton).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run bounded trial" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Accept trial", exact: true })
  ).toBeDisabled();

  await page.getByRole("button", { name: "Run Doctor" }).click();
  await expect(
    page.getByText("Doctor found activation blockers.")
  ).toBeVisible();
  await expect(
    page.getByText("places.search", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run bounded trial" })
  ).toBeDisabled();

  await page
    .getByRole("checkbox", { name: "places.search capability" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "places.search capability" })
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Run Doctor" }).click();
  await expect(
    page.getByText("Doctor passed for this selected contract.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Run bounded trial" }).click();
  await expect(
    page.getByRole("button", { name: "Trial summarized" })
  ).toBeDisabled();
  await expect(
    page.getByText("Waiting for human review before activation.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept trial", exact: true }).click();
  await expect(
    page.getByText("Accepted by human reviewer in this browser session.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate local hire" }).click();
  await expect(
    page.getByRole("heading", {
      name: `${employeeName} is on your local roster.`,
    })
  ).toBeVisible();
  const intent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("crewclaw.hire-intent.v2") ?? "{}")
  );
  expect(intent.employee_id).toBe(employeeId);
  expect(intent.doctor_checks).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "pass" })])
  );
  expect(intent.trial).toEqual(
    expect.objectContaining({
      status: "accepted",
      decision: "accept",
      next_action: "hire_employee",
    })
  );
  const cachedTeam = await page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? "[]"),
    teamStorageKey
  );
  expect(cachedTeam).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ employee_id: employeeId, status: "active" }),
    ])
  );

  await page.goto(`/task-run/${run.id}`);
  await expect(
    page.getByRole("heading", { name: localizedRun.user_goal })
  ).toBeVisible();
  await expect(
    page.getByText("Evidence", { exact: true }).last()
  ).toBeVisible();
  await expect(page.getByText("Approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Human delivery gate")).toBeVisible();
  await expect(page.getByText("Delivery is mandatory-gated")).toBeVisible();
  await expect(page.getByText("inspect before approval")).toBeVisible();
  await expect(
    page.getByText(
      "This website is a read-only projection of persisted TaskRun evidence."
    )
  ).toBeVisible();
  await expect(
    page.getByText(/Open the CrewClaw TUI to execute the runtime-emitted/)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create revision" })
  ).toHaveCount(0);
});

test("performance KPI and Dream review keep incomplete evidence honest", async ({
  page,
}) => {
  await mockLocalApis(page);
  await page.goto("/", {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(
    ({ analyticsKey, teamKey, teamRecord }) => {
      localStorage.setItem(teamKey, JSON.stringify([teamRecord]));
      localStorage.setItem(
        analyticsKey,
        JSON.stringify([
          {
            id: "hire_succeeded:e2e",
            event: "hire_succeeded",
            props: { employee_id: "macao-networking-agent" },
            timestamp: new Date().toISOString(),
          },
          {
            id: "doctor_started:e2e",
            event: "doctor_started",
            props: { employee_id: "macao-networking-agent" },
            timestamp: new Date().toISOString(),
          },
          {
            id: "doctor_completed:e2e",
            event: "doctor_completed",
            props: {
              employee_id: "macao-networking-agent",
              issue_count: 1,
              suggestion_count: 1,
            },
            timestamp: new Date().toISOString(),
          },
        ])
      );
    },
    {
      analyticsKey: analyticsStorageKey,
      teamKey: teamStorageKey,
      teamRecord: workspaceEmployee(),
    }
  );

  await page.goto("/performance");
  await expect(
    page.getByRole("heading", { name: "Verified local work signals" })
  ).toBeVisible();
  await expect(
    page.getByText("Runtime completion is not human acceptance")
  ).toBeVisible();
  await expect(page.getByText("Monthly trend availability")).toBeVisible();
  await expect(page.getByText("High-cost outcomes")).not.toBeVisible();
  await expect(page.getByRole("cell", { name: employeeName })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Stored 82 · pending verification" })
  ).toBeVisible();

  await page.goto("/metrics");
  await expect(
    page.getByRole("heading", { name: "Employee hiring signals" })
  ).toBeVisible();
  await expect(page.getByText("Completion vs acceptance")).toBeVisible();
  await expect(page.getByText("Instrumentation gap")).toBeVisible();

  await page.goto("/crew");
  await page.getByLabel(employeeName).check();
  await page
    .getByPlaceholder(/Review the CrewClaw P2 frontend/)
    .fill("Prepare an evidence-backed Macao launch brief");
  await page.getByRole("button", { name: "Generate crew plan" }).click();
  await expect(page.getByText("Dream review proposal")).toBeVisible();
  await expect(page.getByText("Awaiting human review")).toBeVisible();
  await expect(
    page.getByText("No runtime delivery receipt exists yet")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve staged note" })
  ).toBeDisabled();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await page.getByRole("button", { name: "Approve staged note" }).click();
  await expect(page.getByText("Approved as staged note")).toBeVisible();
});
