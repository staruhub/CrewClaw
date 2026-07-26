import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { resolveStatePath, writeJsonAtomic } from "./state-lock.mjs";

export const mcpCallToolSchema = {
  type: "function",
  function: {
    name: "mcp_call",
    description:
      "Call one configured, allowlisted MCP tool after host authorization. Server and tool names come from the MCP index in the system prompt; the full input schema is loaded and checked only when called. Server annotations are not trusted as permission evidence.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        server: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        arguments: { type: "object" },
      },
      required: ["server", "tool", "arguments"],
    },
  },
};

function expandEnv(value, env, missing) {
  return String(value).replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_all, name) => {
    const resolved = String(env?.[name] || "");
    if (!resolved) missing.add(name);
    return resolved;
  });
}

export function parseMcpConfig(text, { env = process.env, profileDir } = {}) {
  if (!text) return { servers: {}, providers: new Set(), indexText: "" };
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  const rawServers = parsed?.mcp_servers;
  if (
    !rawServers ||
    typeof rawServers !== "object" ||
    Array.isArray(rawServers)
  ) {
    throw new Error("mcp.json 缺少 mcp_servers 对象");
  }
  const servers = {};
  const providers = new Set();
  for (const [name, raw] of Object.entries(rawServers)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !raw || typeof raw !== "object") {
      throw new Error(`mcp.json server ${name} 无效`);
    }
    const missing = new Set();
    const command = String(raw.command || "").trim();
    const args = Array.isArray(raw.args)
      ? raw.args.map(value => expandEnv(value, env, missing))
      : [];
    const declaredEnv = {};
    for (const [key, value] of Object.entries(raw.env || {})) {
      declaredEnv[key] = expandEnv(value, env, missing);
    }
    const include = Array.isArray(raw.tools?.include)
      ? [...new Set(raw.tools.include.map(String).filter(Boolean))]
      : [];
    if (!command || include.length === 0) {
      throw new Error(`mcp.json server ${name} 缺少 command 或 tools.include`);
    }
    const ready = missing.size === 0;
    servers[name] = {
      name,
      command,
      args,
      env: declaredEnv,
      include,
      profileDir,
      ready,
      missing_env: [...missing].sort(),
    };
    if (ready) providers.add(`mcp.${name}`);
  }
  const lines = Object.values(servers).map(server =>
    server.ready
      ? `- ${server.name}: ${server.include.join(", ")}`
      : `- ${server.name}: unavailable (missing ${server.missing_env.join(", ")})`
  );
  return {
    servers,
    providers,
    indexText: lines.length
      ? `# MCP Tools (lazy index)\nCall mcp_call({server,tool,arguments}) only for a listed tool. Full schemas are fetched from the live server on demand.\n${lines.join("\n")}`
      : "",
  };
}

export function mcpReadiness(mcp = {}) {
  const servers = Object.values(mcp?.servers || {}).map(server => ({
    name: String(server?.name || "unknown"),
    ready: server?.ready === true,
    missing_env: Array.isArray(server?.missing_env)
      ? [...server.missing_env]
      : [],
  }));
  const readyServers = servers.filter(server => server.ready);
  return {
    ready: readyServers.length > 0,
    status:
      servers.length === 0
        ? "not_configured"
        : readyServers.length > 0
          ? "ready"
          : "blocked",
    providers: readyServers.map(server => `mcp.${server.name}`),
    servers,
  };
}

function jsonRpcError(value) {
  const error = new Error(value?.message || "MCP JSON-RPC error");
  error.code = value?.code;
  return error;
}

async function withMcpSession(
  server,
  operation,
  { signal, timeoutMs = 30000 } = {}
) {
  if (!server?.ready) {
    throw new Error(
      `MCP ${server?.name || "server"} 未配置：缺少 ${(server?.missing_env || []).join(", ")}`
    );
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, {
      cwd: server.profileDir,
      env: { ...process.env, ...server.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let nextId = 0;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const pending = new Map();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const waiter of pending.values())
        waiter.reject(error || new Error("MCP closed"));
      pending.clear();
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const request = (method, params = {}) =>
      new Promise((requestResolve, requestReject) => {
        const id = ++nextId;
        pending.set(id, { resolve: requestResolve, reject: requestReject });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
        );
      });
    const notify = (method, params = {}) => {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
      );
    };
    const consume = line => {
      const text = line.trim();
      if (!text.startsWith("{")) return;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (!Object.hasOwn(message, "id")) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(jsonRpcError(message.error));
      else waiter.resolve(message.result);
    };
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2 * 1024 * 1024) {
        finish(new Error("MCP stdout 超过 2 MiB"));
        return;
      }
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) consume(line);
    });
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString("utf8")).slice(-8192);
    });
    child.on("error", error => finish(error));
    child.on("exit", code => {
      if (!settled) {
        finish(
          new Error(`MCP ${server.name} 提前退出 (${code}): ${stderr.trim()}`)
        );
      }
    });
    const onAbort = () => finish(new Error("MCP 调用已取消"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => finish(new Error(`MCP ${server.name} 调用超时`)),
      timeoutMs
    );
    (async () => {
      try {
        await request("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "crewclaw", version: "0.20.0" },
        });
        notify("notifications/initialized");
        const value = await operation({ request, notify });
        finish(null, value);
      } catch (error) {
        finish(error);
      }
    })();
  });
}

export async function callMcpTool(
  mcp,
  { server: serverName, tool: toolName, arguments: args = {} } = {},
  { signal, root, employeeId, taskRunId } = {}
) {
  const server = mcp?.servers?.[String(serverName || "")];
  if (!server) throw new Error(`未配置 MCP server: ${serverName}`);
  if (!server.include.includes(String(toolName || ""))) {
    throw new Error(`MCP 工具不在 allowlist: ${serverName}.${toolName}`);
  }
  const startedAt = new Date().toISOString();
  let status = "failed";
  try {
    const result = await withMcpSession(
      server,
      async ({ request }) => {
        const listed = await request("tools/list", {});
        const tool = (listed?.tools || []).find(
          item => item?.name === toolName
        );
        if (!tool) throw new Error(`MCP server 未公布工具 ${toolName}`);
        // The full schema has now been loaded from the live provider. The server remains the
        // final validator; keeping it out of the model prompt is the progressive-disclosure win.
        return await request("tools/call", { name: toolName, arguments: args });
      },
      { signal }
    );
    status = result?.isError ? "failed" : "succeeded";
    if (result?.isError) {
      throw new Error(
        (result.content || []).map(item => item?.text || "").join("\n") ||
          "MCP tool returned isError"
      );
    }
    return (result?.content || [])
      .map(item => item?.text || (item ? JSON.stringify(item) : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 50000);
  } finally {
    if (root && employeeId) {
      const path = resolveStatePath(
        join(
          root,
          ".crewclaw",
          "mcp",
          String(employeeId).replace(/[^a-zA-Z0-9_-]/g, "_"),
          `${Date.now()}-${randomUUID()}.json`
        ),
        root
      );
      writeJsonAtomic(
        path,
        {
          contract: "crewclaw.mcp-call/v1",
          employee_id: employeeId,
          task_run_id: taskRunId || null,
          server: serverName,
          tool: toolName,
          status,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        },
        { root }
      );
    }
  }
}
