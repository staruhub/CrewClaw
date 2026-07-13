import assert from "node:assert/strict";

import {
  resolveEmployeeTools,
  validateEmployeeToolNeeds,
} from "../employee-tools.mjs";

const schema = name => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object" } },
});

const catalog = {
  version: 1,
  tools: [
    {
      id: "web.search",
      invocation: "model",
      runtime_tool: "web_search",
      provider_bindings: ["builtin:web_search"],
    },
    {
      id: "browser.render",
      invocation: "model",
      runtime_tool: "browser_render",
      provider_bindings: ["builtin:browser_render"],
    },
    {
      id: "artifact.report",
      invocation: "engine",
      provider_bindings: ["builtin:artifact_store"],
    },
    {
      id: "contacts.read",
      invocation: "adapter",
      provider_bindings: [{ provider: "contacts", tools: ["read"] }],
    },
  ],
};

const result = resolveEmployeeTools({
  catalog,
  toolSchemas: [
    schema("web_search"),
    schema("browser_render"),
    schema("read_file"),
    schema("write_file"),
  ],
  toolNeeds: {
    "web.search": {
      necessity: "required",
      permission: "readonly",
      description: "search public sources",
    },
    "browser.render": {
      necessity: "conditional",
      permission: "requires_authorization",
      description: "render dynamic pages",
    },
    "artifact.report": {
      necessity: "required",
      permission: "write",
      description: "persist the task report",
    },
    "contacts.read": {
      necessity: "non_default",
      permission: "requires_authorization",
      description: "read contacts with consent",
    },
  },
  grants: ["browser.render"],
  env: { TAVILY_API_KEY: "configured-for-test" },
  surface: "task",
});

assert.equal(result.ok, true);
assert.deepEqual(
  result.visibleTools.map(tool => tool.function.name).sort(),
  ["web_search"],
  "the model only sees declared, bound, executable model tools"
);
assert.equal(
  result.resolved.find(item => item.capability === "browser.render")
    .availability,
  "unavailable",
  "a registered browser schema is not readiness while renderer egress is disabled"
);
assert.equal(result.employeePolicy.tools.web_search.capability, "web.search");
assert.equal(
  result.resolved.find(item => item.capability === "contacts.read")
    .availability,
  "not_granted"
);
assert.equal(
  result.visibleTools.some(tool => tool.function.name === "write_file"),
  false,
  "global write tools are not leaked"
);

const missing = resolveEmployeeTools({
  catalog,
  toolSchemas: [],
  toolNeeds: {
    "web.search": {
      necessity: "required",
      permission: "readonly",
      description: "search public sources",
    },
  },
});
assert.equal(missing.ok, false);
assert.equal(missing.blocking[0].capability, "web.search");
assert.equal(missing.blocking[0].availability, "unavailable");

const unknown = resolveEmployeeTools({
  catalog,
  toolSchemas: [],
  toolNeeds: {
    "web.serach": {
      necessity: "required",
      permission: "readonly",
      description: "invalid catalog typo",
    },
  },
});
assert.equal(unknown.ok, false);
assert.equal(unknown.errors[0].code, "unknown_capability");

const sharedRuntimeTool = resolveEmployeeTools({
  catalog: {
    capabilities: [
      {
        id: "web.fetch",
        invocation: "model",
        runtime_tool: "web_fetch",
        provider_bindings: [],
      },
      {
        id: "web.fetch_extract",
        invocation: "model",
        runtime_tool: "web_fetch",
        provider_bindings: [],
      },
    ],
  },
  toolSchemas: [schema("web_fetch")],
  toolNeeds: {
    "web.fetch": {
      necessity: "required",
      permission: "readonly",
      description: "read a public page",
    },
    "web.fetch_extract": {
      necessity: "conditional",
      permission: "requires_authorization",
      description: "extract a public page",
    },
  },
  grants: ["web.fetch_extract"],
});
assert.deepEqual(
  sharedRuntimeTool.employeePolicy.tools.web_fetch.capabilities,
  ["web.fetch", "web.fetch_extract"]
);
assert.equal(
  sharedRuntimeTool.employeePolicy.tools.web_fetch.permission,
  "requires_authorization"
);
assert.equal(
  sharedRuntimeTool.employeePolicy.tools.web_fetch.authorization,
  "per_call",
  "shared runtime tools inherit the strongest authorization requirement"
);
assert.equal(
  sharedRuntimeTool.employeePolicy.tools.web_fetch.capability,
  undefined,
  "a merged runtime tool does not misattribute the call to the first capability"
);

const unimplementedEngine = resolveEmployeeTools({
  catalog: {
    capabilities: [
      {
        id: "analytics.aggregate",
        invocation: "engine",
        runtime_tool: null,
        provider_bindings: [
          { provider: "crewclaw.analytics", tools: ["aggregate"] },
        ],
      },
    ],
  },
  toolNeeds: {
    "analytics.aggregate": {
      necessity: "conditional",
      permission: "requires_authorization",
      description: "aggregate analytics",
    },
  },
  grants: ["analytics.aggregate"],
  configuredProviders: ["crewclaw.analytics"],
});
assert.equal(unimplementedEngine.resolved[0].availability, "unavailable");
assert.equal(unimplementedEngine.degraded[0].capability, "analytics.aggregate");

const unselectedAlias = resolveEmployeeTools({
  catalog: {
    capabilities: [
      {
        id: "web.fetch",
        invocation: "model",
        runtime_tool: "web_fetch",
        provider_bindings: [],
      },
      {
        id: "web.fetch_extract",
        invocation: "model",
        runtime_tool: "web_fetch",
        provider_bindings: [],
      },
    ],
  },
  toolSchemas: [schema("web_fetch")],
  toolNeeds: {
    "web.fetch": {
      necessity: "required",
      permission: "readonly",
      description: "read a public page",
    },
    "web.fetch_extract": {
      necessity: "non_default",
      permission: "requires_authorization",
      description: "extract a public page",
    },
  },
});
assert.deepEqual(
  unselectedAlias.visibleTools.map(tool => tool.function.name),
  ["web_fetch"],
  "an unselected alias must not hide an independently safe shared runtime tool"
);
assert.deepEqual(
  unselectedAlias.employeePolicy.tools.web_fetch.capabilities,
  ["web.fetch"],
  "the emitted policy must not re-authorize the unselected extract variant"
);
assert.equal(
  unselectedAlias.sessionCatalog.find(
    item => item.capability === "web.fetch_extract"
  ).authorization,
  "not_granted"
);

const providerAliases = resolveEmployeeTools({
  catalog: {
    capabilities: [
      {
        id: "research.search",
        invocation: "model",
        runtime_tool: "web_search",
        provider_bindings: ["builtin:web_search"],
      },
      {
        id: "research.render",
        invocation: "model",
        runtime_tool: "browser_render",
        provider_bindings: ["builtin:browser_render"],
      },
    ],
  },
  toolSchemas: [schema("web_search"), schema("browser_render")],
  toolNeeds: {
    "research.search": {
      necessity: "required",
      permission: "readonly",
      description: "search through a catalog alias",
      on_unavailable: "fail",
    },
    "research.render": {
      necessity: "required",
      permission: "readonly",
      description: "render through a catalog alias",
      on_unavailable: "fail",
    },
  },
  env: {},
});
assert.equal(providerAliases.ok, false);
assert.deepEqual(
  providerAliases.blocking.map(item => item.capability).sort(),
  ["research.render", "research.search"],
  "runtime-tool aliases must not bypass search/render provider health"
);
assert.equal(
  providerAliases.resolved.find(item => item.capability === "research.search")
    ?.code,
  "missing_key",
  "a required/fail search alias with no key is blocking"
);

for (const [label, need, expected] of [
  [
    "required skip",
    {
      necessity: "required",
      permission: "readonly",
      description: "invalid required fallback",
      on_unavailable: "skip",
    },
    /不能静默 skip/,
  ],
  [
    "invalid enum",
    {
      necessity: "sometimes",
      permission: "readonly",
      description: "invalid necessity",
    },
    /necessity 非法/,
  ],
  [
    "unknown field",
    {
      necessity: "required",
      permission: "readonly",
      description: "unknown extension",
      surprise: true,
    },
    /含未知字段/,
  ],
]) {
  const toolNeeds = { "web.search": need };
  const validation = validateEmployeeToolNeeds(toolNeeds, { catalog });
  assert.equal(validation.ok, false, `${label} fails runtime validation`);
  assert.match(
    validation.errors.map(error => error.reason).join("\n"),
    expected
  );
  const resolution = resolveEmployeeTools({
    catalog,
    toolSchemas: [schema("web_search")],
    toolNeeds,
    env: { TAVILY_API_KEY: "configured-for-test" },
  });
  assert.equal(resolution.ok, false, `${label} fails closed at resolution`);
  assert.deepEqual(resolution.visibleTools, []);
  assert.equal(resolution.blocking[0]?.availability, "invalid");
}

console.log("tool-resolver tests passed");
