export const PERMISSION_LEVELS = {
  L0: "public_read",
  L1: "workspace_read",
  L2: "workspace_write",
  L3: "external_effect",
  L4: "dangerous"
};

const DEFAULT_POLICY = {
  L0: "allow",
  L1: "allow",
  L2: "confirm",
  L3: "confirm",
  L4: "deny"
};

const STATIC_CLASSIFICATIONS = {
  web_search: { level: "L0", scope: "public_web", action: "read" },
  web_fetch: { level: "L0", scope: "public_web", action: "read" },
  read_file: { level: "L1", scope: "workspace", action: "read" },
  list_files: { level: "L1", scope: "workspace", action: "read" },
  grep_repo: { level: "L1", scope: "workspace", action: "read" },
  search: { level: "L1", scope: "workspace", action: "read" },
  write_file: { level: "L2", scope: "workspace", action: "write" },
  edit_file: { level: "L2", scope: "workspace", action: "write" },
  write_patch: { level: "L2", scope: "workspace", action: "write" },
  apply_patch_with_approval: { level: "L2", scope: "workspace", action: "write" },
  browser_render: { level: "L2", scope: "browser", action: "render" },
  send_email: { level: "L3", scope: "external", action: "send" },
  post_message: { level: "L3", scope: "external", action: "send" },
  write_crm: { level: "L3", scope: "external", action: "send" },
  delete_file: { level: "L4", scope: "dangerous", action: "execute" },
  payment: { level: "L4", scope: "dangerous", action: "execute" },
  read_secret: { level: "L4", scope: "dangerous", action: "execute" },
  exec_remote: { level: "L4", scope: "dangerous", action: "execute" },
  db_write: { level: "L4", scope: "dangerous", action: "execute" }
};

const READ_ONLY_BASH_PREFIXES = [
  "ls",
  "cat",
  "pwd",
  "echo",
  "grep",
  "rg",
  "find",
  "head",
  "tail",
  "wc",
  "which",
  "stat",
  "git status",
  "git log",
  "git diff",
  "node --check"
];

function cloneClassification(value) {
  return {
    level: value.level,
    scope: value.scope,
    action: value.action
  };
}

function isReadOnlyBash(command) {
  const text = String(command ?? "").trim();
  return READ_ONLY_BASH_PREFIXES.some((prefix) => text === prefix || text.startsWith(prefix + " "));
}

export function classify(toolName, args = {}) {
  if (toolName === "bash") {
    if (isReadOnlyBash(args.command)) {
      return { level: "L1", scope: "shell", action: "read" };
    }
    return { level: "L2", scope: "shell", action: "write" };
  }

  const classification = STATIC_CLASSIFICATIONS[toolName];
  if (classification) return cloneClassification(classification);

  return { level: "L4", scope: "unknown", action: "deny" };
}

function reasonFor(decision, classification) {
  if (decision === "allow") {
    if (classification.scope === "public_web") return "公开网页只读，自动允许";
    if (classification.scope === "workspace") return "工作区只读，自动允许";
    if (classification.scope === "shell") return "只读命令，自动允许";
    return "只读操作，自动允许";
  }

  if (decision === "confirm") {
    if (classification.scope === "workspace") return "工作区写入，需要确认";
    if (classification.scope === "shell") return "命令可能修改环境，需要确认";
    if (classification.scope === "external") return "外部发送操作，需要确认";
    return "敏感操作，需要确认";
  }

  if (decision === "deny") {
    if (classification.scope === "unknown") return "未知工具，默认拒绝";
    return "高危操作，默认拒绝";
  }

  return "策略未知，默认拒绝";
}

export function makeGateway(opts = {}) {
  const policy = Object.assign({}, DEFAULT_POLICY, opts.policy || {});
  return {
    check(toolName, args = {}) {
      const classification = classify(toolName, args);
      const decision = policy[classification.level] || "deny";
      return {
        decision,
        level: classification.level,
        scope: classification.scope,
        reason: reasonFor(decision, classification)
      };
    }
  };
}

function truncate(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}

function summarizeInput(args) {
  if (args && Object.prototype.hasOwnProperty.call(args, "command")) {
    return truncate(args.command, 80);
  }
  return truncate(JSON.stringify(args ?? {}), 80);
}

export function auditRecord({ toolName, args, decision, level, startedAt, endedAt, status, output, error }) {
  return {
    tool_name: toolName,
    input_summary: summarizeInput(args),
    permission_level: level,
    decision,
    started_at: startedAt,
    ended_at: endedAt,
    status,
    output_summary: output == null ? "" : truncate(output, 80),
    error_message: error == null ? "" : String(error)
  };
}
