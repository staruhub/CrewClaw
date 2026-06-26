import { createRequire } from "node:module";
import { pickRenderProvider } from "./render-provider.mjs";
import { pickBackend } from "./tools-web.mjs";

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

export const CAPABILITIES = Object.freeze([
  "utility.weather",
  "web.search",
  "web.extract",
  "browser.render",
  "artifact.write",
  "artifact.reveal",
  "memory.write",
  "shell.run",
  "evidence.create",
  "outcome.grade",
]);

const require = createRequire(import.meta.url);

function moduleInstalled(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function entry(capability, status, fields = {}) {
  const out = { capability, status };
  if (fields.detail) out.detail = fields.detail;
  if (fields.provider) out.provider = fields.provider;
  return out;
}

function webProviderEntry(capability, env) {
  let backend;
  try {
    backend = pickBackend(env);
  } catch (error) {
    return entry(capability, STATUS.degraded, {
      detail: `pickBackend failed: ${error?.message ?? String(error)}`,
    });
  }

  const provider = backend?.name || "unknown";
  if (provider === "ddg") {
    return entry(capability, STATUS.missing_key, {
      provider,
      detail: "DDG fallback has no real API key",
    });
  }

  return entry(capability, STATUS.available, { provider });
}

function renderProviderInput(env, opts) {
  if (opts?.renderProvider) {
    return { ...env, CREW_RENDER_PROVIDER: opts.renderProvider };
  }
  if (opts?.renderEnv) return opts.renderEnv;
  return env;
}

function browserRenderEntry(env, opts) {
  let provider;
  try {
    provider = pickRenderProvider(renderProviderInput(env, opts));
  } catch (error) {
    return entry("browser.render", STATUS.unavailable, {
      detail: `pickRenderProvider failed: ${error?.message ?? String(error)}`,
    });
  }

  const name = String(provider || "").toLowerCase().trim();
  if (!name || name === "none") {
    return entry("browser.render", STATUS.unavailable, {
      detail: "未配置 render provider",
    });
  }

  if (name === "playwright") {
    if (moduleInstalled("playwright")) {
      return entry("browser.render", STATUS.available, { provider: name });
    }
    return entry("browser.render", STATUS.unavailable, {
      provider: name,
      detail: "playwright 未安装",
    });
  }

  if (name === "firecrawl" || name === "browserbase") {
    const keyName = name === "firecrawl" ? "FIRECRAWL_API_KEY" : "BROWSERBASE_API_KEY";
    if (env[keyName]) {
      return entry("browser.render", STATUS.degraded, {
        provider: name,
        detail: `${name} render provider 未实现`,
      });
    }
    return entry("browser.render", STATUS.unavailable, {
      provider: name,
      detail: `缺少 ${keyName}`,
    });
  }

  return entry("browser.render", STATUS.unavailable, {
    provider: name,
    detail: "未知 render provider",
  });
}

const PERSISTENT_MEMORY_ENV = Object.freeze([
  "MEMORY_STORE_URL",
  "CREW_MEMORY_STORE_URL",
  "PERSISTENT_MEMORY_STORE_URL",
]);

function memoryEntries(env) {
  const configuredBy = PERSISTENT_MEMORY_ENV.find((name) => env[name]);
  return [
    entry("memory.write", STATUS.available, {
      provider: "session",
      detail: "session memory",
    }),
    entry("memory.write", configuredBy ? STATUS.available : STATUS.unavailable, {
      provider: "persistent",
      detail: configuredBy
        ? `persistent memory via ${configuredBy}`
        : `persistent memory requires ${PERSISTENT_MEMORY_ENV.join(" or ")}`,
    }),
  ];
}

export function getToolTruth(env = process.env, opts = {}) {
  const states = [];

  for (const capability of CAPABILITIES) {
    if (capability === "utility.weather") {
      states.push(entry(capability, STATUS.unavailable, { detail: "未配 weather provider" }));
    } else if (capability === "web.search" || capability === "web.extract") {
      states.push(webProviderEntry(capability, env));
    } else if (capability === "browser.render") {
      states.push(browserRenderEntry(env, opts));
    } else if (capability === "artifact.write") {
      states.push(entry(capability, STATUS.available, { provider: "local" }));
    } else if (capability === "artifact.reveal") {
      states.push(entry(capability, STATUS.degraded, { detail: "需 OpenWork/OS Adapter" }));
    } else if (capability === "memory.write") {
      states.push(...memoryEntries(env));
    } else if (capability === "shell.run") {
      states.push(
        entry(capability, env.SHELL_ALLOW === "1" ? STATUS.available : STATUS.permission_required, {
          detail: env.SHELL_ALLOW === "1" ? "" : "sandbox/needs approval",
        }),
      );
    } else if (capability === "evidence.create" || capability === "outcome.grade") {
      states.push(entry(capability, STATUS.available, { provider: "local" }));
    }
  }

  return states;
}

const SHORT_NAMES = Object.freeze({
  "utility.weather": "weather",
  "web.search": "search",
  "web.extract": "fetch",
  "browser.render": "render",
  "artifact.write": "artifact",
  "artifact.reveal": "reveal",
  "memory.write": "memory",
  "shell.run": "shell",
  "evidence.create": "evidence",
  "outcome.grade": "grade",
});

const SYMBOLS = Object.freeze({
  [STATUS.available]: "✓",
  [STATUS.missing_key]: "✗",
  [STATUS.unavailable]: "✗",
  [STATUS.degraded]: "!",
  [STATUS.rate_limited]: "!",
  [STATUS.permission_required]: "!",
  [STATUS.configured_unverified]: "!",
  [STATUS.disabled]: "–",
});

function lineLabel(state) {
  const base = SHORT_NAMES[state.capability] || state.capability;
  if (state.capability === "memory.write" && state.provider) return `${base}:${state.provider}`;
  return base;
}

function lineStatus(state) {
  const symbol = SYMBOLS[state.status] || "!";
  return state.status === STATUS.missing_key ? `${symbol}${STATUS.missing_key}` : symbol;
}

export function toolTruthLine(states = getToolTruth()) {
  return states.map((state) => `${lineLabel(state)} ${lineStatus(state)}`).join(" · ");
}
