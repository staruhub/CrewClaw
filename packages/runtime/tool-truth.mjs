import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadToolCatalog } from "./employee-tools.mjs";
import { renderProviderHealth } from "./render-provider.mjs";
import { searchProviderHealth } from "./tools-web.mjs";

export const STATUS = Object.freeze({
  available: "available",
  configured_unverified: "configured_unverified",
  missing_key: "missing_key",
  rate_limited: "rate_limited",
  permission_required: "permission_required",
  disabled: "disabled",
  degraded: "degraded",
  unavailable: "unavailable",
});

const INSTALL_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

let defaultCatalog;
let defaultCatalogError;
try {
  defaultCatalog = loadToolCatalog(INSTALL_ROOT);
} catch (error) {
  defaultCatalogError = error;
  defaultCatalog = { capabilities: [], tools: [] };
}

export const CAPABILITIES = Object.freeze(
  (defaultCatalog.capabilities || []).map(item => item.id)
);

export function getRuntimeToolCatalog(opts = {}) {
  if (opts.catalog) return opts.catalog;
  if (!opts.installRoot || opts.installRoot === INSTALL_ROOT)
    return defaultCatalog;
  try {
    return loadToolCatalog(opts.installRoot);
  } catch {
    return { capabilities: [], tools: [] };
  }
}

function catalogEntries(catalog) {
  if (Array.isArray(catalog?.capabilities)) return catalog.capabilities;
  if (Array.isArray(catalog?.tools)) return catalog.tools;
  return [];
}

function entry(definition, status, fields = {}) {
  const out = {
    capability: definition.id,
    status,
    invocation: definition.invocation || "model",
    operation: definition.operation || "",
    runtime_tool: definition.runtime_tool || null,
  };
  if (fields.detail) out.detail = fields.detail;
  if (fields.provider) out.provider = fields.provider;
  if (fields.authorization) out.authorization = fields.authorization;
  if (fields.code) out.code = fields.code;
  return out;
}

function resolutionEntries(opts) {
  if (Array.isArray(opts.sessionCatalog)) return opts.sessionCatalog;
  if (Array.isArray(opts.toolResolution?.sessionCatalog)) {
    return opts.toolResolution.sessionCatalog;
  }
  return null;
}

function statusFromResolution(item) {
  if (!item) return STATUS.unavailable;
  if (item.availability === "ready") {
    return item.authorization === "per_call"
      ? STATUS.permission_required
      : STATUS.available;
  }
  if (item.availability === "forbidden") return STATUS.disabled;
  if (item.availability === "not_granted") return STATUS.permission_required;
  if (item.code === "missing_key") return STATUS.missing_key;
  if (item.availability === "degraded") return STATUS.degraded;
  return STATUS.unavailable;
}

function resolutionDetail(item) {
  if (!item) return "员工工具解析结果未声明此能力";
  return item.reason || `employee resolver: ${item.availability || "unknown"}`;
}

function searchHealth(env) {
  const health = searchProviderHealth(env);
  return {
    status: health.ready ? STATUS.available : STATUS.missing_key,
    provider: health.provider,
    detail: health.reason,
  };
}

function renderHealth(env, opts) {
  const input = opts?.renderProvider
    ? { ...env, CREW_RENDER_PROVIDER: opts.renderProvider }
    : opts?.renderEnv || env;
  const health = renderProviderHealth(input);
  return {
    status: STATUS.unavailable,
    provider: health.provider,
    detail: health.reason,
  };
}

function applyHealth(base, health) {
  if (
    ![
      STATUS.available,
      STATUS.configured_unverified,
      STATUS.permission_required,
    ].includes(base.status)
  ) {
    return base;
  }
  if (health.status !== STATUS.available) {
    return { ...base, ...health };
  }
  if (base.status === STATUS.permission_required) {
    return { ...base, provider: health.provider };
  }
  return {
    ...base,
    provider: health.provider,
    status:
      base.status === STATUS.available
        ? STATUS.available
        : STATUS.configured_unverified,
    detail:
      base.status === STATUS.configured_unverified
        ? "provider 已配置；员工工具解析结果未提供，未验证可调用性"
        : base.detail,
  };
}

export function getToolTruth(env = process.env, opts = {}) {
  const catalog = getRuntimeToolCatalog(opts);
  const definitions = catalogEntries(catalog);
  const byId = new Map(definitions.map(item => [item.id, item]));
  const resolved = resolutionEntries(opts);
  const resolutionById = new Map(
    (resolved || [])
      .filter(item => byId.has(item?.capability))
      .map(item => [item.capability, item])
  );
  const selected = resolved
    ? [...resolutionById.keys()].map(id => byId.get(id))
    : definitions;

  if (!selected.length && defaultCatalogError && !opts.catalog) return [];

  return selected.map(definition => {
    const resolvedItem = resolved
      ? resolutionById.get(definition.id)
      : undefined;
    let state = entry(
      definition,
      resolved
        ? statusFromResolution(resolvedItem)
        : STATUS.configured_unverified,
      {
        detail: resolved
          ? resolutionDetail(resolvedItem)
          : "ToolCatalog 已声明；员工工具解析结果未提供",
        authorization: resolvedItem?.authorization,
        provider: resolvedItem?.provider,
        code: resolvedItem?.code,
      }
    );

    // A resolved sessionCatalog is the frozen availability snapshot. Never re-run provider
    // heuristics here and create a second truth that can disagree with preflight/session.ready.
    if (!resolved && definition.id === "web.search") {
      state = applyHealth(state, searchHealth(env));
    } else if (!resolved && definition.id === "browser.render") {
      state = applyHealth(state, renderHealth(env, opts));
    }
    return state;
  });
}

const SHORT_NAMES = Object.freeze({
  "web.search": "search",
  "web.fetch": "fetch",
  "web.fetch_extract": "fetch+extract",
  "browser.render": "render",
  "source.verify": "verify",
  "evidence.create": "evidence",
  "artifact.report": "artifact",
  "files.read": "files",
  "repo.diff.read": "diff",
  "repo.search": "repo-search",
  "repo.status.read": "status",
  "shell.run": "shell",
});

const SYMBOLS = Object.freeze({
  [STATUS.available]: "✓",
  [STATUS.missing_key]: "✗",
  [STATUS.unavailable]: "✗",
  [STATUS.degraded]: "!",
  [STATUS.rate_limited]: "!",
  [STATUS.permission_required]: "?",
  [STATUS.configured_unverified]: "?",
  [STATUS.disabled]: "–",
});

export function toolTruthLine(states = getToolTruth()) {
  return states
    .map(state => {
      const label = SHORT_NAMES[state.capability] || state.capability;
      return `${label} ${SYMBOLS[state.status] || "!"}`;
    })
    .join(" · ");
}
