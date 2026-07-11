import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  agentBadge,
  agentLabel,
  c,
  statusBar,
  theme,
  turnSeparator,
  userLabel,
  visibleLen,
} from "../ui.mjs";
import {
  contentWidth,
  wrapText,
  indent,
  prefixLines,
  reindent,
} from "../ui-layout.mjs";
import { toolLine } from "../ui-tools.mjs";
import { toNativePath, toPosixPath, detectFilePaths } from "../tools-files.mjs";
import { runCommand } from "../commands.mjs";

const sample = {
  name: "代码审查虾",
  title: "Code Review Expert",
  model: "anthropic/claude-opus-4.8",
  skillCount: 3,
};

const badge = agentBadge(sample, { color: true });
console.log(badge);
assert.match(badge, /代码审查虾/);
assert.match(badge, /Code Review Expert/);
assert.match(badge, /anthropic\/claude-opus-4\.8 · 3 skills/);
assert.match(badge, /Enter 发送 · \/exit 退出 · \/reset 清空/);
assert.match(badge, /\x1b\[35m/);
assert.doesNotMatch(badge, /┐|┤|┘/);

const status = statusBar({ model: sample.model, step: 2 }, { color: true });
console.log(status);
assert.match(status, /step 2/);
assert.match(status, /bash\/search/);

const plainBadge = agentBadge(sample, { color: false });
const plainStatus = statusBar(
  { model: sample.model, step: 2 },
  { color: false }
);
const plainLabels = `${userLabel({ color: false })}${agentLabel(sample.name, { color: false })}`;
console.log(plainBadge);
console.log(plainStatus);
console.log(turnSeparator({ color: false }));
assert.doesNotMatch(`${plainBadge}\n${plainStatus}\n${plainLabels}`, /\x1b\[/);
assert.equal(userLabel({ color: false }), "you › ");
assert.equal(agentLabel("CrewClaw", { color: false }), "CrewClaw › ");
assert.equal(c.accent("x", false), "x");
assert.equal(c.info("x", false), "x");
assert.equal(c.dim("x", false), "x");
assert.equal(c.ok("x", false), "x");
assert.equal(c.warn("x", false), "x");
assert.equal(c.err("x", false), "x");
assert.equal(c.muted("x", false), "x");
assert.equal(theme.accent, "\x1b[35m");
assert.equal(visibleLen("\x1b[35m你a🔧\x1b[0m"), 5);

// --- ui-layout: word-wrap / indent / responsive width ---
assert.deepEqual(wrapText("aaa bbb ccc", 7), ["aaa bbb", "ccc"]);
assert.deepEqual(wrapText("", 10), [""]);
assert.deepEqual(wrapText("   ", 10), [""]);
// CJK has no spaces → hard-break by display width; every line fits.
for (const ln of wrapText("你好世界你好世界", 6)) {
  assert.ok(
    visibleLen(ln) <= 6,
    `CJK wrap overruns (${visibleLen(ln)}): ${ln}`
  );
}
// long unbroken token splits into equal display-width chunks
assert.equal(wrapText("x".repeat(50), 10).length, 5);
for (const ln of wrapText("x".repeat(50), 10)) assert.equal(visibleLen(ln), 10);
// mixed CJK + latin still respects the width budget
for (const ln of wrapText(
  "混合 mixed 文本 text 很长很长很长很长很长很长很长很长 end",
  12
)) {
  assert.ok(visibleLen(ln) <= 12, `mixed wrap overruns: ${visibleLen(ln)}`);
}
assert.equal(indent(["a", "b"], ">> ", "   "), ">> a\n   b");
assert.deepEqual(prefixLines(["a", "b"], "P"), ["Pa", "Pb"]);
assert.equal(reindent("x\ny", "--"), "--x\n--y");
const cw = contentWidth();
assert.ok(cw >= 40 && cw <= 100, `contentWidth out of clamp range: ${cw}`);
console.log("ui-layout assertions passed");

// --- ui-tools: compact one-line tool activity ---
assert.equal(
  toolLine(
    { name: "search", args: { query: "name" }, output: "a.json:2: name" },
    { color: false }
  ),
  '⌕ "name" (1 处匹配)'
);
assert.equal(
  toolLine(
    { name: "read_file", args: { path: "README.md" }, output: "l1\nl2\nl3" },
    { color: false }
  ),
  "→ README.md (3 行)"
);
assert.equal(
  toolLine(
    { name: "bash", command: "ls -la", output: "a\nb" },
    { color: false }
  ),
  "$ ls -la (2 行)"
);
assert.match(
  toolLine(
    { name: "bash", command: "rm x", confirmed: false },
    { color: false }
  ),
  /\(已跳过\)$/
);
assert.equal(
  toolLine(
    { name: "write_file", args: { path: "x.txt" }, output: "✓ 已写入 x.txt" },
    { color: false }
  ),
  "✚ x.txt (已写入)"
);
const _tl = toolLine(
  { name: "search", args: { query: "q" }, output: "f:1: q" },
  { color: false }
);
assert.doesNotMatch(_tl, /\x1b\[/); // no ANSI when color off
assert.doesNotMatch(_tl, /\n/); // single physical line
assert.match(
  toolLine(
    { name: "search", args: { query: "q" }, output: "f:1: q" },
    { color: true }
  ),
  /\x1b\[/
);
console.log("ui-tools toolLine assertions passed");

// --- tools-files: cross-platform path conversion (the Git-Bash C:\ <-> /c/ fix) ---
assert.equal(toNativePath("/c/Users/x"), "C:\\Users\\x");
assert.equal(toNativePath("/mnt/d/a/b"), "D:\\a\\b");
assert.equal(toNativePath("C:/Users/x"), "C:\\Users\\x");
assert.equal(toNativePath("/usr/local/bin"), "/usr/local/bin"); // pure-posix path untouched
assert.equal(toPosixPath("C:\\Users\\x"), "/c/Users/x");
assert.equal(toPosixPath("D:\\a\\b"), "/d/a/b");
console.log("tools-files path assertions passed");

// --- tools-files: paste-path auto-detection (OI find_image_path generalized) ---
const selfPath = fileURLToPath(import.meta.url); // a real existing .mjs absolute path
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const detected = detectFilePaths(`看看这个文件 ${selfPath} 行不行`, {
  root: workspaceRoot,
});
assert.ok(
  detected.includes(selfPath) || detected.some(p => p.endsWith("ui-smoke.mjs")),
  `detectFilePaths should find the existing path, got: ${JSON.stringify(detected)}`
);
assert.deepEqual(
  detectFilePaths("没有路径，只有 /nope/nonexistent_xyz.md 这种不存在的", {
    root: workspaceRoot,
  }),
  []
);
assert.deepEqual(
  detectFilePaths("纯文本，没有任何文件路径", { root: workspaceRoot }),
  []
);
console.log("tools-files detect assertions passed");

// --- commands: /topbar toggle parsing ---
assert.deepEqual(runCommand("/topbar on", { color: false }).action, {
  type: "topbar",
  value: "on",
});
assert.deepEqual(runCommand("/topbar off", { color: false }).action, {
  type: "topbar",
  value: "off",
});
assert.deepEqual(runCommand("/topbar", { color: false }).action, {
  type: "topbar",
  value: "toggle",
});
assert.equal(runCommand("/exit", { color: false }).action.type, "exit");
console.log("commands /topbar assertions passed");
