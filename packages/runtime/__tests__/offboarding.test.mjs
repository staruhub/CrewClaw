import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  offboardEmployee,
  verifyMemoryPack,
  verifyOffboardingReceipt,
} from "../offboarding.mjs";

const NOW = "2026-07-19T12:00:00.000Z";

function workspace(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `offboarding-${name}-`));
  fs.mkdirSync(path.join(root, ".crewclaw"), { recursive: true });
  return root;
}

function activeRecord(employeeId = "product-prd-crab") {
  return {
    workspace_employee_id: `${employeeId}-employment-1`,
    employee_id: employeeId,
    version: "0.2.0",
    status: "active",
    hired_at: "2026-07-18T00:00:00.000Z",
    fired_at: null,
    permissions_granted: ["capability:workspace_read"],
    hire_source: "cli",
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function seedTeam(root, employee = activeRecord()) {
  writeJson(path.join(root, ".crewclaw", "team.json"), [employee]);
  return employee;
}

function legacyMemory() {
  return {
    category: "project_facts",
    text: "The runtime uses an additive TaskEvent stream.",
    confidence: "high",
    savedAt: NOW,
  };
}

{
  const root = workspace("export");
  try {
    const employee = seedTeam(root);
    writeJson(
      path.join(root, ".crewclaw", "memory", `${employee.employee_id}.json`),
      [legacyMemory()]
    );
    const result = offboardEmployee(root, employee.employee_id, {
      mode: "export_memory",
      now: () => NOW,
      id: () => "export-1",
    });
    assert.equal(result.receipt.outcome, "completed");
    assert.equal(result.receipt.export_memory.status, "exported");
    assert.equal(result.receipt.fire.permissions_active, false);
    assert.equal(verifyMemoryPack(result.memory_pack).ok, true);
    assert.equal(verifyOffboardingReceipt(result.receipt).ok, true);
    assert.equal(
      result.memory_pack.workspace_employee_id,
      employee.workspace_employee_id
    );
    assert.equal(result.memory_pack.items[0].source_type, "legacy");
    assert.deepEqual(result.memory_pack.items[0].source_task_ids, []);
    assert.equal(result.team[0].status, "fired");
    assert.ok(
      fs.existsSync(path.join(root, result.receipt.export_memory.relative_path))
    );
    const activity = JSON.parse(
      fs.readFileSync(path.join(root, ".crewclaw", "activity.json"), "utf8")
    );
    assert.equal(activity[0].offboarding_id, result.receipt.offboarding_id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = workspace("handoff");
  try {
    const employee = seedTeam(root);
    const result = offboardEmployee(root, employee.employee_id, {
      mode: "handoff",
      successorEmployeeId: "ai-adoption-whale",
      now: () => NOW,
      id: (() => {
        const values = ["handoff-offboarding", "handoff-draft"];
        return () => values.shift();
      })(),
    });
    assert.equal(result.receipt.export_memory.status, "exported");
    assert.equal(result.receipt.handoff.status, "drafted");
    assert.equal(
      result.handoff.next_action,
      "open_market_with_prefilled_role_contract"
    );
    assert.equal(result.handoff.successor_employee_id, "ai-adoption-whale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = workspace("prepare-failure");
  try {
    const employee = seedTeam(root);
    const memoryPath = path.join(
      root,
      ".crewclaw",
      "memory",
      `${employee.employee_id}.json`
    );
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, "{not-json\n");
    assert.throws(
      () =>
        offboardEmployee(root, employee.employee_id, {
          mode: "export_memory",
          now: () => NOW,
          id: () => "prepare-failure",
        }),
      error => error.code === "OFFBOARDING_MEMORY_INVALID"
    );
    const team = JSON.parse(
      fs.readFileSync(path.join(root, ".crewclaw", "team.json"), "utf8")
    );
    assert.equal(
      team[0].status,
      "active",
      "prepare failure must not mutate roster"
    );
    assert.ok(
      fs.existsSync(
        path.join(
          root,
          ".crewclaw",
          "offboarding",
          "offboarding-prepare-failure",
          "failure.json"
        )
      )
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = workspace("purge");
  try {
    const employee = seedTeam(root);
    const stateRoot = path.join(root, ".crewclaw");
    writeJson(path.join(stateRoot, "memory", `${employee.employee_id}.json`), [
      legacyMemory(),
    ]);
    writeJson(
      path.join(
        stateRoot,
        "memory-candidates",
        employee.employee_id,
        "one.json"
      ),
      { candidate: true }
    );
    writeJson(
      path.join(stateRoot, "dream", employee.employee_id, "jobs", "one.json"),
      {
        dream: true,
      }
    );
    writeJson(
      path.join(stateRoot, "skill-usage", `${employee.employee_id}.json`),
      {
        research: { count: 3 },
      }
    );
    writeJson(path.join(stateRoot, "kpi", `${employee.employee_id}.json`), {
      retained: true,
    });
    const result = offboardEmployee(root, employee.employee_id, {
      mode: "purge",
      now: () => NOW,
      id: () => "purge-1",
    });
    assert.equal(result.receipt.purge.status, "purged");
    assert.deepEqual(
      new Set(result.receipt.purge.deleted_scopes),
      new Set(["memory", "memory_candidates", "dream", "skill_usage"])
    );
    assert.equal(result.receipt.purge.media_sanitization, "not_performed");
    assert.ok(fs.existsSync(path.join(stateRoot, "team.json")));
    assert.ok(fs.existsSync(path.join(stateRoot, "activity.json")));
    assert.ok(
      fs.existsSync(path.join(stateRoot, "kpi", `${employee.employee_id}.json`))
    );
    assert.ok(
      !fs.existsSync(
        path.join(stateRoot, "memory", `${employee.employee_id}.json`)
      )
    );
    assert.ok(
      !fs.existsSync(path.join(stateRoot, "dream", employee.employee_id))
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = workspace("purge-hardlink");
  try {
    const employee = seedTeam(root);
    const candidate = path.join(
      root,
      ".crewclaw",
      "memory-candidates",
      employee.employee_id,
      "linked.json"
    );
    writeJson(candidate, { candidate: true });
    fs.linkSync(candidate, path.join(root, "outside-hardlink.json"));
    const result = offboardEmployee(root, employee.employee_id, {
      mode: "purge",
      now: () => NOW,
      id: () => "purge-hardlink",
    });
    assert.equal(result.receipt.outcome, "partial");
    assert.equal(result.receipt.purge.status, "failed");
    assert.deepEqual(result.receipt.purge.deleted_scopes, [
      "memory",
      "skill_usage",
    ]);
    assert.ok(
      result.receipt.warnings.some(message => /hard|safe file/i.test(message))
    );
    assert.equal(result.team[0].status, "fired");
    assert.ok(
      fs.existsSync(candidate),
      "unsafe hard-linked state must not be unlinked"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("offboarding.test.mjs passed");
