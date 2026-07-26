import assert from "node:assert/strict";
import {
  derivePermissionPolicy,
  permissionTierForNeed,
} from "../permission-policy.mjs";
import { validateEmployeePackage } from "../employee-package.mjs";

assert.equal(permissionTierForNeed({ permission: "readonly" }), "P0");
assert.equal(permissionTierForNeed({ permission: "write" }), "P1");
assert.equal(
  permissionTierForNeed({ permission: "requires_authorization" }),
  "P2"
);
assert.equal(permissionTierForNeed({ permission: "disabled" }), "P4");
assert.equal(permissionTierForNeed({}), "P4");

const derived = derivePermissionPolicy(
  {
    "web.search": { permission: "readonly", necessity: "required" },
    "artifact.report": { permission: "write", necessity: "required" },
    "browser.render": {
      permission: "requires_authorization",
      necessity: "conditional",
    },
    "message.send": { permission: "disabled", necessity: "disabled" },
  },
  {
    default_level: "P1",
    levels: { P0: "public read" },
  }
);

assert.equal(derived.default_level, "P1");
assert.deepEqual(derived.grants, {
  "web.search": "P0",
  "artifact.report": "P1",
  "browser.render": "P2",
});
assert.deepEqual(derived.denied, { "message.send": "P4" });
assert.deepEqual(derived.human_authorization_required, ["browser.render"]);
assert.equal(derived.levels.P0, "public read");

{
  const drifted = validateEmployeePackage({
    identity: { id: "drift" },
    role_contract: { responsibilities: ["x"] },
    soul: { style: "y" },
    deliverables: ["report"],
    tool_needs: {
      "web.search": {
        necessity: "required",
        permission: "readonly",
        description: "search",
      },
    },
    permission_policy: {
      default_level: "P1",
      grants: { "artifact.report": "P1" },
      denied: {},
      human_authorization_required: [],
    },
    eval_suite: { smoke_tests: [{ id: "s", task: "t" }] },
    outcome_rubric: ["verified"],
    compatibility_targets: { OpenWork: "L4" },
  });
  assert.equal(drifted.ok, false);
  assert.match(drifted.errors.join("\n"), /permission_policy\.grants/);
}

console.log("permission-policy.test.mjs passed");
