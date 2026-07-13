import { homedir } from "node:os";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const PERMISSION_LEVELS = {
  L0: "public_read",
  L1: "workspace_read",
  L2: "workspace_write",
  L3: "external_effect",
  L4: "dangerous",
};

function dnsAbortError(reason) {
  const error = new Error(
    typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "public URL resolution aborted"
  );
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function lookupWithAbort(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(dnsAbortError(signal.reason));
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(dnsAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(value);
      },
      error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

function isPrivateIp(raw) {
  const ip = String(raw || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && octets[2] === 0) ||
      (a === 192 && b === 0 && octets[2] === 2) ||
      (a === 192 && b === 88 && octets[2] === 99) ||
      (a === 198 && b === 18) ||
      (a === 198 && b === 19) ||
      (a === 198 && b === 51 && octets[2] === 100) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const value = ip.split("%")[0];
    if (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb") ||
      value.startsWith("fec") ||
      value.startsWith("fed") ||
      value.startsWith("fee") ||
      value.startsWith("fef") ||
      value.startsWith("ff") ||
      value.startsWith("2001:db8") ||
      value.startsWith("64:ff9b:")
    )
      return true;
    if (value.startsWith("::ffff:")) {
      const tail = value.slice("::ffff:".length);
      const octets = tail.includes(".")
        ? tail.split(".").map(Number)
        : (() => {
            const groups = tail
              .split(":")
              .filter(Boolean)
              .map(group => parseInt(group, 16));
            const high = groups.at(-2);
            const low = groups.at(-1);
            return [high >> 8, high & 255, low >> 8, low & 255];
          })();
      if (octets.length === 4 && octets.every(Number.isFinite))
        return isPrivateIp(octets.join("."));
    }
    return false;
  }
  return false;
}

// Network tools are public-web capabilities, not arbitrary URL fetchers. Resolve the hostname
// before allowing it so localhost, RFC1918/link-local ranges, IPv6 ULA, and cloud metadata hosts
// cannot be reached through the same L0 path. Callers must repeat this check for every redirect.
export function isPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    return false;
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return false;
  if (isPrivateIp(host)) return false;
  // Synchronous gateway checks reject literal/private hosts. DNS is async and is rechecked by the
  // executor immediately before fetch, so policy classification remains synchronous.
  return true;
}

export async function resolvePublicHttpTarget(
  rawUrl,
  { lookupFn = lookup, signal } = {}
) {
  if (!isPublicHttpUrl(rawUrl))
    return { ok: false, reason: "invalid_or_private_url" };
  const url = new URL(String(rawUrl || "").trim());
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  const literalFamily = isIP(host);
  if (literalFamily) {
    return {
      ok: true,
      url: url.href,
      hostname: host,
      address: host,
      family: literalFamily,
      addresses: [{ address: host, family: literalFamily }],
    };
  }
  try {
    const resolved = await lookupWithAbort(
      Promise.resolve().then(() =>
        lookupFn(host, { all: true, verbatim: true })
      ),
      signal
    );
    const addresses = (Array.isArray(resolved) ? resolved : [resolved])
      .map(entry => ({
        address: String(entry?.address || ""),
        family: Number(entry?.family) || isIP(entry?.address),
      }))
      .filter(
        entry => entry.address && (entry.family === 4 || entry.family === 6)
      );
    if (
      !addresses.length ||
      addresses.some(
        entry => !isIP(entry.address) || isPrivateIp(entry.address)
      )
    ) {
      return {
        ok: false,
        reason: "private_or_unresolved_address",
        hostname: host,
        addresses,
      };
    }
    const selected = addresses[0];
    return {
      ok: true,
      url: url.href,
      hostname: host,
      address: selected.address,
      family: selected.family,
      addresses,
    };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    return { ok: false, reason: "dns_resolution_failed", hostname: host };
  }
}

export async function isPublicHttpUrlAsync(rawUrl, opts) {
  return (await resolvePublicHttpTarget(rawUrl, opts)).ok;
}

const DEFAULT_POLICY = {
  L0: "allow",
  L1: "allow",
  L2: "confirm",
  L3: "confirm",
  L4: "deny",
};

const STATIC_CLASSIFICATIONS = {
  web_search: { level: "L0", scope: "public_web", action: "read" },
  web_fetch: { level: "L0", scope: "public_web", action: "read" },
  read_file: { level: "L1", scope: "workspace", action: "read" },
  list_files: { level: "L1", scope: "workspace", action: "read" },
  grep_repo: { level: "L1", scope: "workspace", action: "read" },
  search: { level: "L1", scope: "workspace", action: "read" },
  git_diff: { level: "L1", scope: "workspace", action: "read" },
  git_status: { level: "L1", scope: "workspace", action: "read" },
  test_run: { level: "L2", scope: "workspace", action: "execute" },
  write_file: { level: "L2", scope: "workspace", action: "write" },
  edit_file: { level: "L2", scope: "workspace", action: "write" },
  write_patch: { level: "L2", scope: "workspace", action: "write" },
  apply_patch_with_approval: {
    level: "L2",
    scope: "workspace",
    action: "write",
  },
  browser_render: { level: "L2", scope: "browser", action: "render" },
  send_email: { level: "L3", scope: "external", action: "send" },
  post_message: { level: "L3", scope: "external", action: "send" },
  write_crm: { level: "L3", scope: "external", action: "send" },
  delete_file: { level: "L4", scope: "dangerous", action: "execute" },
  payment: { level: "L4", scope: "dangerous", action: "execute" },
  read_secret: { level: "L4", scope: "dangerous", action: "execute" },
  exec_remote: { level: "L4", scope: "dangerous", action: "execute" },
  db_write: { level: "L4", scope: "dangerous", action: "execute" },
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
];

function cloneClassification(value) {
  return {
    level: value.level,
    scope: value.scope,
    action: value.action,
  };
}

function isReadOnlyBash(command) {
  const text = String(command ?? "").trim();
  // v0.18 P0-c：只读前缀不等于只读命令——重定向（写文件）、命令链（; && || 后面可以跟任何写操作）、
  // 命令替换（` $( ）、管道/后台执行和换行都能把 "cat/ls" 变成写路径。带这些构造的一律
  // 按 L2 处理，不给只读白名单。单个 `|` / `&` 与换行必须覆盖，不能只防 `||` / `&&`。
  if (/[><;`|&\r\n]|\$\(/.test(text)) return false;
  // find 自带写入/执行原语；git diff/log 的 --output 也会落盘。前缀白名单必须对这类参数失效。
  if (
    /^find(?:\s|$)/.test(text) &&
    /(?:^|\s)-(?:exec|execdir|ok|okdir|delete|fls|fprint|fprintf)\b/.test(text)
  )
    return false;
  if (
    /^git\s+(?:diff|log)(?:\s|$)/.test(text) &&
    /(?:^|\s)--output(?:=|\s|$)/.test(text)
  )
    return false;
  if (
    /^git\s+(?:diff|log|show)(?:\s|$)/.test(text) &&
    /(?:^|\s)--(?:ext-diff|textconv)\b/.test(text)
  )
    return false;
  if (
    /^rg(?:\s|$)/.test(text) &&
    /(?:^|\s)--(?:pre|hostname-bin)(?:=|\s|$)/.test(text)
  )
    return false;
  // GNU grep and ripgrep accept an attached short-option value (`-f/path`). The generic token
  // scanner intentionally ignores option-shaped tokens, so this form would otherwise read a
  // pattern file outside the workspace while retaining L1 auto-allow.
  if (/^(?:grep|rg)(?:\s|$)/.test(text) && /(?:^|\s)-[A-Za-z]*f\S+/.test(text))
    return false;
  return READ_ONLY_BASH_PREFIXES.some(
    prefix => text === prefix || text.startsWith(prefix + " ")
  );
}

function isDangerousBash(command) {
  const text = String(command ?? "").trim();
  // Structured delete_file is L4; spelling the same operation through bash must never downgrade it
  // to an L2 workspace write. Include common Unix, PowerShell, cmd, and git destructive forms.
  return (
    /(?:^|[;&|\r\n]\s*)(?:rm|rmdir|del|erase|remove-item|rd)\b/i.test(text) ||
    /(?:^|[;&|\r\n]\s*)git\s+(?:clean\b|reset\s+--hard\b)/i.test(text) ||
    /(?:^|[;&|\r\n]\s*)(?:format|mkfs(?:\.\w+)?|diskpart|shutdown|reboot|poweroff)\b/i.test(
      text
    ) ||
    (/^find(?:\s|$)/.test(text) &&
      /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)\b/.test(text))
  );
}

// Resolve through the nearest existing ancestor before comparing. A lexical `root/link/file`
// check is insufficient when `link` is a symlink/junction to a directory outside the workspace.
// For a not-yet-created write target, canonicalize its existing parent and append the missing tail.
function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function canonicalPath(rawPath, depth = 0) {
  let cursor = resolve(rawPath);
  const missing = [];
  while (!pathEntryExists(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  let real = cursor;
  if (pathEntryExists(cursor)) {
    try {
      real = realpathSync.native
        ? realpathSync.native(cursor)
        : realpathSync(cursor);
    } catch (error) {
      // realpath fails for a dangling symlink. Resolve its declared target anyway so a write cannot
      // create a file outside root through an as-yet-unresolved link.
      let stat;
      try {
        stat = lstatSync(cursor);
      } catch (statError) {
        if (statError?.code === "ENOENT") {
          const parent = dirname(cursor);
          if (parent !== cursor) {
            return resolve(
              canonicalPath(parent, depth),
              basename(cursor),
              ...missing
            );
          }
        }
        throw error;
      }
      if (stat.isSymbolicLink() && depth < 32) {
        const target = readlinkSync(cursor);
        real = canonicalPath(
          isAbsolute(target) ? target : resolve(dirname(cursor), target),
          depth + 1
        );
      }
    }
  }
  return resolve(real, ...missing);
}

function isOutsideRoot(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

function hasSymlinkComponent(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath);
  if (!rel) return false;
  let cursor = rootPath;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return false;
}

// Resolve a filesystem capability against one explicit workspace root. The returned path is the
// canonical path callers must actually open; using the raw relative path after this check would
// reintroduce a process.cwd() split. `rejectSymlinks` is intended for execution-time validation.
export function resolvePathInsideRoot(
  rawPath,
  root,
  { mustExist = false, rejectSymlinks = false } = {}
) {
  if (typeof root !== "string" || !root.trim())
    return { ok: false, error: "workspace root is required" };
  if (typeof rawPath !== "string" || !rawPath.trim())
    return { ok: false, error: "path must be a non-empty string" };

  let rootPath;
  try {
    rootPath = realpathSync.native
      ? realpathSync.native(resolve(root))
      : realpathSync(resolve(root));
    if (!lstatSync(rootPath).isDirectory())
      return { ok: false, error: "workspace root is not a directory" };
  } catch {
    return { ok: false, error: "workspace root does not exist" };
  }

  let p = String(rawPath)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\"))
    p = homedir() + p.slice(1);
  const lexicalPath = resolve(rootPath, p);
  if (isAbsolute(p) && resolve(p) !== lexicalPath)
    return { ok: false, error: "path is outside workspace" };
  if (isOutsideRoot(rootPath, lexicalPath))
    return { ok: false, error: "path is outside workspace" };
  if (rejectSymlinks && hasSymlinkComponent(rootPath, lexicalPath)) {
    return {
      ok: false,
      error: "symbolic links are not allowed in workspace file operations",
    };
  }

  let targetPath = canonicalPath(lexicalPath);
  if (isOutsideRoot(rootPath, targetPath)) {
    // On Windows, realpath of a lock file deleted by another process can briefly return an NTFS
    // tombstone under C:\$Extend\$Deleted. Re-check the lexical entry: only treat it as a normal
    // missing-file race when lstat confirms ENOENT; a still-existing symlink/junction stays denied.
    try {
      lstatSync(lexicalPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        targetPath = resolve(
          canonicalPath(dirname(lexicalPath)),
          basename(lexicalPath)
        );
      }
    }
    if (isOutsideRoot(rootPath, targetPath))
      return {
        ok: false,
        error: `path resolves outside workspace (${targetPath})`,
      };
  }
  const exists = pathEntryExists(targetPath);
  if (mustExist && !exists)
    return { ok: false, error: `file not found: ${rawPath}` };
  return { ok: true, rootPath, path: targetPath, lexicalPath, exists };
}

// Workspace permission is a capability boundary, not a label. Compare canonical paths so `..`,
// absolute paths, `~`, and symlink/junction escapes all fail containment.
export function isPathInsideRoot(rawPath, root) {
  let p = String(rawPath ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!p) return true; // 无路径参数的调用不由本检查裁决
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\"))
    p = homedir() + p.slice(1);
  const rootPath = canonicalPath(root);
  const targetPath = canonicalPath(isAbsolute(p) ? p : resolve(rootPath, p));
  return !isOutsideRoot(rootPath, targetPath);
}

function shellReadStaysInsideRoot(command, root) {
  // This is deliberately conservative, not a shell parser. Auto-allow only when every explicit
  // path is workspace-contained. Anything ambiguous falls back to confirmation via classify().
  const text = String(command ?? "");
  // Variable/command expansion and nested shell interpreters make the eventual path unknowable at
  // policy time. They need a dedicated scoped tool rather than approval of an opaque shell string.
  if (/`|\$(?:\(|\{|[A-Za-z_])|%[A-Za-z_][A-Za-z0-9_]*%/.test(text))
    return false;
  if (
    /^\s*(?:ba|z|fi)?sh\s+-c\b|^\s*(?:cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-(?:command|encodedcommand))\b/i.test(
      text
    )
  ) {
    return false;
  }

  const tokens = (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).slice(1);
  for (const rawToken of tokens) {
    let token = rawToken.replace(/^["']|["']$/g, "");
    if (token.includes("="))
      token = token.slice(token.indexOf("=") + 1).replace(/^["']|["']$/g, "");
    token = token.replace(/^[()]+|[,:;|&()]+$/g, "");
    if (!token || token.startsWith("-")) continue;
    if (token.includes("{") || token.includes("}")) return false;
    if (
      token.startsWith("~") &&
      token !== "~" &&
      !token.startsWith("~/") &&
      !token.startsWith("~\\")
    ) {
      return false;
    }
    const explicitPath =
      isAbsolute(token) ||
      token.startsWith("~") ||
      token === ".." ||
      token.startsWith("../") ||
      token.startsWith("..\\");
    const candidate = isAbsolute(token) ? token : resolve(root, token);
    // Explicit paths are always checked; existing relative operands are checked as well so an
    // in-root symlink/junction cannot smuggle a read to its external target.
    const pathLike =
      explicitPath ||
      token.includes("/") ||
      token.includes("\\") ||
      pathEntryExists(candidate);
    if (pathLike && !isPathInsideRoot(token, root)) return false;
  }
  return true;
}

function pathArgOf(args) {
  if (!args || typeof args !== "object") return undefined;
  return args.path ?? args.file ?? args.dir ?? args.target;
}

export function classify(toolName, args = {}) {
  if (toolName === "bash") {
    if (isDangerousBash(args.command)) {
      return { level: "L4", scope: "dangerous", action: "execute" };
    }
    if (isReadOnlyBash(args.command)) {
      return { level: "L1", scope: "shell", action: "read" };
    }
    // Raw shell is not a workspace-write capability: arbitrary scripts can escape lexical path
    // checks through interpreters, env vars, and filesystem APIs. Use structured write/edit tools
    // for L2 mutations; an opaque shell command is fail-closed as L4.
    return { level: "L4", scope: "dangerous", action: "execute" };
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

function employeePolicyEntry(employeePolicy, toolName) {
  if (!employeePolicy || typeof employeePolicy !== "object") return null;
  const tools = employeePolicy.tools;
  if (!tools || typeof tools !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(tools, toolName)
    ? tools[toolName]
    : undefined;
}

// `web_fetch` has two capability aliases on one model function.  Keep the
// classification and execution normalization in one exported helper: a blank
// string is a normal fetch, a non-empty string is extraction, and any other
// type is invalid rather than silently falling back to the lower capability.
export function resolveWebFetchCapability(args) {
  const value = args && typeof args === "object" ? args : {};
  if (!Object.prototype.hasOwnProperty.call(value, "extract")) {
    return { capability: "web.fetch", args: value };
  }
  if (typeof value.extract !== "string") {
    return {
      capability: null,
      args: value,
      error: "web_fetch.extract 必须是字符串",
    };
  }
  const extract = value.extract.trim();
  return {
    capability: extract ? "web.fetch_extract" : "web.fetch",
    args: { ...value, extract },
  };
}

function applyEmployeePolicy({
  employeePolicy,
  toolName,
  args,
  classification,
  platformDecision,
  platformReason,
}) {
  if (!employeePolicy || typeof employeePolicy !== "object") {
    return {
      decision: platformDecision,
      reason: platformReason,
      decisionSource: "platform_policy",
    };
  }

  const entry = employeePolicyEntry(employeePolicy, toolName);
  if (entry === undefined) {
    return {
      decision: "deny",
      reason: "该员工未声明此工具能力，已按最小权限拒绝",
      decisionSource: "employee_policy",
    };
  }
  if (!entry || typeof entry !== "object") {
    return {
      decision: "deny",
      reason: "员工工具策略无效，已安全拒绝",
      decisionSource: "employee_policy",
    };
  }

  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.filter(value => typeof value === "string" && value)
    : typeof entry.capability === "string"
      ? [entry.capability]
      : [];
  const webFetchResolution =
    toolName === "web_fetch" ? resolveWebFetchCapability(args) : null;
  if (webFetchResolution?.error) {
    return {
      decision: "deny",
      reason: webFetchResolution.error,
      decisionSource: "tool_arguments",
      capabilities,
      employeePermission: entry.permission,
    };
  }
  const argumentSelectedCapability = webFetchResolution?.capability;
  if (
    argumentSelectedCapability &&
    !capabilities.includes(argumentSelectedCapability)
  ) {
    return {
      decision: "deny",
      reason: `调用参数选择了 ${argumentSelectedCapability}，但员工只声明了 ${capabilities.join(", ") || "无对应能力"}`,
      decisionSource: "employee_policy",
      capabilities,
      employeePermission: entry.permission,
    };
  }
  const capability = argumentSelectedCapability
    ? argumentSelectedCapability
    : typeof entry.capability === "string"
      ? entry.capability
      : capabilities.length === 1
        ? capabilities[0]
        : undefined;
  const employeeContext = {
    ...(capability ? { capability } : {}),
    ...(capabilities.length ? { capabilities } : {}),
  };
  const necessity = entry.necessity;
  const permission = entry.permission;
  if (necessity === "disabled" || permission === "disabled") {
    return {
      decision: "deny",
      reason: `员工策略明确禁用${capability ? ` ${capability}` : "此能力"}`,
      decisionSource: "employee_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }
  if (
    (necessity === "non_default" || necessity === "conditional") &&
    entry.granted !== true
  ) {
    return {
      decision: "deny",
      reason: `${capability || toolName} 是按需能力，当前任务尚未授权`,
      decisionSource: "workspace_grant",
      ...employeeContext,
      employeePermission: permission,
    };
  }
  if (platformDecision === "deny") {
    return {
      decision: "deny",
      reason: platformReason,
      decisionSource: "platform_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }
  if (necessity === "non_default") {
    return {
      decision: "confirm",
      reason: `${capability || toolName} 是显式启用能力，仍需要本次人工授权`,
      decisionSource: "employee_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }

  const readLike =
    classification.action === "read" || classification.action === "render";
  if (permission === "readonly" && !readLike) {
    return {
      decision: "deny",
      reason: `${capability || toolName} 仅获只读权限，不能执行${classification.action}`,
      decisionSource: "employee_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }
  if (permission === "requires_authorization") {
    return {
      decision: "confirm",
      reason: `${capability || toolName} 需要本次人工授权`,
      decisionSource: "employee_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }
  if (entry.approval === "always") {
    return {
      decision: "confirm",
      reason: `${capability || toolName} 的员工策略要求每次调用人工确认`,
      decisionSource: "employee_policy",
      ...employeeContext,
      employeePermission: permission,
    };
  }

  return {
    decision: platformDecision,
    reason: platformReason,
    decisionSource: "platform_policy",
    ...employeeContext,
    employeePermission: permission,
  };
}

export function makeGateway(opts = {}) {
  const policy = Object.assign({}, DEFAULT_POLICY, opts.policy || {});
  const root = opts.root || process.cwd();
  const employeePolicy = opts.employeePolicy || null;
  return {
    check(toolName, args = {}) {
      let classification = classify(toolName, args);
      let decision = policy[classification.level] || "deny";
      let reason = reasonFor(decision, classification);
      let decisionSource = "platform_policy";
      let capability;
      let capabilities;
      let employeePermission;
      if (
        (toolName === "web_fetch" || toolName === "browser_render") &&
        !isPublicHttpUrl(args.url)
      ) {
        classification = {
          level: "L4",
          scope: "private_network",
          action: "network",
        };
        decision = "deny";
        reason = "URL 不属于可验证的公开网络，已阻止本地/内网/元数据访问";
        decisionSource = "network_scope";
      }
      // All workspace-scoped tools, including writes that already require confirmation, remain
      // confined to root. Human confirmation authorizes the action, not a silent scope expansion.
      if (classification.scope === "workspace") {
        const p = pathArgOf(args);
        if (p !== undefined && !isPathInsideRoot(p, root)) {
          classification = {
            level: "L4",
            scope: "outside_workspace",
            action: "deny",
          };
          decision = "deny";
          reason = "路径在工作区外，超出员工权限范围";
          decisionSource = "workspace_scope";
        }
      }
      // Shell authorization never expands the employee's filesystem capability. This applies to
      // L2 commands too: confirmation can approve an in-workspace mutation, not an outside path,
      // dynamic expansion, or a nested interpreter that hides the eventual target.
      if (
        toolName === "bash" &&
        !shellReadStaysInsideRoot(args.command, root)
      ) {
        classification = {
          level: "L4",
          scope: "outside_workspace",
          action: "deny",
        };
        decision = "deny";
        reason = "命令读取工作区外路径，超出员工权限范围";
        decisionSource = "workspace_scope";
      }
      const employee = applyEmployeePolicy({
        employeePolicy,
        toolName,
        args,
        classification,
        platformDecision: decision,
        platformReason: reason,
      });
      decision = employee.decision;
      reason = employee.reason;
      decisionSource =
        decisionSource === "platform_policy"
          ? employee.decisionSource
          : decisionSource;
      capability = employee.capability;
      capabilities = employee.capabilities;
      employeePermission = employee.employeePermission;
      const policyEntry = employeePolicyEntry(employeePolicy, toolName);
      const limits =
        policyEntry?.limits && typeof policyEntry.limits === "object"
          ? policyEntry.limits
          : null;
      return {
        decision,
        level: classification.level,
        scope: classification.scope,
        reason,
        decision_source: decisionSource,
        ...(capability ? { capability } : {}),
        ...(capabilities?.length ? { capabilities } : {}),
        ...(employeePermission
          ? { employee_permission: employeePermission }
          : {}),
        ...(limits ? { limits: { ...limits } } : {}),
        ...(policyEntry?.on_unavailable
          ? { on_unavailable: policyEntry.on_unavailable }
          : {}),
      };
    },
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

export function auditRecord({
  toolName,
  capability,
  capabilities,
  args,
  decision,
  decisionSource,
  level,
  startedAt,
  endedAt,
  status,
  output,
  error,
}) {
  return {
    tool_name: toolName,
    ...(capability ? { capability } : {}),
    ...(Array.isArray(capabilities) && capabilities.length
      ? { capabilities }
      : {}),
    input_summary: summarizeInput(args),
    permission_level: level,
    decision,
    ...(decisionSource ? { decision_source: decisionSource } : {}),
    started_at: startedAt,
    ended_at: endedAt,
    status,
    output_summary: output == null ? "" : truncate(output, 80),
    error_message: error == null ? "" : String(error),
  };
}
