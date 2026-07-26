import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import {
  auditRecord,
  classify,
  isPathInsideRoot,
  isPublicHttpUrl,
  makeGateway,
  readonlyPermissionAllows,
  resolvePathInsideRoot,
  resolvePublicHttpTarget,
} from "../tool-gateway.mjs";

assert.equal(classify("web_search").level, "L0");
assert.equal(classify("bash", { command: "ls -la" }).level, "L1");
assert.equal(classify("bash", { command: "rm -rf foo" }).level, "L4");
assert.equal(classify("write_file", { path: "x" }).level, "L2");
assert.equal(classify("delete_file").level, "L4");
assert.equal(classify("totally_unknown_tool").level, "L4");
assert.equal(
  readonlyPermissionAllows("todo_write", { action: "coordinate" }),
  true
);
assert.equal(
  readonlyPermissionAllows("ask_user", { action: "coordinate" }),
  true
);
assert.equal(
  readonlyPermissionAllows("future_delegate", { action: "coordinate" }),
  false,
  "a future coordinate tool is not readonly until explicitly reviewed"
);
assert.deepEqual(classify("mcp_call"), {
  level: "L3",
  scope: "external_mcp",
  action: "read",
});
assert.equal(makeGateway().check("web_search").decision, "allow");
assert.equal(makeGateway().check("write_file").decision, "confirm");
assert.equal(makeGateway().check("delete_file").decision, "deny");
const defaultMcp = makeGateway().check("mcp_call", {
  server: "github",
  tool: "get_file_contents",
});
assert.equal(defaultMcp.decision, "confirm");
assert.equal(defaultMcp.decision_source, "platform_policy");
assert.match(defaultMcp.reason, /MCP.*逐次确认/);
assert.equal(
  makeGateway({ policy: { L3: "allow" } }).check("mcp_call", {
    server: "untrusted",
    tool: "claims_to_be_readonly",
  }).decision,
  "confirm",
  "generic autonomy overrides cannot downgrade an untrusted MCP call"
);
assert.equal(isPublicHttpUrl("https://example.com"), true);
assert.equal(
  isPublicHttpUrl("http://192.0.64.1/"),
  true,
  "globally routable 192.0/16 addresses are not blanket-blocked"
);
assert.equal(
  isPublicHttpUrl("http://240.0.0.1/"),
  false,
  "reserved 240/4 is not public web"
);
assert.equal(
  isPublicHttpUrl("http://[fec0::1]/"),
  false,
  "deprecated IPv6 site-local range is blocked"
);
for (const url of [
  "http://127.0.0.1/admin",
  "http://localhost:8080",
  "http://[::1]/",
  "http://169.254.169.254/latest/meta-data/",
  "http://192.168.1.1/",
]) {
  assert.equal(isPublicHttpUrl(url), false, `private URL blocked: ${url}`);
  assert.equal(
    makeGateway().check("web_fetch", { url }).decision,
    "deny",
    `gateway blocks ${url}`
  );
  assert.equal(
    makeGateway().check("browser_render", { url }).decision,
    "deny",
    `renderer blocks ${url}`
  );
}

const pinned = await resolvePublicHttpTarget("https://example.com/path", {
  lookupFn: async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ],
});
assert.equal(pinned.ok, true);
assert.equal(pinned.hostname, "example.com");
assert.equal(pinned.address, "93.184.216.34");
assert.equal(pinned.family, 4);
const rebound = await resolvePublicHttpTarget("https://rebind.example/", {
  lookupFn: async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ],
});
assert.equal(rebound.ok, false, "mixed public/private DNS answers fail closed");

let lateLookupSettled = false;
const lookupAbort = new AbortController();
const lookupStartedAt = Date.now();
const slowLookup = resolvePublicHttpTarget("https://slow.example/", {
  signal: lookupAbort.signal,
  lookupFn: () =>
    new Promise((_resolve, reject) => {
      setTimeout(() => {
        lateLookupSettled = true;
        reject(new Error("late lookup rejection"));
      }, 300);
    }),
});
setTimeout(() => lookupAbort.abort("test_abort"), 30);
await assert.rejects(slowLookup, error => error?.name === "AbortError");
assert.ok(
  Date.now() - lookupStartedAt < 180,
  "browser/fetch DNS preflight must not wait for a slow lookup after abort"
);
await new Promise(resolve => setTimeout(resolve, 330));
assert.equal(
  lateLookupSettled,
  true,
  "the late DNS rejection is consumed after the abort race settles"
);

// ── v0.18 P0-c：workspace 权限是边界不是标签 ────────────────────────────────────────────────
// 只读 bash 白名单：重定向/链式/命令替换即失去只读资格。
assert.equal(
  classify("bash", { command: "cat notes.md > /tmp/out" }).level,
  "L4",
  "redirect is opaque shell"
);
assert.equal(
  classify("bash", { command: "ls && rm -rf /" }).level,
  "L4",
  "delete chain is dangerous"
);
assert.equal(
  classify("bash", { command: "cat `whoami`" }).level,
  "L4",
  "backtick substitution is opaque shell"
);
assert.equal(
  classify("bash", { command: "head $(find / -name id_rsa)" }).level,
  "L4",
  "$() is opaque shell"
);
assert.equal(
  classify("bash", { command: "cat notes.md | tee copy.md" }).level,
  "L4",
  "single pipe is opaque shell"
);
assert.equal(
  classify("bash", { command: "ls & rm -rf cache" }).level,
  "L4",
  "background delete is dangerous"
);
assert.equal(
  classify("bash", { command: "ls\nrm -rf cache" }).level,
  "L4",
  "newline delete is dangerous"
);
assert.equal(
  classify("bash", { command: "find . -exec rm {} +" }).level,
  "L4",
  "find -exec is dangerous"
);
assert.equal(
  classify("bash", { command: "git diff --output=patch.txt" }).level,
  "L4",
  "git --output is opaque shell"
);
assert.equal(
  classify("bash", { command: "git diff --ext-diff" }).level,
  "L4",
  "git external helper is opaque shell"
);
assert.equal(
  classify("bash", { command: "rg --pre=evil.cmd needle ." }).level,
  "L4",
  "rg preprocessor is opaque shell"
);
assert.equal(
  classify("bash", { command: "grep -f/c/Windows/win.ini README.md" }).level,
  "L4",
  "attached grep pattern path is opaque shell"
);
assert.equal(
  classify("bash", { command: "rg -f/c/Windows/win.ini needle ." }).level,
  "L4",
  "attached rg pattern path is opaque shell"
);
assert.equal(
  classify("bash", { command: "grep -n TODO src/main.rs" }).level,
  "L1",
  "plain read stays L1"
);

// 路径 containment 判定本体。
const sandbox = mkdtempSync(join(tmpdir(), "crewclaw-gateway-"));
const root = join(sandbox, "workspace");
const outside = join(sandbox, "outside");
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(root, "inside.txt"), "inside");
writeFileSync(join(outside, "secret.txt"), "secret");
assert.equal(
  isPathInsideRoot("notes/readme.md", root),
  true,
  "relative path stays inside"
);
assert.equal(
  isPathInsideRoot("../outside.txt", root),
  false,
  ".. traversal escapes"
);
assert.equal(
  isPathInsideRoot(`${homedir()}/.ssh/id_rsa`, root),
  false,
  "absolute path outside root escapes"
);
assert.equal(
  isPathInsideRoot("~/.ssh/id_rsa", root),
  false,
  "~ expansion escapes"
);
assert.equal(
  resolvePathInsideRoot("inside.txt", root, {
    mustExist: true,
    rejectSymlinks: true,
  }).ok,
  true
);
assert.equal(
  resolvePathInsideRoot("../outside/secret.txt", root, { mustExist: true }).ok,
  false
);

// Canonical containment: an apparently in-root junction/symlink must not escape after resolution.
const escapeLink = join(root, "escape-link");
symlinkSync(outside, escapeLink, "junction");
assert.equal(
  isPathInsideRoot("escape-link/secret.txt", root),
  false,
  "symlink escape is outside"
);
assert.equal(
  resolvePathInsideRoot("escape-link/secret.txt", root, {
    mustExist: true,
    rejectSymlinks: true,
  }).ok,
  false
);

// 网关裁决：workspace scope 是硬边界。人工确认可授权 L2 动作，但不能静默扩展到 root 外。
const gw = makeGateway({ root });
assert.equal(
  gw.check("read_file", { path: "docs/a.md" }).decision,
  "allow",
  "in-root read auto-allowed"
);
assert.equal(
  gw.check("read_file", { path: join(root, "inside.txt") }).decision,
  "allow",
  "absolute in-root read allowed"
);
const escape = gw.check("read_file", { path: "~/.ssh/id_rsa" });
assert.equal(escape.decision, "deny", "out-of-root read is denied");
assert.equal(escape.level, "L4", "scope escape is classified fail-closed");
assert.match(escape.reason, /工作区外/);
assert.equal(
  gw.check("read_file", { path: "../secret.txt" }).decision,
  "deny",
  ".. traversal is denied"
);
assert.equal(
  gw.check("write_file", { path: "docs/a.md" }).decision,
  "confirm",
  "writes keep needing confirmation"
);
assert.equal(
  gw.check("write_file", { path: "../outside/new.txt" }).decision,
  "deny",
  "confirmed writes stay in workspace"
);
assert.equal(
  gw.check("read_file", { path: "escape-link/secret.txt" }).decision,
  "deny",
  "symlink read is denied"
);

// Shell L1 inherits the same containment instead of treating a read-only verb as global read access.
assert.equal(
  gw.check("bash", { command: "cat inside.txt" }).decision,
  "allow",
  "in-root shell read allowed"
);
assert.equal(
  gw.check("bash", { command: `cat ${join(root, "inside.txt")}` }).decision,
  "allow",
  "absolute in-root shell read allowed"
);
assert.equal(
  gw.check("bash", { command: `cat ${join(outside, "secret.txt")}` }).decision,
  "deny",
  "absolute outside read denied"
);
assert.equal(
  gw.check("bash", { command: "cat ../outside/secret.txt" }).decision,
  "deny",
  "relative traversal denied"
);
assert.equal(
  gw.check("bash", { command: "cat ../outside/*" }).decision,
  "deny",
  "outside glob denied"
);
assert.equal(
  gw.check("bash", { command: `cat ${join(outside, "{secret,other}.txt")}` })
    .decision,
  "deny",
  "outside brace expansion denied"
);
assert.equal(
  gw.check("bash", { command: "cat ~root/.ssh/id_rsa" }).decision,
  "deny",
  "named-home expansion denied"
);
assert.equal(
  gw.check("bash", { command: "cat escape-link/secret.txt" }).decision,
  "deny",
  "shell symlink escape denied"
);
assert.equal(
  gw.check("bash", { command: "rm -f escape-link/new.txt" }).decision,
  "deny",
  "L2 write through symlink denied"
);
assert.equal(
  gw.check("bash", { command: "git -C ../outside status" }).decision,
  "deny",
  "L2 command cannot expand scope"
);
assert.equal(
  gw.check("bash", { command: "cat $HOME/.ssh/id_rsa" }).decision,
  "deny",
  "dynamic home expansion denied"
);
assert.equal(
  gw.check("bash", { command: 'bash -c "cat /etc/passwd"' }).decision,
  "deny",
  "nested shell denied"
);
assert.equal(
  gw.check("bash", { command: "rm -rf cache" }).decision,
  "deny",
  "bash cannot downgrade L4 delete_file"
);
assert.equal(
  gw.check("bash", { command: "touch cache/new.txt" }).decision,
  "deny",
  "opaque shell remains denied"
);

// Integration guard: the executor must receive and enforce the gateway decision; a second
// runTool-local read-only classifier would reintroduce the false-green bypass this suite protects.
const runSource = readFileSync(new URL("../run.mjs", import.meta.url), "utf8");
assert.match(
  runSource,
  /runToolWithDeadline\(\s*toolSignal\s*=>\s*runToolFn\(\s*toolName,\s*args,\s*\{[\s\S]{0,900}?permission:\s*decision,[\s\S]{0,900}?root,[\s\S]{0,900}?signal:\s*toolSignal,[\s\S]{0,900}?taskRunId,[\s\S]{0,900}?onArtifactCreated,[\s\S]{0,900}?\}\s*\),\s*\{[\s\S]{0,900}?signal,[\s\S]{0,900}?timeoutMs[\s\S]{0,240}?\}\s*\)/,
  "gateway decision, workspace root, cancellation, task correlation, and artifact callback must reach the executor"
);
assert.doesNotMatch(runSource, /function isReadOnly\(/);
assert.equal(
  auditRecord({
    toolName: "bash",
    args: { command: "ls" },
    decision: "allow",
    level: "L1",
    startedAt: 1,
    endedAt: 2,
    status: "success",
  }).tool_name,
  "bash"
);

rmSync(sandbox, { recursive: true, force: true });
