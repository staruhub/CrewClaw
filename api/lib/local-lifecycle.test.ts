import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import generated from "../../src/data/employees.generated.json";
import {
  decideLocalTrial,
  hireLocalEmployeeFromTrial,
  runLocalDoctor,
  runLocalTrial,
} from "./local-lifecycle";

const roots: string[] = [];

async function workspaceRoot() {
  const value = await mkdtemp(join(tmpdir(), "crewclaw-lifecycle-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(value => rm(value, { recursive: true, force: true }))
  );
});

function requiredCapabilities(employeeId: string) {
  const employee = generated.employees.find(
    candidate => candidate.employee_id === employeeId
  );
  if (!employee) throw new Error(`missing test employee ${employeeId}`);
  return employee.tool_capabilities
    .filter(capability => capability.necessity === "required")
    .map(capability => capability.capability);
}

describe("local website lifecycle bridge", () => {
  it("uses the runtime registry for Doctor and produces a real gated trial TaskRun", async () => {
    const root = await workspaceRoot();
    const employeeId = "code-review-shrimp";
    const options = {
      root,
      packageRoot: process.cwd(),
      env: {},
    };
    const permissions = requiredCapabilities(employeeId);

    const doctor = await runLocalDoctor(
      employeeId,
      { permissions_granted: permissions },
      options
    );
    expect(doctor.status).toBe("warning");
    expect(
      doctor.capability_resolution.find(
        capability => capability.capability === "artifact.report"
      )
    ).toMatchObject({
      runtime_tool: "artifact_write",
      availability: "ready",
    });

    const trial = await runLocalTrial(
      employeeId,
      {
        permissions_granted: permissions,
        goal: "Prove the website-to-runtime lifecycle wiring.",
      },
      options
    );
    expect(trial).toMatchObject({
      employee_id: employeeId,
      status: "delivered",
      evidence_count: 1,
      tool_invocations: 1,
      next_action: "approve_trial",
    });
    const run = JSON.parse(
      await readFile(
        join(root, ".crewclaw", "runs", `${trial.task_run_id}.json`),
        "utf8"
      )
    ) as {
      status: string;
      events: Array<{ type: string }>;
      tool_invocations: Array<Record<string, unknown>>;
    };
    expect(run.status).toBe("delivered");
    expect(run.events.map(event => event.type)).toContain("tool.succeeded");
    expect(run.tool_invocations[0]).toMatchObject({
      tool_name: "artifact_write",
      capability: "artifact.report",
      decision: "confirm",
      status: "success",
    });

    const accepted = await decideLocalTrial(
      employeeId,
      trial.task_run_id,
      { decision: "accept" },
      options
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      next_action: "hire_employee",
    });
    const catalogEmployee = generated.employees.find(
      candidate => candidate.employee_id === employeeId
    );
    if (!catalogEmployee) throw new Error("missing catalog employee");
    const hirePermissions = permissions.map(
      capability => `capability:${capability}`
    );
    const hired = await hireLocalEmployeeFromTrial(
      {
        employee_id: employeeId,
        version: catalogEmployee.version,
        permissions_granted: hirePermissions,
        trial_task_run_id: trial.task_run_id,
      },
      options
    );
    expect(hired).toMatchObject({
      created: true,
      employee: {
        employee_id: employeeId,
        permissions_granted: hirePermissions,
      },
    });
    const replayed = await decideLocalTrial(
      employeeId,
      trial.task_run_id,
      { decision: "accept" },
      options
    );
    expect(replayed.status).toBe("accepted");
    const kpi = JSON.parse(
      await readFile(
        join(root, ".crewclaw", "kpi", `${employeeId}.json`),
        "utf8"
      )
    ) as { outcomes: unknown[] };
    expect(kpi.outcomes).toHaveLength(1);
    await expect(
      readFile(
        join(
          root,
          ".crewclaw",
          "reflections",
          employeeId,
          `${trial.task_run_id}.json`
        ),
        "utf8"
      )
    ).resolves.toContain('"outcome": "accepted"');
  });

  it("fails closed when a required provider is not configured", async () => {
    const root = await workspaceRoot();
    const employeeId = "macao-networking-agent";
    const permissions = requiredCapabilities(employeeId);
    const doctor = await runLocalDoctor(
      employeeId,
      { permissions_granted: permissions },
      { root, packageRoot: process.cwd(), env: {} }
    );
    expect(doctor.status).toBe("broken");
    expect(
      doctor.capability_resolution.find(
        capability => capability.capability === "web.search"
      )
    ).toMatchObject({ availability: "unavailable" });
    await expect(
      runLocalTrial(
        employeeId,
        {
          permissions_granted: permissions,
          goal: "This must not run without the required provider.",
        },
        { root, packageRoot: process.cwd(), env: {} }
      )
    ).rejects.toMatchObject({ code: "DOCTOR_BLOCKED", status: 409 });
  });

  it("does not allow hire before acceptance or with post-trial permission drift", async () => {
    const root = await workspaceRoot();
    const employeeId = "code-review-shrimp";
    const options = { root, packageRoot: process.cwd(), env: {} };
    const permissions = requiredCapabilities(employeeId);
    const employee = generated.employees.find(
      candidate => candidate.employee_id === employeeId
    );
    if (!employee) throw new Error("missing catalog employee");
    const hirePermissions = permissions.map(
      capability => `capability:${capability}`
    );
    const trial = await runLocalTrial(
      employeeId,
      {
        permissions_granted: permissions,
        goal: "Verify that the backend hire gate cannot be bypassed.",
      },
      options
    );
    await expect(
      hireLocalEmployeeFromTrial(
        {
          employee_id: employeeId,
          version: employee.version,
          permissions_granted: hirePermissions,
          trial_task_run_id: trial.task_run_id,
        },
        options
      )
    ).rejects.toMatchObject({ code: "TRIAL_NOT_ACCEPTED" });
    await decideLocalTrial(
      employeeId,
      trial.task_run_id,
      { decision: "accept" },
      options
    );
    await expect(
      hireLocalEmployeeFromTrial(
        {
          employee_id: employeeId,
          version: employee.version,
          permissions_granted: [...hirePermissions, "capability:file.write"],
          trial_task_run_id: trial.task_run_id,
        },
        options
      )
    ).rejects.toMatchObject({ code: "TRIAL_PERMISSION_DRIFT" });
  });
});
