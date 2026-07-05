import test from "node:test";
import assert from "node:assert/strict";
import yaml from "../yaml.mjs";

test("loads CrewClaw profile YAML without js-yaml being linked as a top-level package", () => {
  const parsed = yaml.load(`
model:
  default: ""
temperature: 0.4
skills:
  - content-calendar
  - engagement-playbook
permissions:
  - public_web:read
runtime:
  demo_tasks:
    - id: research-seed-2.1
      title: 调研 Seed
      input:
        task_text: "查官方价格"
`);

  assert.equal(parsed.model.default, "");
  assert.equal(parsed.temperature, 0.4);
  assert.deepEqual(parsed.skills, ["content-calendar", "engagement-playbook"]);
  assert.deepEqual(parsed.permissions, ["public_web:read"]);
  assert.equal(parsed.runtime.demo_tasks[0].input.task_text, "查官方价格");
});
