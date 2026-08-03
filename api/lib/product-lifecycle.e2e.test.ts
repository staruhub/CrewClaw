import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import generated from "../../src/data/employees.generated.json";
import {
  decideLocalTrial,
  hireLocalEmployeeFromTrial,
  runLocalTrial,
} from "./local-lifecycle";
// @ts-expect-error The execution plane is plain Node and is contract-tested separately.
import * as Runtime from "../../packages/runtime/run.mjs";
// @ts-expect-error Plain-Node runtime module.
import * as GrowthRuntime from "../../packages/runtime/growth-cycle.mjs";
// @ts-expect-error Plain-Node runtime module.
import { readKpi } from "../../packages/runtime/kpi.mjs";
// @ts-expect-error Plain-Node runtime module.
import { startJsonlBridge } from "../../packages/runtime/tui/jsonl-bridge.mjs";

const { agentLoop, employeeAgentLoopDeps, loadProfile } = Runtime;
const { inspectGrowthCycle, inspectLatestGrowthCycle, recommendGrowthCycle } =
  GrowthRuntime;

const roots: string[] = [];

async function workspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "crewclaw-product-e2e-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 8_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

describe("website-to-TUI executable employee lifecycle", () => {
  it("hires through an accepted trial, executes a growth task with a real tool, and learns", async () => {
    const root = await workspaceRoot();
    const employeeId = "code-review-shrimp";
    const employee = generated.employees.find(
      candidate => candidate.employee_id === employeeId
    );
    if (!employee) throw new Error("missing lifecycle employee");
    const capabilities = employee.tool_capabilities
      .filter(capability => capability.necessity === "required")
      .map(capability => capability.capability);
    const grants = capabilities.map(capability => `capability:${capability}`);
    const lifecycleOptions = {
      root,
      packageRoot: process.cwd(),
      env: {},
    };

    const trial = await runLocalTrial(
      employeeId,
      {
        permissions_granted: capabilities,
        goal: "Create the bounded website lifecycle proof.",
      },
      lifecycleOptions
    );
    await decideLocalTrial(
      employeeId,
      trial.task_run_id,
      { decision: "accept" },
      lifecycleOptions
    );
    await hireLocalEmployeeFromTrial(
      {
        employee_id: employeeId,
        version: employee.version,
        permissions_granted: grants,
        trial_task_run_id: trial.task_run_id,
      },
      lifecycleOptions
    );

    const dreamId = "dream-product-e2e";
    const growth = recommendGrowthCycle(root, {
      employeeId,
      dreamId,
      goal: "Create growth-report.md with evidence that the employee can complete the next learning task.",
      taskRunIds: [trial.task_run_id],
      evidenceIds: [`trial:${trial.task_run_id}:artifact`],
      kpi: readKpi(root, employeeId),
    });

    const profile = await loadProfile(employeeId, {
      workspaceRoot: root,
      env: {},
      surface: "task",
    });
    let modelStep = 0;
    const callModelFn = async () => {
      modelStep += 1;
      if (modelStep === 1) {
        return {
          content: "",
          usage: { prompt_tokens: 10, completion_tokens: 4 },
          toolCalls: [
            {
              id: "growth-artifact-call",
              type: "function",
              function: {
                name: "artifact_write",
                arguments: JSON.stringify({
                  name: "growth-report.md",
                  kind: "report",
                  content:
                    "# Growth report\n\nThe registered runtime tool produced this evidence-backed learning deliverable.",
                }),
              },
            },
          ],
        };
      }
      return {
        content:
          "# Growth report\n\nThe registered runtime artifact tool completed the next employee growth task. ".repeat(
            8
          ),
        usage: { prompt_tokens: 8, completion_tokens: 24 },
        toolCalls: [],
      };
    };
    const input = new Readable({ read() {} });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) events.push(JSON.parse(line));
        }
        callback();
      },
    });
    const done = startJsonlBridge({
      agentLoop,
      agentLoopDeps: {
        ...employeeAgentLoopDeps(profile, root),
        baseUrl: "http://model.invalid",
        apiKey: "deterministic-e2e",
        model: "deterministic-e2e",
        temperature: 0,
        callModelFn,
      },
      input,
      output,
      root,
      history: [],
      meta: {
        mode: "Task",
        agentId: employeeId,
        firstTask: growth.record.goal,
        model: "deterministic-e2e",
        memoryStateHash: profile.memoryStateHash,
        contextIndex: profile.contextIndex,
        contextTokens: profile.contextTokens,
        toolCatalog: profile.toolResolution.sessionCatalog,
        toolCatalogVersion: "test",
        canonicalToolCatalog: [],
        toolBlocking: profile.toolResolution.blocking,
        toolDegraded: profile.toolResolution.degraded,
      },
    });
    const send = (value: unknown) => input.push(`${JSON.stringify(value)}\n`);
    send({
      type: "client.ready",
      data: { event_families: ["core/v1", "dream/v1"] },
    });
    await waitFor(
      () => events.some(event => event.type === "dream.next_task_ready"),
      "persisted growth recommendation was not projected"
    );
    send({ type: "dream.next_task_approve", data: {} });
    await waitFor(
      () => events.some(event => event.type === "approval.required"),
      "artifact tool authorization was not requested"
    );
    const toolApproval = events.find(
      event => event.type === "approval.required"
    )!;
    send({
      type: "approval.resolve",
      data: {
        id: toolApproval.data.id,
        decision: "allow",
      },
    });
    await waitFor(
      () => events.some(event => event.type === "approval.requested"),
      "growth delivery did not enter human approval"
    );
    const deliveryApproval = events.find(
      event => event.type === "approval.requested"
    )!;
    send({
      type: "approval.resolve",
      data: {
        id: deliveryApproval.data.id,
        decision: "accept",
      },
    });
    await waitFor(
      () => events.some(event => event.type === "dream.next_cycle_recommended"),
      "accepted growth task did not produce the next Dream recommendation"
    );
    input.push("/exit\n");
    await done;

    expect(
      events.find(event => event.type === "tool.succeeded")?.data
    ).toMatchObject({
      tool: "artifact_write",
      capability: "artifact.report",
      decision: "confirm",
    });
    expect(events.map(event => event.type)).toEqual(
      expect.arrayContaining([
        "dream.next_task_approved",
        "dream.next_task_queued",
        "dream.next_task_started",
        "dream.next_task_delivery_ready",
        "approval.accepted",
        "task.completed",
        "dream.next_task_settled",
        "dream.next_task_evaluated",
        "dream.next_task_learned",
        "dream.next_cycle_recommended",
      ])
    );
    expect(readKpi(root, employeeId).accepted).toBeGreaterThanOrEqual(2);
    expect(inspectLatestGrowthCycle(root, employeeId).record).toMatchObject({
      cycle_id: growth.record.cycle_id,
      state: "NEXT_RECOMMENDED",
      outcome: "accepted",
    });
  }, 45_000);

  it("turns a rejected growth delivery into an approval-gated revision task", async () => {
    const root = await workspaceRoot();
    const employeeId = "code-review-shrimp";
    const employee = generated.employees.find(
      candidate => candidate.employee_id === employeeId
    );
    if (!employee) throw new Error("missing lifecycle employee");
    const capabilities = employee.tool_capabilities
      .filter(capability => capability.necessity === "required")
      .map(capability => capability.capability);
    const lifecycleOptions = {
      root,
      packageRoot: process.cwd(),
      env: {},
    };
    const trial = await runLocalTrial(
      employeeId,
      {
        permissions_granted: capabilities,
        goal: "Create the bounded rejection lifecycle proof.",
      },
      lifecycleOptions
    );
    await decideLocalTrial(
      employeeId,
      trial.task_run_id,
      { decision: "accept" },
      lifecycleOptions
    );
    await hireLocalEmployeeFromTrial(
      {
        employee_id: employeeId,
        version: employee.version,
        permissions_granted: capabilities.map(
          capability => `capability:${capability}`
        ),
        trial_task_run_id: trial.task_run_id,
      },
      lifecycleOptions
    );
    const profile = await loadProfile(employeeId, {
      workspaceRoot: root,
      env: {},
      surface: "task",
    });
    const growth = recommendGrowthCycle(root, {
      employeeId,
      dreamId: "dream-rejected-e2e",
      goal: "Create growth-report.md with evidence that the employee can complete the next learning task.",
    });
    let modelStep = 0;
    const callModelFn = async () => {
      modelStep += 1;
      if (modelStep === 1) {
        return {
          content: "",
          usage: { prompt_tokens: 6, completion_tokens: 4 },
          toolCalls: [
            {
              id: "rejected-growth-artifact-call",
              type: "function",
              function: {
                name: "artifact_write",
                arguments: JSON.stringify({
                  name: "growth-report.md",
                  kind: "report",
                  content:
                    "# Growth report\n\nThe registered runtime tool produced this evidence-backed learning deliverable.",
                }),
              },
            },
          ],
        };
      }
      return {
        content:
          "# Growth report\n\nThe registered runtime artifact tool completed the next employee growth task. ".repeat(
            8
          ),
        usage: { prompt_tokens: 4, completion_tokens: 16 },
        toolCalls: [],
      };
    };
    const input = new Readable({ read() {} });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) events.push(JSON.parse(line));
        }
        callback();
      },
    });
    const done = startJsonlBridge({
      agentLoop,
      agentLoopDeps: {
        ...employeeAgentLoopDeps(profile, root),
        baseUrl: "http://model.invalid",
        apiKey: "deterministic-e2e",
        model: "deterministic-e2e",
        temperature: 0,
        callModelFn,
      },
      input,
      output,
      root,
      history: [],
      meta: {
        mode: "Task",
        agentId: employeeId,
        firstTask: growth.record.goal,
        model: "deterministic-e2e",
        memoryStateHash: profile.memoryStateHash,
        contextIndex: profile.contextIndex,
        contextTokens: profile.contextTokens,
        toolCatalog: profile.toolResolution.sessionCatalog,
        toolCatalogVersion: "test",
        canonicalToolCatalog: [],
        toolBlocking: profile.toolResolution.blocking,
        toolDegraded: profile.toolResolution.degraded,
      },
    });
    const send = (value: unknown) => input.push(`${JSON.stringify(value)}\n`);
    send({
      type: "client.ready",
      data: { event_families: ["core/v1", "dream/v1"] },
    });
    await waitFor(
      () => events.some(event => event.type === "dream.next_task_ready"),
      "persisted growth recommendation was not projected"
    );
    send({ type: "dream.next_task_approve", data: {} });
    await waitFor(
      () => events.some(event => event.type === "approval.required"),
      "artifact tool authorization was not requested"
    );
    const toolApproval = events.find(
      event => event.type === "approval.required"
    )!;
    send({
      type: "approval.resolve",
      data: {
        id: toolApproval.data.id,
        decision: "allow",
      },
    });
    try {
      await waitFor(
        () => events.some(event => event.type === "approval.requested"),
        "growth delivery did not enter human approval"
      );
    } catch (error) {
      throw new Error(
        `${String((error as Error).message)}; events=${events
          .map(event => event.type)
          .join(",")}`,
        { cause: error }
      );
    }
    const deliveryApproval = events.find(
      event => event.type === "approval.requested"
    )!;
    send({
      type: "approval.resolve",
      data: {
        id: deliveryApproval.data.id,
        decision: "reject",
        reason: "Add explicit source provenance before acceptance.",
      },
    });
    await waitFor(
      () => events.some(event => event.type === "dream.revision_task_created"),
      "rejected growth delivery did not create a revision task"
    );
    input.push("/exit\n");
    await done;

    expect(events.map(event => event.type)).toEqual(
      expect.arrayContaining([
        "approval.rejected",
        "task.rejected",
        "dream.next_task_settled",
        "dream.next_task_evaluated",
        "dream.next_task_learned",
        "dream.revision_task_created",
      ])
    );
    expect(
      inspectGrowthCycle(root, employeeId, growth.record.cycle_id).record
    ).toMatchObject({
      state: "LEARNED",
      outcome: "rejected",
    });
    expect(inspectLatestGrowthCycle(root, employeeId).record).toMatchObject({
      kind: "dream_revision",
      state: "REVISION_REQUIRED",
    });
    expect(readKpi(root, employeeId).rejected).toBe(1);
  }, 45_000);
});
