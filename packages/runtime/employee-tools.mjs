import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProviderHealth } from "./render-provider.mjs";
import { readStateFileGuarded } from "./state-lock.mjs";
import { searchProviderHealth } from "./tools-web.mjs";

const NECESSITY_RANK = {
  disabled: 0,
  non_default: 1,
  conditional: 2,
  required: 3,
};

const PERMISSION_RANK = {
  disabled: 0,
  readonly: 1,
  write: 2,
  requires_authorization: 3,
};
const APPROVAL_RANK = { never: 0, when_needed: 1, always: 2 };
const UNAVAILABLE_RANK = { skip: 0, degrade: 1, ask_user: 2, fail: 3 };
const CAPABILITY_GRANT_PREFIX = "capability:";
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const TASK_ENGINE_CAPABILITIES = new Set(["source.verify", "evidence.create"]);

/**
 * Resolve the immutable workspace capability grant snapshot without conflating it with legacy
 * hire.yaml scopes.
 *
 * `team.json.permissions_granted` contributes only `capability:<id>` entries for the active
 * employee. Environment variables are deliberately ignored: `.env.local` belongs to the
 * workspace and therefore cannot be allowed to widen a hire-time permission decision.
 */
export function loadWorkspaceCapabilityGrants({ root, employeeId } = {}) {
  if (!root || !employeeId) {
    return {
      active: false,
      employee: null,
      grants: [],
      source: "none",
      warning: null,
    };
  }

  const path = join(root, ".crewclaw", "team.json");
  if (!existsSync(path)) {
    return {
      active: false,
      employee: null,
      grants: [],
      source: "team_absent",
      warning: null,
      path,
    };
  }
  try {
    const value = JSON.parse(
      readStateFileGuarded(path, { root, maxBytes: 1024 * 1024 }).toString(
        "utf8"
      )
    );
    if (!Array.isArray(value)) throw new Error("team state must be an array");
    const active = value.filter(
      item =>
        item &&
        typeof item === "object" &&
        item.employee_id === employeeId &&
        item.status === "active"
    );
    if (active.length > 1) {
      throw new Error(`multiple active team records for ${employeeId}`);
    }
    if (active.length === 0) {
      return {
        active: false,
        employee: null,
        grants: [],
        source: "team",
        warning: null,
        path,
      };
    }
    if (!Array.isArray(active[0].permissions_granted)) {
      throw new Error("permissions_granted must be an array");
    }
    const grants = active[0].permissions_granted
      .filter(value => typeof value === "string")
      .filter(value => value.startsWith(CAPABILITY_GRANT_PREFIX))
      .map(value => value.slice(CAPABILITY_GRANT_PREFIX.length))
      .filter(value => CAPABILITY_ID.test(value));
    return {
      active: true,
      employee: {
        workspace_employee_id:
          typeof active[0].workspace_employee_id === "string"
            ? active[0].workspace_employee_id
            : null,
        employee_id: active[0].employee_id,
        version:
          typeof active[0].version === "string" ? active[0].version : null,
        hired_at:
          typeof active[0].hired_at === "string" ? active[0].hired_at : null,
        package_sha256:
          typeof active[0].package_sha256 === "string"
            ? active[0].package_sha256
            : null,
        hire_source:
          typeof active[0].hire_source === "string"
            ? active[0].hire_source
            : null,
      },
      grants: [...new Set(grants)].sort(),
      source: "team",
      warning:
        typeof active[0].package_sha256 === "string" ||
        active[0].hire_source === "cli" ||
        active[0].hire_source === "eval_harness"
          ? null
          : "active hire is a legacy record without package_sha256; re-hire to bind package integrity",
      path,
    };
  } catch (error) {
    return {
      active: false,
      employee: null,
      grants: [],
      source: "team_invalid",
      warning: `workspace capability grants ignored: ${error?.message || error}`,
      path,
    };
  }
}

/**
 * Runtime lifecycle gate. Loading an immutable profile is useful to Doctor and certification,
 * but executing an employee in a user workspace is only valid after a durable active hire.
 */
export function requireActiveWorkspaceEmployee({ root, employeeId } = {}) {
  const snapshot = loadWorkspaceCapabilityGrants({ root, employeeId });
  if (snapshot.active) return snapshot;

  const error = new Error(
    snapshot.source === "team_invalid"
      ? `cannot start "${employeeId}": .crewclaw/team.json is invalid (${snapshot.warning})`
      : `cannot start "${employeeId}": employee is not hired and active in this workspace; run crew hire ${employeeId}`
  );
  error.code =
    snapshot.source === "team_invalid" ? "team_invalid" : "employee_not_hired";
  error.teamSnapshot = snapshot;
  throw error;
}

function catalogEntries(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (Array.isArray(catalog?.capabilities)) return catalog.capabilities;
  if (Array.isArray(catalog?.tools)) return catalog.tools;
  if (catalog?.tools && typeof catalog.tools === "object") {
    return Object.entries(catalog.tools).map(([id, value]) => ({
      id,
      ...(value || {}),
    }));
  }
  if (catalog && typeof catalog === "object") {
    return Object.entries(catalog)
      .filter(([key]) => key !== "version" && key !== "$schema")
      .map(([id, value]) => ({ id, ...(value || {}) }));
  }
  return [];
}

const TOOL_NECESSITIES = new Set([
  "required",
  "conditional",
  "non_default",
  "disabled",
]);
const TOOL_PERMISSIONS = new Set([
  "readonly",
  "write",
  "requires_authorization",
  "disabled",
]);
const TOOL_APPROVALS = new Set(["never", "when_needed", "always"]);
const TOOL_UNAVAILABLE_POLICIES = new Set([
  "fail",
  "degrade",
  "ask_user",
  "skip",
]);
const TOOL_NEED_KEYS = new Set([
  "necessity",
  "permission",
  "description",
  "scopes",
  "approval",
  "purpose",
  "limits",
  "on_unavailable",
]);
const TOOL_LIMIT_KEYS = new Set(["max_calls_per_task", "timeout_ms"]);

const isRecord = value =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

/**
 * Runtime mirror of contracts/employee-spec.ts ToolNeedSchema.
 *
 * The runtime is plain Node and cannot import the TypeScript/Zod contract. Keep this strict,
 * fail-closed structural check at the execution boundary so a hand-edited or replaced employee
 * spec cannot turn a typo into an authorization downgrade. Contract drift is pinned by tests.
 */
export function validateEmployeeToolNeeds(toolNeeds, { catalog } = {}) {
  const errors = [];
  if (!isRecord(toolNeeds)) {
    return {
      ok: false,
      errors: [
        {
          capability: "tool_needs",
          code: "invalid_tool_needs",
          reason: "tool_needs 必须是对象",
        },
      ],
    };
  }
  const knownCapabilities = new Set(
    catalogEntries(catalog)
      .map(entry => entry?.id)
      .filter(id => typeof id === "string")
  );
  const add = (capability, reason) =>
    errors.push({ capability, code: "invalid_tool_need", reason });

  for (const [capability, need] of Object.entries(toolNeeds)) {
    if (!CAPABILITY_ID.test(capability)) {
      add(capability, `${capability || "(empty)"} 不是合法 capability id`);
      continue;
    }
    if (knownCapabilities.size > 0 && !knownCapabilities.has(capability)) {
      errors.push({
        capability,
        code: "unknown_capability",
        reason: `${capability} 不在 ToolCatalog 中`,
      });
      continue;
    }
    if (!isRecord(need)) {
      add(capability, `${capability} 的 tool need 必须是对象`);
      continue;
    }
    const unknownKeys = Object.keys(need).filter(
      key => !TOOL_NEED_KEYS.has(key)
    );
    if (unknownKeys.length) {
      add(capability, `${capability} 含未知字段：${unknownKeys.join(", ")}`);
    }
    if (!TOOL_NECESSITIES.has(need.necessity)) {
      add(capability, `${capability}.necessity 非法`);
    }
    if (!TOOL_PERMISSIONS.has(need.permission)) {
      add(capability, `${capability}.permission 非法`);
    }
    if (!nonEmpty(need.description)) {
      add(capability, `${capability}.description 必须是非空字符串`);
    }
    if (
      need.scopes !== undefined &&
      (!Array.isArray(need.scopes) || !need.scopes.every(nonEmpty))
    ) {
      add(capability, `${capability}.scopes 必须是非空字符串数组`);
    }
    if (need.approval !== undefined && !TOOL_APPROVALS.has(need.approval)) {
      add(capability, `${capability}.approval 非法`);
    }
    if (need.purpose !== undefined && !nonEmpty(need.purpose)) {
      add(capability, `${capability}.purpose 必须是非空字符串`);
    }
    if (
      need.on_unavailable !== undefined &&
      !TOOL_UNAVAILABLE_POLICIES.has(need.on_unavailable)
    ) {
      add(capability, `${capability}.on_unavailable 非法`);
    }
    if (need.limits !== undefined) {
      if (!isRecord(need.limits)) {
        add(capability, `${capability}.limits 必须是对象`);
      } else {
        const unknownLimits = Object.keys(need.limits).filter(
          key => !TOOL_LIMIT_KEYS.has(key)
        );
        if (unknownLimits.length) {
          add(
            capability,
            `${capability}.limits 含未知字段：${unknownLimits.join(", ")}`
          );
        }
        if (
          need.limits.max_calls_per_task !== undefined &&
          (!Number.isSafeInteger(need.limits.max_calls_per_task) ||
            need.limits.max_calls_per_task <= 0)
        ) {
          add(
            capability,
            `${capability}.limits.max_calls_per_task 必须是正整数`
          );
        }
        if (
          need.limits.timeout_ms !== undefined &&
          (!Number.isSafeInteger(need.limits.timeout_ms) ||
            need.limits.timeout_ms <= 0 ||
            need.limits.timeout_ms > 300_000)
        ) {
          add(
            capability,
            `${capability}.limits.timeout_ms 必须是 1..300000 的整数`
          );
        }
      }
    }
    if ((need.necessity === "disabled") !== (need.permission === "disabled")) {
      add(
        capability,
        `${capability} 的 disabled necessity/permission 必须成对声明`
      );
    }
    if (
      need.permission === "requires_authorization" &&
      need.approval === "never"
    ) {
      add(
        capability,
        `${capability} requires_authorization 不能使用 approval=never`
      );
    }
    if (need.necessity === "required" && need.on_unavailable === "skip") {
      add(capability, `${capability} 是 required，不能静默 skip`);
    }
    if (
      need.necessity === "non_default" &&
      need.permission !== "requires_authorization"
    ) {
      add(capability, `${capability} 是 non_default，必须逐次人工授权`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function runtimeToolOf(definition) {
  const value =
    definition?.runtime_tool ??
    definition?.runtimeTool ??
    definition?.binding?.runtime_tool;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function invocationOf(definition) {
  return definition?.invocation || "model";
}

function providerBindingsOf(definition) {
  const value = definition?.provider_bindings ?? definition?.providerBindings;
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map(binding => {
    if (typeof binding === "string") {
      const separator = binding.indexOf(":");
      return separator > 0
        ? {
            provider: binding.slice(0, separator),
            tools: [binding.slice(separator + 1)],
          }
        : { provider: binding, tools: [] };
    }
    return {
      provider: String(binding.provider || ""),
      tools: Array.isArray(binding.tools)
        ? binding.tools.filter(tool => typeof tool === "string" && tool)
        : [],
    };
  });
}

function configuredProviderSet(configuredProviders) {
  if (configuredProviders instanceof Set) return configuredProviders;
  if (Array.isArray(configuredProviders)) return new Set(configuredProviders);
  if (configuredProviders && typeof configuredProviders === "object") {
    return new Set(
      Object.entries(configuredProviders)
        .filter(([, ready]) => ready === true)
        .map(([provider]) => provider)
    );
  }
  return new Set();
}

export const DEFAULT_ENGINE_CAPABILITIES = new Set(TASK_ENGINE_CAPABILITIES);

export function capabilityRuntimeAvailability(
  definition,
  {
    toolSchemaNames = new Set(),
    env = process.env,
    surface = "task",
    engineCapabilities,
  } = {}
) {
  const invocation = invocationOf(definition);
  const runtimeTool = runtimeToolOf(definition);
  const engineReady = new Set(
    engineCapabilities ??
      (surface === "task" ? DEFAULT_ENGINE_CAPABILITIES : [])
  );

  if (invocation === "model") {
    if (!runtimeTool) {
      return {
        availability: "unbound",
        reason: "模型能力没有 runtime_tool binding",
        code: "unbound",
      };
    }
    if (!toolSchemaNames.has(runtimeTool)) {
      return {
        availability: "unavailable",
        reason: `运行时未注册 ${runtimeTool}`,
        code: "tool_unregistered",
      };
    }
    // Provider readiness belongs to the executable runtime binding, not to one
    // canonical capability id. Catalog aliases that share web_search/browser_render
    // must cross the same health gate or a renamed capability could bypass preflight.
    if (runtimeTool === "web_search") {
      const health = searchProviderHealth(env);
      return {
        availability: health.ready ? "ready" : "unavailable",
        reason: health.reason,
        code: health.code,
        provider: health.provider,
      };
    }
    if (runtimeTool === "browser_render") {
      const health = renderProviderHealth(env);
      return {
        availability: health.ready ? "ready" : "unavailable",
        reason: health.reason,
        code: health.code,
        provider: health.provider,
      };
    }
    return {
      availability: "ready",
      reason: "运行时 handler 已注册",
      code: "ready",
    };
  }

  if (invocation === "engine") {
    if (engineReady.has(definition.id)) {
      return {
        availability: "ready",
        reason: `${surface} surface 已注册 engine handler`,
        code: "ready",
        provider: providerBindingsOf(definition)[0]?.provider,
      };
    }
    if (surface !== "task" && TASK_ENGINE_CAPABILITIES.has(definition.id)) {
      return {
        availability: "not_applicable",
        applicable: false,
        reason: `${definition.id} 仅在正式 Task surface 完整执行`,
        code: "surface_not_applicable",
      };
    }
    return {
      availability: "unavailable",
      reason: "engine capability 尚未在当前 surface 注册 handler",
      code: "engine_unimplemented",
    };
  }

  return {
    availability: "ready",
    reason: "adapter policy 待 provider 检查",
    code: "ready",
  };
}

function authorizationOf({ necessity, permission, granted, approval }) {
  if (necessity === "disabled" || permission === "disabled") return "denied";
  if ((necessity === "non_default" || necessity === "conditional") && !granted)
    return "not_granted";
  // Opt-in changes visibility, never the per-call consent boundary.
  if (necessity === "non_default") return "per_call";
  if (approval === "always") return "per_call";
  if (permission === "requires_authorization") return "per_call";
  return "automatic";
}

function strongest(values, rank, fallback) {
  return values.reduce(
    (best, value) => ((rank[value] ?? -1) > (rank[best] ?? -1) ? value : best),
    fallback
  );
}

function minimumPositive(values) {
  const valid = values.filter(value => Number.isInteger(value) && value > 0);
  return valid.length ? Math.min(...valid) : undefined;
}

export function loadToolCatalog(installRoot) {
  const path = join(installRoot, "contracts", "tool-catalog.json");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const entries = catalogEntries(parsed);
  if (!entries.length) throw new Error("tool catalog is empty");
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.id || typeof entry.id !== "string") {
      throw new Error("tool catalog entry is missing id");
    }
    if (seen.has(entry.id))
      throw new Error(`duplicate tool capability: ${entry.id}`);
    seen.add(entry.id);
  }
  return {
    ...parsed,
    version: parsed.catalog_version || parsed.version || "1",
    tools: entries,
    capabilities: entries,
    path,
  };
}

export function configuredProvidersFromEnv(
  _env = process.env,
  executableProviders = []
) {
  // Environment variables alone never create capability. The profile loader passes only
  // providers backed by a validated executable adapter (for v0.20, a ready mcp.json server).
  return new Set(
    [...executableProviders].filter(value =>
      /^mcp\.[a-z][a-z0-9_-]*$/.test(value)
    )
  );
}

export function runtimeToolReadiness(toolResolution, runtimeTool) {
  const name = String(runtimeTool || "").trim();
  const entries = Array.isArray(toolResolution?.sessionCatalog)
    ? toolResolution.sessionCatalog.filter(item => item?.runtime_tool === name)
    : [];
  const selected =
    entries.find(item => item.availability === "ready") ||
    entries.find(item => item.applicable !== false) ||
    entries[0];
  const ready = selected?.availability === "ready";
  return {
    runtime_tool: name,
    ready,
    availability: selected?.availability || "unresolved",
    code: selected?.code || (ready ? "ready" : "tool_unresolved"),
    reason:
      selected?.reason ||
      (ready
        ? "运行时 handler 已注册"
        : name
          ? `当前员工解析结果未声明 runtime tool ${name}`
          : "runtime tool 名称为空"),
    provider: selected?.provider || null,
    capabilities: entries.map(item => item.capability).filter(Boolean),
  };
}

export function resolveEmployeeTools({
  toolNeeds = {},
  catalog,
  toolSchemas = [],
  grants = [],
  configuredProviders = [],
  engineCapabilities,
  env = process.env,
  surface = "task",
} = {}) {
  const definitions = catalogEntries(catalog);
  const definitionsById = new Map(definitions.map(entry => [entry.id, entry]));
  const toolNeedValidation = validateEmployeeToolNeeds(toolNeeds, { catalog });
  const schemasByName = new Map(
    toolSchemas
      .map(schema => [schema?.function?.name, schema])
      .filter(([name]) => typeof name === "string" && name)
  );
  const granted = new Set(grants || []);
  const providers = configuredProviderSet(configuredProviders);
  const engineReady = new Set(
    engineCapabilities ??
      (surface === "task" ? DEFAULT_ENGINE_CAPABILITIES : [])
  );
  const toolSchemaNames = new Set(schemasByName.keys());
  const resolved = [];
  const errors = [...toolNeedValidation.errors];

  for (const [capability, need] of Object.entries(toolNeeds || {})) {
    if (
      toolNeedValidation.errors.some(error => error.capability === capability)
    )
      continue;
    const definition = definitionsById.get(capability);
    if (!definition) {
      errors.push({
        capability,
        code: "unknown_capability",
        reason: `${capability} 不在 ToolCatalog 中`,
      });
      continue;
    }
    const necessity = need?.necessity || "conditional";
    const permission = need?.permission || "readonly";
    const invocation = invocationOf(definition);
    const runtimeTool = runtimeToolOf(definition);
    const bindings = providerBindingsOf(definition);
    // A capability is usable only when this frozen hire/session snapshot selected it.
    // `required` is selected by the manifest itself; `conditional` and `non_default`
    // are opt-ins recorded at hire time.  In particular, do not treat a declared
    // conditional capability as granted just because it occurs in the YAML.
    const isGranted =
      necessity !== "disabled" &&
      permission !== "disabled" &&
      (necessity === "required" || granted.has(capability));
    const runtimeAvailability = capabilityRuntimeAvailability(definition, {
      toolSchemaNames,
      env,
      surface,
      engineCapabilities: engineReady,
    });
    let availability = "ready";
    let reason = "已解析";
    let code = "ready";
    let provider = runtimeAvailability.provider;
    let applicable = runtimeAvailability.applicable !== false;

    if (necessity === "disabled" || permission === "disabled") {
      availability = "forbidden";
      reason = "员工策略明确禁用";
      code = "policy_forbidden";
    } else if (
      (necessity === "non_default" || necessity === "conditional") &&
      !isGranted
    ) {
      availability = "not_granted";
      reason = "此能力尚未获得本次工作区授权";
      code = "not_granted";
    } else if (invocation !== "model" && bindings.length === 0) {
      availability = "unbound";
      reason = `${invocation} 能力没有 provider binding`;
      code = "unbound";
    } else if (
      invocation === "adapter" &&
      !bindings.some(binding => providers.has(binding.provider))
    ) {
      availability = "unavailable";
      reason = `adapter 未配置（需要 ${bindings
        .map(binding => binding.provider)
        .filter(Boolean)
        .join(" / ")}）`;
      code = "provider_unavailable";
    } else {
      availability = runtimeAvailability.availability;
      reason = runtimeAvailability.reason;
      code = runtimeAvailability.code;
      provider = runtimeAvailability.provider;
      applicable = runtimeAvailability.applicable !== false;
    }

    resolved.push({
      capability,
      definition,
      necessity,
      permission,
      invocation,
      runtime_tool: runtimeTool,
      provider_bindings: bindings,
      granted: isGranted,
      availability,
      reason,
      code,
      provider,
      applicable,
      need,
    });
  }

  const modelGroups = new Map();
  for (const item of resolved) {
    if (
      item.invocation !== "model" ||
      !item.runtime_tool ||
      !schemasByName.has(item.runtime_tool)
    ) {
      continue;
    }
    const group = modelGroups.get(item.runtime_tool) || [];
    group.push(item);
    modelGroups.set(item.runtime_tool, group);
  }

  const visibleTools = [];
  const policyTools = {};
  for (const [runtimeTool, items] of modelGroups) {
    const schema = schemasByName.get(runtimeTool);
    if (!schema) continue;
    const readyItems = items.filter(item => item.availability === "ready");
    if (readyItems.length === 0) continue;
    // An unselected optional alias must not remove a separately safe alias from the
    // model surface. Only aliases that this frozen session actually enabled can make
    // the shared runtime schema ambiguous.
    const enabledItems = items.filter(
      item =>
        item.permission !== "disabled" &&
        (item.necessity === "required" || item.granted)
    );
    const unsafeAliases = enabledItems.filter(
      item => item.availability !== "ready"
    );
    if (unsafeAliases.length > 0) {
      const conflictReason = `${runtimeTool} 同时绑定可用与不可用能力，运行时无法安全区分：${unsafeAliases
        .map(item => `${item.capability}=${item.availability}`)
        .join("、")}`;
      errors.push({
        capability: items.map(item => item.capability).join(","),
        code: "ambiguous_runtime_tool_policy",
        reason: conflictReason,
      });
      for (const item of items) {
        item.availability = "invalid";
        item.reason = conflictReason;
        item.code = "ambiguous_runtime_tool_policy";
      }
      continue;
    }
    visibleTools.push(schema);
    // Policies are generated from callable aliases only. Keeping an unselected
    // `web.fetch_extract` in a `web_fetch` policy would re-open that argument
    // variant even though the resolver correctly hid it from the session.
    const necessity = strongest(
      readyItems.map(item => item.necessity),
      NECESSITY_RANK,
      "disabled"
    );
    let permission = strongest(
      readyItems.map(item => item.permission),
      PERMISSION_RANK,
      "disabled"
    );
    if (readyItems.some(item => item.necessity === "non_default")) {
      permission = "requires_authorization";
    }
    const mergedGranted = readyItems.every(item => item.granted);
    const capabilities = readyItems.map(item => item.capability);
    const maxCalls = minimumPositive(
      readyItems.map(item => item.need?.limits?.max_calls_per_task)
    );
    const timeoutMs = minimumPositive(
      readyItems.flatMap(item => [
        item.need?.limits?.timeout_ms,
        item.definition?.timeout_ms,
      ])
    );
    const scopes = [
      ...new Set(readyItems.flatMap(item => item.need?.scopes || [])),
    ];
    const approval = strongest(
      readyItems.map(item => item.need?.approval).filter(Boolean),
      APPROVAL_RANK,
      "never"
    );
    const onUnavailable = strongest(
      readyItems.map(item => item.need?.on_unavailable).filter(Boolean),
      UNAVAILABLE_RANK,
      "skip"
    );
    policyTools[runtimeTool] = {
      ...(capabilities.length === 1 ? { capability: capabilities[0] } : {}),
      capabilities,
      necessity,
      permission,
      granted: mergedGranted,
      authorization: authorizationOf({
        necessity,
        permission,
        granted: mergedGranted,
        approval,
      }),
      scopes,
      approval,
      on_unavailable: onUnavailable,
      limits: {
        ...(maxCalls ? { max_calls_per_task: maxCalls } : {}),
        ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
      },
    };
  }

  // Directory discovery is the read-only companion to read_file. Employee packages keep
  // declaring the stable files.read/document.read capability, while the runtime exposes both
  // schemas under the exact same frozen authorization policy. This avoids silently granting a
  // broader capability and keeps old employee manifests forward-compatible.
  const readPolicy = policyTools.read_file;
  const listSchema = schemasByName.get("list_files");
  if (
    readPolicy &&
    listSchema &&
    !visibleTools.some(tool => tool?.function?.name === "list_files")
  ) {
    visibleTools.push(listSchema);
    policyTools.list_files = {
      ...readPolicy,
      capabilities: [...(readPolicy.capabilities || [])],
      scopes: [...(readPolicy.scopes || [])],
      limits: { ...(readPolicy.limits || {}) },
    };
  }

  const unavailableMode = item => {
    if (item.need?.on_unavailable) return item.need.on_unavailable;
    if (item.necessity === "required") return "fail";
    if (item.necessity === "conditional") return "degrade";
    // A user explicitly selected optional capability should result in a clear
    // repair action, not a silently missing tool.
    if (item.necessity === "non_default" && item.granted) return "ask_user";
    return "skip";
  };
  const enabledAndApplicable = item =>
    item.applicable !== false &&
    item.necessity !== "disabled" &&
    item.permission !== "disabled" &&
    (item.necessity === "required" || item.granted);
  const unresolved = resolved.filter(
    item => enabledAndApplicable(item) && item.availability !== "ready"
  );
  const unavailableEntry = item => ({
    capability: item.capability,
    availability: item.availability,
    reason: item.reason,
    fix_action:
      item.availability === "not_granted"
        ? "grant_scope"
        : item.availability === "unbound"
          ? "configure_provider"
          : unavailableMode(item) === "ask_user"
            ? "ask_user"
            : "install_provider",
  });
  const blocking = [
    ...errors.map(error => ({
      capability: error.capability,
      availability: "invalid",
      reason: error.reason,
      fix_action: "validate_employee_package",
    })),
    ...unresolved
      .filter(item => ["fail", "ask_user"].includes(unavailableMode(item)))
      .map(unavailableEntry),
  ];
  const degraded = unresolved
    .filter(item => unavailableMode(item) === "degrade")
    .map(unavailableEntry);

  return {
    ok: errors.length === 0 && blocking.length === 0,
    errors,
    blocking,
    degraded,
    resolved,
    visibleTools,
    employeePolicy: { tools: policyTools },
    surface,
    sessionCatalog: resolved.map(item => ({
      capability: item.capability,
      label: item.definition.label || item.capability,
      invocation: item.invocation,
      operation: item.definition.operation,
      risk_tier: item.definition.risk_tier,
      runtime_tool: item.runtime_tool,
      necessity: item.necessity,
      permission: item.permission,
      declared: true,
      authorization: authorizationOf({
        ...item,
        approval: item.need?.approval,
      }),
      granted: item.granted,
      availability: item.availability,
      reason: item.reason,
      code: item.code,
      provider: item.provider || null,
      applicable: item.applicable,
      provider_bindings: item.provider_bindings,
      side_effects: item.definition.side_effects || [],
      supports_preview: item.definition.supports_preview === true,
      scopes: item.need?.scopes || [],
      approval: item.need?.approval || null,
      purpose: item.need?.purpose || null,
      limits: item.need?.limits || null,
      on_unavailable: item.need?.on_unavailable || null,
    })),
  };
}
