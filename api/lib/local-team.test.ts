import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import generated from "../../src/data/employees.generated.json";
import {
  fireLocalEmployee,
  hireLocalEmployee,
  readLocalEmployeePerformance,
  readLocalTeam,
} from "./local-team";
import { submitVerifiedReview } from "./local-reviews";
import { writeStateFileAtomic } from "./local-state";

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "crewclaw-web-local-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(value => rm(value, { recursive: true, force: true }))
  );
});

const employee = generated.employees.find(
  item => item.employee_id === "macao-networking-agent"
)!;
const permissions = employee.tool_capabilities
  .filter(capability => capability.necessity === "required")
  .map(capability => `capability:${capability.capability}`);

describe("local team bridge", () => {
  it("writes a checksum-bound canonical record, stays idempotent, and persists fire", async () => {
    const workspace = await root();
    const options = {
      root: workspace,
      packageRoot: process.cwd(),
      production: false,
    };
    const first = await hireLocalEmployee(
      {
        employee_id: employee.employee_id,
        version: employee.version,
        permissions_granted: permissions,
      },
      options
    );
    expect(first.created).toBe(true);
    expect(first.employee.package_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.employee.hire_source).toBe("website");

    const second = await hireLocalEmployee(
      {
        employee_id: employee.employee_id,
        version: employee.version,
        permissions_granted: permissions,
      },
      options
    );
    expect(second.created).toBe(false);
    expect(
      (await readLocalTeam(options)).filter(item => item.status === "active")
    ).toHaveLength(1);

    const offboarding = await fireLocalEmployee(
      { employee_id: employee.employee_id, mode: "export_memory" },
      options
    );
    expect(offboarding.offboarding_receipt.contract).toBe(
      "crewclaw.offboarding/v1"
    );
    expect(offboarding.offboarding_receipt.export_memory.status).toBe(
      "exported"
    );
    expect(offboarding.offboarding_receipt.fire.permissions_active).toBe(false);
    expect((await readLocalTeam(options))[0]?.status).toBe("fired");
    const disk = JSON.parse(
      await readFile(join(workspace, ".crewclaw", "team.json"), "utf8")
    ) as Record<string, unknown>[];
    expect(disk[0]).not.toHaveProperty("workspace_id");
    expect(disk[0]).not.toHaveProperty("hired_by");
  }, 30_000);

  it("reads a legacy roster whose records carry an explicit hire_source: null", async () => {
    const workspace = await root();
    const options = {
      root: workspace,
      packageRoot: process.cwd(),
      production: false,
    };
    // Pre-hire_source writers persisted `hire_source: null`; the strict contract models
    // unknown origin as an absent field. 30 of 32 records in a real June roster hit this.
    const legacy = [
      {
        workspace_employee_id: `${employee.employee_id}-1750637000`,
        employee_id: employee.employee_id,
        version: employee.version,
        hire_source: null,
        status: "fired",
        hired_at: "2026-06-23T00:21:11Z",
        fired_at: "2026-06-23T02:06:15Z",
        permissions_granted: permissions,
      },
    ];
    await writeStateFileAtomic(
      workspace,
      "team.json",
      Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`, "utf8")
    );
    const team = await readLocalTeam(options);
    expect(team).toHaveLength(1);
    expect(team[0]?.hire_source).toBeUndefined();
    expect(team[0]?.status).toBe("fired");

    // The next write-through canonicalizes the roster: hiring must succeed on top of the
    // legacy record and the persisted file must not regain a null hire_source.
    const hired = await hireLocalEmployee(
      {
        employee_id: employee.employee_id,
        version: employee.version,
        permissions_granted: permissions,
      },
      options
    );
    expect(hired.created).toBe(true);
    const disk = JSON.parse(
      await readFile(join(workspace, ".crewclaw", "team.json"), "utf8")
    ) as Record<string, unknown>[];
    expect(disk.some(record => record.hire_source === null)).toBe(false);
  }, 30_000);

  it("projects only receipt-backed accepted tasks and binds one verified review", async () => {
    const workspace = await root();
    const options = {
      root: workspace,
      packageRoot: process.cwd(),
      production: false,
    };
    await hireLocalEmployee(
      {
        employee_id: employee.employee_id,
        version: employee.version,
        permissions_granted: permissions,
      },
      options
    );
    await writeStateFileAtomic(
      workspace,
      `kpi/${employee.employee_id}.json`,
      Buffer.from(
        JSON.stringify({
          contract: "crewclaw.kpi/v2",
          employee_id: employee.employee_id,
          first_hired_ts: 123,
          legacy: { unclassified_tasks: 0, accepted_claims: 0, total_cost: 0 },
          outcomes: [
            {
              id: "outcome-task_verified_1",
              task_run_id: "task_verified_1",
              task_kind: "formal",
              outcome: "accepted",
              acceptance_source: "user",
              cost_usd: 0.2,
              duration_ms: 1000,
              evidence_count: 1,
              permission_violations: 0,
              safety_violations: 0,
              ts: 123,
            },
            {
              id: "outcome-task_rejected_1",
              task_run_id: "task_rejected_1",
              task_kind: "formal",
              outcome: "rejected",
              acceptance_source: "none",
              cost_usd: 0.05,
              duration_ms: 500,
              evidence_count: 1,
              permission_violations: 0,
              safety_violations: 0,
              ts: 124,
            },
          ],
        })
      )
    );
    const taskRunId = "task_verified_1";
    await writeStateFileAtomic(
      workspace,
      `runs/${taskRunId}.json`,
      Buffer.from(
        JSON.stringify({
          id: taskRunId,
          employee_id: employee.employee_id,
          status: "accepted",
          user_goal: "Find an event",
          updated_at: "2026-07-14T00:00:00Z",
        })
      )
    );
    await writeStateFileAtomic(
      workspace,
      `runs/${taskRunId}.proofpack.json`,
      Buffer.from(
        JSON.stringify({
          task_run_id: taskRunId,
          user_approval: { decision: "accept", at: "2026-07-14T00:00:00Z" },
        })
      )
    );

    const before = await readLocalEmployeePerformance(
      employee.employee_id,
      options
    );
    expect(before.kpi).toMatchObject({
      state: "available",
      tasks: 2,
      accepted: 1,
    });
    expect(before.accepted_tasks).toHaveLength(1);
    const saved = await submitVerifiedReview(
      employee.employee_id,
      {
        task_run_id: taskRunId,
        rating: 5,
        text: "Delivered a useful, sourced result.",
      },
      options
    );
    expect(saved.review.task_run_id).toBe(taskRunId);
    await expect(
      submitVerifiedReview(
        employee.employee_id,
        { task_run_id: taskRunId, rating: 4, text: "Duplicate" },
        options
      )
    ).rejects.toMatchObject({ code: "TASK_ALREADY_REVIEWED" });
  }, 30_000);
});
