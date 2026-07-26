import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { isPathInsideRoot } from "./tool-gateway.mjs";

const SESSION_LEASE_TOOLS = new Set([
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
]);

function normalizedRelativePath(root, rawPath) {
  const value = String(rawPath ?? "").trim();
  if (!value || /[*?\[\]]/.test(value) || !isPathInsideRoot(value, root)) {
    return null;
  }
  const rootPath = resolve(root);
  const targetPath = resolve(rootPath, value);
  const result = relative(rootPath, targetPath).split(sep).join("/");
  if (
    !result ||
    result === "." ||
    result.startsWith("../") ||
    isAbsolute(result)
  ) {
    return null;
  }
  return result;
}

function leaseEntry(lease) {
  const entries = Array.isArray(lease?.allowlist) ? lease.allowlist : [];
  if (entries.length !== 1) return null;
  const entry = entries[0];
  if (
    !SESSION_LEASE_TOOLS.has(entry?.tool) ||
    typeof entry?.pattern !== "string" ||
    !entry.pattern.trim()
  ) {
    return null;
  }
  return { tool: entry.tool, pattern: entry.pattern.trim() };
}

function comparable(value) {
  const text = String(value || "");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

function pathMatchesPattern(path, pattern) {
  const candidate = comparable(path);
  const expected = comparable(pattern);
  if (!expected.endsWith("/**")) return candidate === expected;
  const prefix = expected.slice(0, -3).replace(/\/$/, "");
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

export function proposeSessionPermissionLease({
  tool,
  args,
  permission,
  root,
  kind = "tool_authorization",
} = {}) {
  if (
    kind !== "tool_authorization" ||
    !SESSION_LEASE_TOOLS.has(tool) ||
    permission?.decision !== "confirm" ||
    permission?.scope !== "workspace" ||
    !new Set(["L1", "L2"]).has(permission?.level)
  ) {
    return null;
  }
  const path = normalizedRelativePath(root, args?.path);
  if (!path) return null;
  const parent = dirname(path).split(sep).join("/");
  const pattern =
    tool === "list_files"
      ? `${path.replace(/\/$/, "")}/**`
      : parent === "."
        ? path
        : `${parent.replace(/\/$/, "")}/**`;
  return {
    version: 1,
    kind: "session",
    expires: "session_end",
    allowlist: [{ tool, pattern }],
  };
}

export function sessionPermissionLeaseKey(lease) {
  const entry = leaseEntry(lease);
  return entry ? `${entry.tool}\u0000${entry.pattern}` : null;
}

export function sessionPermissionLeaseMatches(
  lease,
  { tool, args, permission, root, kind = "tool_authorization" } = {}
) {
  const entry = leaseEntry(lease);
  if (!entry || entry.tool !== tool) return false;
  const proposal = proposeSessionPermissionLease({
    tool,
    args,
    permission,
    root,
    kind,
  });
  if (!proposal) return false;
  const path = normalizedRelativePath(root, args?.path);
  return !!path && pathMatchesPattern(path, entry.pattern);
}

export function sessionPermissionLeaseLabel(lease) {
  const entry = leaseEntry(lease);
  return entry ? `${entry.tool} \u00b7 ${entry.pattern}` : null;
}
