import assert from "node:assert/strict";

import { makeGateway } from "../tool-gateway.mjs";

const employeePolicy = {
  tools: {
    web_search: {
      capability: "web.search",
      necessity: "required",
      permission: "readonly",
    },
    browser_render: {
      capability: "browser.render",
      necessity: "conditional",
      permission: "requires_authorization",
      granted: true,
      limits: { max_calls_per_task: 2, timeout_ms: 45_000 },
      on_unavailable: "degrade",
    },
    bash: {
      capability: "shell.run",
      necessity: "non_default",
      permission: "requires_authorization",
    },
    write_file: {
      capability: "files.write",
      necessity: "disabled",
      permission: "disabled",
    },
  },
};

const gateway = makeGateway({ employeePolicy });

const requiredRead = gateway.check("web_search", { query: "CrewClaw" });
assert.equal(requiredRead.decision, "allow");
assert.equal(requiredRead.capability, "web.search");
assert.equal(requiredRead.employee_permission, "readonly");

const undeclared = gateway.check("read_file", { path: "README.md" });
assert.equal(
  undeclared.decision,
  "deny",
  "platform-allowed tools still fail closed when the employee did not declare them"
);
assert.equal(undeclared.decision_source, "employee_policy");

const disabled = gateway.check("write_file", { path: "notes.md" });
assert.equal(disabled.decision, "deny");
assert.match(disabled.reason, /明确禁用/);

const explicitApproval = gateway.check("browser_render", {
  url: "https://example.com",
});
assert.equal(
  explicitApproval.decision,
  "confirm",
  "employee authorization can strengthen a platform-allowed read"
);
assert.equal(explicitApproval.decision_source, "employee_policy");
assert.deepEqual(explicitApproval.limits, {
  max_calls_per_task: 2,
  timeout_ms: 45_000,
});
assert.equal(explicitApproval.on_unavailable, "degrade");

const notGranted = gateway.check("bash", { command: "git status" });
assert.equal(notGranted.decision, "deny");
assert.equal(notGranted.decision_source, "workspace_grant");

const conditionalNotGranted = makeGateway({
  employeePolicy: {
    tools: {
      web_search: {
        capability: "web.search",
        necessity: "conditional",
        permission: "readonly",
        granted: false,
      },
    },
  },
}).check("web_search", { query: "CrewClaw" });
assert.equal(conditionalNotGranted.decision, "deny");
assert.equal(conditionalNotGranted.decision_source, "workspace_grant");

const alwaysConfirm = makeGateway({
  employeePolicy: {
    tools: {
      web_search: {
        capability: "web.search",
        necessity: "required",
        permission: "readonly",
        granted: true,
        approval: "always",
      },
    },
  },
}).check("web_search", { query: "CrewClaw" });
assert.equal(alwaysConfirm.decision, "confirm");
assert.equal(alwaysConfirm.decision_source, "employee_policy");

const grantedGateway = makeGateway({
  employeePolicy: {
    tools: {
      ...employeePolicy.tools,
      bash: { ...employeePolicy.tools.bash, granted: true },
    },
  },
});
const granted = grantedGateway.check("bash", { command: "git status" });
assert.equal(granted.decision, "confirm");
assert.equal(granted.capability, "shell.run");

const platformStillWins = grantedGateway.check("browser_render", {
  url: "http://127.0.0.1/private",
});
assert.equal(platformStillWins.decision, "deny");
assert.equal(platformStillWins.decision_source, "network_scope");

const mergedGateway = makeGateway({
  employeePolicy: {
    tools: {
      web_fetch: {
        capabilities: ["web.fetch", "web.fetch_extract"],
        necessity: "required",
        permission: "requires_authorization",
        granted: true,
      },
    },
  },
});
const plainFetch = mergedGateway.check("web_fetch", {
  url: "https://example.com/page",
});
const extractFetch = mergedGateway.check("web_fetch", {
  url: "https://example.com/page",
  extract: "price",
});
assert.equal(plainFetch.capability, "web.fetch");
assert.equal(extractFetch.capability, "web.fetch_extract");
assert.deepEqual(extractFetch.capabilities, ["web.fetch", "web.fetch_extract"]);
assert.equal(extractFetch.decision, "confirm");

for (const [declared, allowedArgs, deniedArgs] of [
  [
    "web.fetch",
    { url: "https://example.com/plain" },
    { url: "https://example.com", extract: "price" },
  ],
  [
    "web.fetch_extract",
    { url: "https://example.com", extract: "price" },
    { url: "https://example.com/plain" },
  ],
]) {
  const singleAlias = makeGateway({
    employeePolicy: {
      tools: {
        web_fetch: {
          capability: declared,
          capabilities: [declared],
          necessity: "required",
          permission: "readonly",
          granted: true,
        },
      },
    },
  });
  assert.equal(singleAlias.check("web_fetch", allowedArgs).decision, "allow");
  const deniedAlias = singleAlias.check("web_fetch", deniedArgs);
  assert.equal(deniedAlias.decision, "deny");
  assert.equal(deniedAlias.decision_source, "employee_policy");
}

const invalidExtract = mergedGateway.check("web_fetch", {
  url: "https://example.com/page",
  extract: 42,
});
assert.equal(invalidExtract.decision, "deny");
assert.equal(invalidExtract.decision_source, "tool_arguments");
const blankExtract = mergedGateway.check("web_fetch", {
  url: "https://example.com/page",
  extract: "   ",
});
assert.equal(blankExtract.capability, "web.fetch");

console.log("employee-policy-gateway tests passed");
