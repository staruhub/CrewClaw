import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  proposeSessionPermissionLease,
  sessionPermissionLeaseKey,
  sessionPermissionLeaseLabel,
  sessionPermissionLeaseMatches,
} from "../permission-leases.mjs";

const root = mkdtempSync(join(tmpdir(), "crewclaw-permission-lease-"));
const confirmation = {
  decision: "confirm",
  scope: "workspace",
  level: "L2",
};

try {
  const lease = proposeSessionPermissionLease({
    tool: "write_file",
    args: { path: "docs/spec/first.md" },
    permission: confirmation,
    root,
  });
  assert.deepEqual(lease, {
    version: 1,
    kind: "session",
    expires: "session_end",
    allowlist: [{ tool: "write_file", pattern: "docs/spec/**" }],
  });
  assert.equal(
    sessionPermissionLeaseMatches(lease, {
      tool: "write_file",
      args: { path: "docs/spec/second.md" },
      permission: confirmation,
      root,
    }),
    true
  );
  assert.equal(
    sessionPermissionLeaseMatches(lease, {
      tool: "edit_file",
      args: { path: "docs/spec/second.md" },
      permission: confirmation,
      root,
    }),
    false,
    "a lease never crosses tool names"
  );
  assert.equal(
    sessionPermissionLeaseMatches(lease, {
      tool: "write_file",
      args: { path: "docs/other.md" },
      permission: confirmation,
      root,
    }),
    false,
    "a lease never expands above its proposed parent directory"
  );
  assert.equal(
    sessionPermissionLeaseKey(lease),
    "write_file\u0000docs/spec/**"
  );
  assert.equal(
    sessionPermissionLeaseLabel(lease),
    "write_file \u00b7 docs/spec/**"
  );

  assert.deepEqual(
    proposeSessionPermissionLease({
      tool: "write_file",
      args: { path: "README.md" },
      permission: confirmation,
      root,
    })?.allowlist,
    [{ tool: "write_file", pattern: "README.md" }],
    "a root-level file produces an exact-file lease, never a workspace-wide wildcard"
  );
  assert.equal(
    proposeSessionPermissionLease({
      tool: "list_files",
      args: { path: "." },
      permission: { ...confirmation, level: "L1" },
      root,
    }),
    null,
    "the workspace root is too broad for a learned lease"
  );
  assert.equal(
    proposeSessionPermissionLease({
      tool: "mcp_call",
      args: { path: "docs/spec/first.md" },
      permission: { decision: "confirm", scope: "external_mcp", level: "L3" },
      root,
    }),
    null,
    "MCP calls remain per-call confirmations"
  );
  assert.equal(
    proposeSessionPermissionLease({
      tool: "write_file",
      args: { path: "../outside.md" },
      permission: confirmation,
      root,
    }),
    null,
    "workspace escape never yields a lease"
  );
  assert.equal(
    proposeSessionPermissionLease({
      tool: "write_file",
      args: { path: "docs/spec/first.md" },
      permission: confirmation,
      root,
      kind: "plan_approval",
    }),
    null,
    "plan approval cannot become a permission lease"
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("permission lease tests passed");
