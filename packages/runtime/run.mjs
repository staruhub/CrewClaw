#!/usr/bin/env node
// Minimal but REAL Hermes-profile runtime.
//
// Loads a hired expert's profile (SOUL.md persona + config.yaml + skills/**/SKILL.md)
// and runs it against an OpenAI-compatible endpoint (ZenMux). Three modes:
//   one-shot   — stream one answer live   (crew run <agent> "<task>")
//   interactive— multi-turn chat REPL     (crew chat <agent>   — no task)
//   --json     — non-streaming JSON line   (crew standup, fan-out in parallel)
//
// Usage: node packages/runtime/run.mjs <agent-id> ["<task>"] [--input <file>] [--json]
//   env: ZENMUX_API_KEY (required), ZENMUX_BASE_URL, HERMES_MODEL  (from .env.local)

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { agentBadge, statusBar, userRailPrompt, visibleLen } from "./ui.mjs";
import { renderMdLine, renderMessage } from "./ui-markdown.mjs";
import { toolLine } from "./ui-tools.mjs";
import { installTopBar, costFor, ctxPercent } from "./ui-topbar.mjs";
import { webSearch, cleanHtml, pickBackend } from "./tools-web.mjs";
import { diffCard } from "./ui-diff.mjs";
import { fsToolSchemas, computeEdit, computeWrite, applyWrite } from "./tools-fs.mjs";
import { readAnyFile, detectFilePaths, isImagePath, readImageDataUrl } from "./tools-files.mjs";
import { saveSession, loadSession } from "./session-store.mjs";
import { isCommand, runCommand } from "./commands.mjs";
import { renderTable, isTableRow } from "./ui-table.mjs";
import { createMdPrinter as makeMdPrinter } from "./ui-stream.mjs";
import { GUTTER, reindent } from "./ui-layout.mjs";
import { makeGateway, auditRecord } from "./tool-gateway.mjs";
import { newTaskRun, transition, addEvent, saveTaskRun } from "./task-state.mjs";
import { newArtifact, saveArtifact } from "./artifact-store.mjs";
import { grade } from "./outcome-grader.mjs";
import { loadMemory, addMemory, summarizeForPrompt } from "./memory-store.mjs";
import { reviewTaskRun } from "./dream.mjs";
import { statusHeader, actionBar } from "./workbench-view.mjs";
import { permissionRequest } from "./permission-copy.mjs";
import { generateQueries, FAILURE_PLAYBOOK } from "./search-harness.mjs";
import { summarizeAction } from "./event-summary.mjs";
import { estimateCost, formatBudget } from "./budget-guard.mjs";
import { renderReport } from "./task-report.mjs";
import { newEvidenceCard, addEvidence, loadEvidence, assembleSources } from "./evidence-store.mjs";
import { isJsShell, routeBySize, extractPrompt } from "./web-extract.mjs";
import { renderPage } from "./render-provider.mjs";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 45000);

async function loadDotEnv() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    // Strip surrounding quotes and a trailing inline comment (B1 hardening).
    let value = m[2].replace(/\s+#.*$/, "").trim();
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// Reject ids that try to escape the profile roots (B2 hardening).
function safeAgentId(agentId) {
  return /^[a-z0-9-]+$/.test(agentId);
}

function resolveProfileDir(agentId) {
  for (const base of ["agents", "experts"]) {
    const dir = join(ROOT, base, agentId);
    if (existsSync(join(dir, "SOUL.md"))) return dir;
  }
  return null;
}

async function collectSkills(profileDir) {
  const skillsRoot = join(profileDir, "skills");
  if (!existsSync(skillsRoot)) return [];
  const found = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let info;
      try {
        info = await stat(full); // profiles are trusted local dirs
      } catch {
        continue;
      }
      if (info.isDirectory()) await walk(full);
      else if (entry === "SKILL.md") found.push(await readFile(full, "utf8"));
    }
  }
  await walk(skillsRoot);
  return found;
}

function buildSystemPrompt(soul, skills) {
  const parts = [soul.trim()];
  if (skills.length) {
    parts.push("\n\n# Installed Skills\n");
    parts.push(
      "You have the following ChaoGeek-certified skills installed. Use the one that fits the task.\n",
    );
    for (const skill of skills) parts.push("\n---\n\n" + skill.trim());
  }
  return parts.join("\n");
}

function parseArgs(argv) {
  const flags = { json: false, input: null, resume: false, task: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--ascii") continue;
    else if (a === "--input") flags.input = argv[++i] ?? null;
    else if (a === "--task") flags.task = argv[++i] ?? null;
    else positional.push(a);
  }
  return { flags, agentId: positional[0], task: positional.slice(1).join(" ").trim() };
}

// callModel now takes a `messages` array (the conversation so far: user/assistant
// turns). The system prompt is prepended here. One-shot callers pass a single
// user message; the chat REPL passes the growing history.
async function callModel({ baseUrl, apiKey, model, temperature, system, messages, tools, stream, onDelta }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // Disable compression + caching so SSE deltas stream live instead of being
        // buffered into one burst by an intermediate proxy (the fix for "no streaming").
        ...(stream
          ? { "Accept-Encoding": "identity", Accept: "text/event-stream", "Cache-Control": "no-cache" }
          : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: !!stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        messages: [{ role: "system", content: system }, ...messages],
        ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }

    if (!stream) {
      const data = await response.json();
      return {
        content: data?.choices?.[0]?.message?.content ?? "",
        usage: data?.usage ?? null,
        toolCalls: data?.choices?.[0]?.message?.tool_calls ?? [],
      };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = null;
    const toolAcc = [];
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.usage) usage = parsed.usage;
          const delta = parsed?.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta?.(delta.content);
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              if (!toolAcc[i]) toolAcc[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tc.id) toolAcc[i].id = tc.id;
              if (tc.function?.name) toolAcc[i].function.name += tc.function.name;
              if (tc.function?.arguments) toolAcc[i].function.arguments += tc.function.arguments;
            }
          }
        } catch {
          // ignore keep-alive / non-JSON lines
        }
      }
    }
    return { content, usage, toolCalls: toolAcc.filter(Boolean) };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`timed out after ${Math.round(TIMEOUT_MS / 1000)}s (network or endpoint stalled)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadProfile(agentId) {
  const profileDir = resolveProfileDir(agentId);
  if (!profileDir) throw new Error(`no runnable profile for "${agentId}" (no SOUL.md in agents/ or experts/).`);
  const soul = await readFile(join(profileDir, "SOUL.md"), "utf8");
  let temperature = 0.3;
  let modelFromConfig = "";
  const configPath = join(profileDir, "config.yaml");
  if (existsSync(configPath)) {
    const cfg = yaml.load(await readFile(configPath, "utf8")) || {};
    if (typeof cfg.temperature === "number") temperature = cfg.temperature;
    if (cfg.model && typeof cfg.model.default === "string") modelFromConfig = cfg.model.default;
  }
  // Prefer the human display name from the manifest (e.g. "AI 落地鲸").
  let displayName = "";
  let title = "";
  let runtime = null;
  const manifestPath = join(profileDir, "hire.yaml");
  if (existsSync(manifestPath)) {
    try {
      const mf = yaml.load(await readFile(manifestPath, "utf8")) || {};
      if (mf?.metadata?.name) displayName = String(mf.metadata.name);
      if (mf?.identity?.title) title = String(mf.identity.title);
      if (mf?.runtime && typeof mf.runtime === "object") runtime = mf.runtime;
    } catch {
      // fall back to titleized id
    }
  }
  const skills = await collectSkills(profileDir);
  return {
    temperature,
    model: modelFromConfig || process.env.HERMES_MODEL || "anthropic/claude-opus-4.8",
    skills,
    displayName,
    title,
    runtime,
    system: buildSystemPrompt(soul, skills),
  };
}

function titleizeId(agentId) {
  return agentId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --- Minimal streaming Markdown → ANSI renderer for the live chat TUI ---

// Buffers streamed text and prints each line rendered once it completes.
// render=false (non-TTY / piped) → pass-through raw so captured output stays clean.
// Delegates to the dependency-injected, unit-tested printer in ui-stream.mjs.
function createMdPrinter(render) {
  return makeMdPrinter(render, { renderMdLine, renderTable, isTableRow, visibleLen, GUTTER });
}

// --- Tools the agent can call (OpenAI function-calling format) ---

const TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command on the user's machine and return its stdout+stderr. Use it to LOOK at real things instead of guessing: list files (ls), read files (cat/head), search (grep/rg), inspect git, run scripts. Prefer read-only commands.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Search file CONTENTS under a directory with ripgrep. Returns matching file:line: text. Use to find where something is defined or mentioned.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex to search for" },
          path: { type: "string", description: "Directory to search (default: current directory)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch a public http(s) URL (GET only) for LIVE info — weather, news, prices, a web page or API. For weather use https://wttr.in/<城市>?format=3 . For a long page, pass `extract` (what you want to find/verify) and you get task-focused facts instead of the whole page. If the page is a JS-rendered shell you get a 'requires_render' notice — don't guess other URLs, use web_search or ask for browser_render.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s):// URL to GET" },
          extract: { type: "string", description: "可选：你要从这页抽取/验证什么（如『Seed 2.1 的价格、上下文、能力』）。正文较长时据此按任务抽要点，省 token。" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_render",
      description:
        "Upgrade channel for JS-rendered pages — use ONLY after web_fetch returns 'requires_render'. Renders the page in a headless browser (read-only, no login, no downloads), then extracts task-relevant facts. Slower/heavier than web_fetch, so never use it as the first step. Pass `extract` (what you want).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s):// URL to render" },
          extract: { type: "string", description: "你要从这页抽取/验证什么" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web and get a ranked list of sources (title, snippet, URL) for any open-ended question — 'search X', 'what's the latest …', events, news. Then call web_fetch on the most relevant result URL to read details, and answer citing the URLs. Use recency for time-sensitive queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          recency: {
            type: "string",
            enum: ["day", "week", "month", "year"],
            description: "Optional: only recent results, e.g. 'week' for this week's events",
          },
        },
        required: ["query"],
      },
    },
  },
];

TOOLS.push(...fsToolSchemas);

function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Conservative allow-list: a command auto-runs only if every piped/chained
// segment starts with a known read-only verb and there is no redirect / shell-pipe.
// Anything else needs explicit human confirmation (or is skipped non-interactively).
function isReadOnly(cmd) {
  // benign stderr redirects don't make a command dangerous
  const c = String(cmd).trim().replace(/\s*2>&1/g, "").replace(/\s*2>\/dev\/null/g, "");
  if (/[>]|(\|\s*(sh|bash|node|python|pwsh|powershell))/.test(c)) return false;
  const safe =
    /^(ls|ll|cat|bat|head|tail|pwd|echo|grep|rg|find|fd|wc|stat|file|tree|sort|uniq|cut|awk|jq|column|git\s+(status|log|diff|show|branch|remote|ls-files|rev-parse|config\s+--get)|node\s+(-v|--version)|npm\s+(ls|view)|pnpm\s+(ls|list)|cargo\s+--version|which|whoami|date|env|printenv|dir|type)\b/;
  return c
    .split(/\||&&|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((seg) => safe.test(seg));
}

// Run a shell command — prefer bash (so Unix commands work on Windows), fall
// back to the platform shell. 30s timeout, output truncated.
function runShell(command) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let timer;
    const finish = (s) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(s);
    };
    const attach = (child, isFallback) => {
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (out += d));
      child.on("error", (e) => {
        if (!isFallback) {
          try {
            attach(spawn(command, { shell: true, windowsHide: true }), true);
          } catch (err) {
            finish("（无法执行命令：" + err.message + "）");
          }
        } else {
          finish("（无法执行命令：" + e.message + "）");
        }
      });
      child.on("close", () => finish(out.trim().slice(0, 4000) || "（无输出）"));
    };
    timer = setTimeout(() => finish((out.trim() || "") + "\n（命令超时 30s，已终止）"), 30000);
    try {
      attach(spawn("bash", ["-lc", command], { windowsHide: true }), false);
    } catch {
      try {
        attach(spawn(command, { shell: true, windowsHide: true }), true);
      } catch (err) {
        finish("（无法执行命令：" + err.message + "）");
      }
    }
  });
}

// Fetch a public URL's text (GET only) so agents can answer live questions
// (weather, news, APIs). Read-only by nature, so it auto-runs without confirm.
async function webFetch(url, { extract = "", task = "" } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return "（web_fetch 需要 http(s):// 开头的 URL）";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "curl/8.4.0", Accept: "text/plain,*/*" },
    });
    const ct = res.headers.get("content-type") || "";
    let body = await res.text();
    const isHtml = /html|xml/i.test(ct) || /^\s*</.test(body);
    if (isHtml) {
      const md = await htmlToMd(body, u);
      // Step 2 — WebFetchExtract: a JS-rendered shell becomes a clean requires_render
      // state (not 8000 chars of nav chrome); large pages are aux-model compressed.
      if (isJsShell({ markdown: md, html: body })) {
        return "（疑似 JS 渲染空壳：抓到的多是导航/脚本，正文缺失。requires_render —— 别再猜 URL，改用 web_search 找可读来源，或向用户申请 browser_render。）";
      }
      body = await mdToExtract(md, u, { extract, task });
    } else {
      body = body.trim().slice(0, 8000);
    }
    if (!res.ok) return `（HTTP ${res.status}）${String(body).slice(0, 300)}`;
    return body || "（空响应）";
  } catch (e) {
    return "（web_fetch 失败：" + (e.name === "AbortError" ? "超时 15s" : e.message) + "）";
  } finally {
    clearTimeout(timer);
  }
}

// HTML → clean markdown (readability + turndown, crude-strip fallback).
async function htmlToMd(html, url) {
  return (
    (await cleanHtml(html, url)) ||
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
  ).trim();
}

// Size-route markdown → full text / aux-extracted / reject (Hermes thresholds).
async function mdToExtract(md, url, { extract = "", task = "" } = {}) {
  const route = routeBySize(md.length);
  if (route === "reject") return "（页面过大（>2M 字符）：请给更具体的子页面 URL。）";
  return route === "full" ? md : await auxExtract(md, { extract, task, url, chunk: route === "chunk" });
}

// browser.render upgrade channel (Step 3): used ONLY after requires_render. Renders
// the JS page with the configured provider (default local Playwright), then runs the
// SAME extract pipeline so the main model gets task facts, not a raw DOM.
async function webRender(url, { extract = "" } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return "（browser_render 需要 http(s):// 开头的 URL）";
  if (isSearchEnginePage(u)) return "（搜索引擎结果页不渲染——请用 web_search 找来源。）";
  const r = await renderPage(u, {});
  if (!r.ok) {
    if (r.reason === "no_render_provider" || r.reason === "playwright_not_installed") {
      return "（无可用 Render Provider" + (r.note ? "：" + r.note : "") + "。否则就已有信息标 unknown，别猜。）";
    }
    return "（browser_render 失败：" + (r.note || r.error || r.reason) + "）";
  }
  const md = await htmlToMd(r.html, u);
  return await mdToExtract(md, u, { extract });
}

// Compress a long page with a cheap aux model against the task (Hermes-style size
// routing). Falls back to truncated markdown with no key / on error, so it never
// blocks the agent. Aux model is configurable (CREW_EXTRACT_MODEL), defaults to main.
async function auxExtract(md, { extract = "", task = "", url = "", chunk = false } = {}) {
  const apiKey = process.env.ZENMUX_API_KEY;
  if (!apiKey) return md.slice(0, 8000) + "\n…（正文较长已截断；给 web_fetch 传 extract 参数可让我按任务抽要点）";
  const baseUrl = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1").replace(/\/$/, "");
  const model = process.env.CREW_EXTRACT_MODEL || process.env.HERMES_MODEL || "anthropic/claude-opus-4.8";
  const page = chunk ? md.slice(0, 60000) : md;
  const sys = "你是网页信息抽取器：只输出对任务有用的结构化事实，保留来源线索（标题/段落/日期/价格单位/链接文字），缺失字段标 unknown，绝不编造，删掉导航/广告/页脚/样板。";
  const prompt = extractPrompt({ task: extract || task, fields: [] }) + "\n\n# 网页正文（markdown）\n" + page;
  try {
    const r = await callModel({ baseUrl, apiKey, model, temperature: 0, system: sys, messages: [{ role: "user", content: prompt }], stream: false });
    const out = String(r?.content || "").trim();
    return out ? `（已按任务从 ${url} 抽取要点${chunk ? "·仅前段，页面很大" : ""}）\n` + out : md.slice(0, 8000);
  } catch {
    return md.slice(0, 8000) + "\n…（抽取失败，返回截断正文）";
  }
}

// Execute one tool call. `confirm(cmd)` (interactive only) gates non-read-only bash.
// A search-engine result page is noise for a reader (and usually anti-scraped), so
// block web_fetch on SERPs — a stuck agent must use web_search, not scrape Bing/DDG.
function isSearchEnginePage(url) {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (/(^|\.)duckduckgo\.com$/.test(host)) return true;
    if (/(^|\.)bing\.com$/.test(host) && path.startsWith("/search")) return true;
    if (/(^|\.)google\.[a-z.]+$/.test(host) && path.startsWith("/search")) return true;
    if (/(^|\.)yandex\.[a-z.]+$/.test(host) && path.startsWith("/search")) return true;
    if (/(^|\.)(baidu|so)\.com$/.test(host) && path === "/s") return true;
    if (/(^|\.)sogou\.com$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

async function runTool(name, args, { confirm } = {}) {
  if (name === "web_fetch") {
    const url = String(args?.url ?? "");
    if (isSearchEnginePage(url))
      return "（不要抓取搜索引擎结果页（duckduckgo/bing/google/百度 等）——那是噪音、常被反爬。请改用 web_search 找来源，或直接 web_fetch 官方域名的具体文章页。）";
    return await webFetch(url, { extract: args?.extract });
  }
  if (name === "browser_render") {
    const url = String(args?.url ?? "");
    if (confirm) {
      const ok = await confirm("使用 Browser Render 渲染 " + url + "（只读、无登录态）?");
      if (!ok) return "（用户拒绝渲染）";
    }
    return await webRender(url, { extract: args?.extract });
  }
  if (name === "web_search") return (await webSearch(args?.query, { recency: args?.recency })).text;
  if (name === "search") {
    const q = String(args?.query ?? "").trim();
    if (!q) return "（search 缺少 query）";
    const path = args?.path ? String(args.path) : ".";
    return runShell(`rg --line-number --no-heading --color never -S -- ${shq(q)} ${shq(path)} | head -60`);
  }
  if (name === "bash") {
    const cmd = String(args?.command ?? "").trim();
    if (!cmd) return "（bash 缺少 command）";
    if (!isReadOnly(cmd)) {
      if (confirm) {
        const ok = await confirm("执行命令: " + cmd);
        if (!ok) return "（用户拒绝执行，已跳过）";
      } else {
        return `（该命令非只读，需人工确认；非交互模式已跳过）\n命令: ${cmd}`;
      }
    }
    return runShell(cmd);
  }
  if (name === "read_file") {
    const r = await readAnyFile(args?.path, { root: process.cwd() });
    return r.ok ? r.text : `（读取失败：${r.error}）`;
  }
  if (name === "edit_file" || name === "write_file") {
    const path = String(args?.path ?? "");
    const r =
      name === "edit_file"
        ? computeEdit(path, args?.old_string, args?.new_string)
        : computeWrite(path, args?.content);
    if (!r.ok) return `（${name === "edit_file" ? "编辑" : "写入"}失败：${r.error}）`;
    const diffColor = process.env.CREW_MD === "1" || !!process.stdout.isTTY;
    process.stdout.write("\n" + reindent(diffCard({ path, oldText: r.oldContent, newText: r.newContent }, { color: diffColor })) + "\n");
    if (!confirm) return "（非交互模式，未写入；以上为改动预览）";
    const ok = await confirm("应用以上改动到 " + path + " ?");
    if (!ok) return "（用户取消，未写入）";
    const w = applyWrite(path, r.newContent);
    return w.ok ? `✓ 已写入 ${path}` : `（写入失败：${w.error}）`;
  }
  return `（未知工具：${name}）`;
}

const AGENT_GUIDE = `

# 工作方式（重要）
你可以调用工具：bash（在用户机器上执行命令/看文件/git），search（用 ripgrep 搜本机文件内容），web_search（联网搜索任意问题、拿到排好序的来源），web_fetch（抓取某个 URL 的正文），read_file/edit_file/write_file（读写文件）。
需要**实时/联网信息**就联网，别回答「我不能联网」：
- 已知数据源（天气等）直接 web_fetch，例如 https://wttr.in/北京?format=3 。
- 开放式「搜索X / 最新 / 有什么」类问题：先 **web_search** 找来源，再对最相关的结果 **web_fetch** 读详情，最后综合作答并给出 URL。搜不到就如实说，绝不编。

# 研究纪律（联网/调研任务必读）
- **绝不 web_fetch 搜索引擎结果页**（bing.com/search、google、百度结果页都是噪音）：用 web_search 拿来源列表，再 web_fetch 最相关的**目标站点/官方域名**读正文。
- 官方优先：查产品/模型/价格，先官方域名（如 volcengine.com、平台文档），其次新闻、社区。
- 失败别投降：一次搜不到就**换策略**再来——精确短语 → 官方域名 site: → 中文别名 → 英文别名 → 产品/API ID → 新闻源 → 文档源；至少换 3 种再说「查不到」，并说明已试过哪些路径。
- 证据纪律：每个关键结论带**来源 URL + 置信度（高/中/低）**；查不到的字段写 unknown，**绝不脑补数字/价格**。
- 读长页用 web_fetch 时带上 **extract**（要抽什么）——拿到的是按任务抽好的要点，不是整页噪音；若返回 **requires_render**（JS 空壳），别再猜 URL，改 web_search 或申请 browser_render。
读本机文件/文档（.txt/.md/代码，以及 .pptx/.docx/.xlsx/.pdf）一律用 **read_file**——它直接吃 Windows 路径（C:\\...）并自动提取 Office/PDF 文本。**别用 bash 去 cat/ls 本机文件**：这台机的 bash 是 Git Bash，Windows 路径要写成 /c/Users/... 才认；read_file 最省事，用户贴的 C:\\ 路径直接丢给它。
- 先规划：回答前先输出一小段「## 计划」，说明你要怎么做、查什么、用哪个工具（2-4 步即可）。
- 再执行：需要真实信息时**调用工具**去看，绝不凭空假设路径或文件内容。
- 后结论：基于工具返回的真实结果，给清晰、可执行的回答。
只读命令会自动执行；写入/危险命令需用户确认。看不到的就用工具看，或标 [placeholder]。`;

// One agent turn: plan → (optional tool calls) → answer. Streams text with
// markdown rendering, shows each tool call + result in the TUI, and loops until
// the model returns a final answer. Mutates `messages` with the full exchange.
async function agentLoop({ baseUrl, apiKey, model, temperature, system, messages, name, isTTY, renderMd, confirm, onUsage, gateway, onInvocation, budget, onDelta }) {
  // Ink/sink mode: when onDelta is provided, stream text to the UI and NEVER draw to
  // stdout from here (Ink owns the screen). Every raw-renderer write below is gated on !quiet.
  const quiet = !!onDelta;
  const magenta = (s) => `\x1b[35m${s}\x1b[0m`;
  const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const label = magenta(`${name} › `);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const today = new Date().toISOString().slice(0, 10);
  const sys =
    system +
    AGENT_GUIDE +
    `\n\n# 时间锚点\n今天是 ${today}。你的训练知识可能截止得更早——所以**日期/模型/事件比你印象中新，并不代表它是假的**，很可能就是真实的近期信息。判断真假要看**来源是否可信**（官方域名、HTTP 200 的正文就是可信来源），而不是"日期超出我的认知就当成虚构/污染"。该存疑时标 [需核实]、尽量交叉验证，但别把真实的最新信息误判成假的。`;
  let renderCount = 0; // browser_render is capped per task (Step 3 safety)
  // Step 5 — Budget Guard: stop flailing (cost / repeated empty search / JS shells).
  let spentPrompt = 0, spentCompletion = 0, searchEmpty = 0, fetchShell = 0, costOkd = false;

  for (let step = 0; step < 8; step++) {
    if (!quiet) process.stdout.write("\n");
    let fi = 0;
    const spin = isTTY && !quiet
      ? setInterval(() => process.stdout.write("\r" + label + dim(frames[fi++ % frames.length] + " 思考中…")), 80)
      : null;
    let begun = false;
    const begin = () => {
      if (begun) return;
      begun = true;
      if (spin) clearInterval(spin);
      // TTY: label on its own line so the streaming caret's \r never eats it.
      process.stdout.write(isTTY ? "\r" + label + "\x1b[K\n" : label);
    };
    const md = createMdPrinter(renderMd);
    let streamed = "";
    let res;
    try {
      res = await callModel({
        baseUrl, apiKey, model, temperature, system: sys,
        messages, tools: TOOLS, stream: true,
        onDelta: (d) => { streamed += d; if (quiet) onDelta(d); else { begin(); md.push(d); } },
      });
    } catch (error) {
      if (spin) clearInterval(spin);
      if (!quiet) { begin(); md.end(); } // clear leftover spinner + flush partial (raw mode)
      // Keep the partial answer in history so the user can say "继续" and resume
      // from where it was cut off (a timed-out turn must not lose working memory).
      if (streamed.trim()) messages.push({ role: "assistant", content: streamed.trim() + "\n\n（…上一条回答在此处被中断）" });
      throw error;
    }
    if (!quiet) { begin(); md.end(); }
    onUsage?.(res.usage);
    if (res.usage) { spentPrompt += res.usage.prompt_tokens || 0; spentCompletion += res.usage.completion_tokens || 0; }

    const { content, toolCalls } = res;
    if (toolCalls && toolCalls.length) {
      messages.push({ role: "assistant", content: content || "", tool_calls: toolCalls });
      if (!quiet) process.stdout.write("\n");
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const toolName = tc.function.name;
        const t0 = Date.now();
        // Permission Gateway (PRD §13): the model declares, the gateway enforces.
        // Deny (L3/L4/unknown) is blocked before runTool; allow/confirm pass through
        // to runTool, which keeps its own diff-preview confirm for writes.
        const decision = gateway ? gateway.check(toolName, args) : null;
        let result;
        if (decision && decision.decision === "deny") {
          result = `（该动作未授权：${decision.reason}）`;
        } else if (toolName === "browser_render" && ++renderCount > 2) {
          result = "（本任务已渲染 2 次，达上限——继续渲染需用户确认，避免浏览器乱点烧钱。）";
        } else {
          // confirm (L2+): surface a human-readable permission request before the
          // y/n prompt that runTool itself raises. (PRD §13.2 — "讲人话".)
          if (!quiet && decision && decision.decision === "confirm") {
            process.stdout.write(
              "\n" + reindent(permissionRequest({ employeeName: name, toolLabel: toolName, scope: decision.scope, level: decision.level, reason: decision.reason }), GUTTER) + "\n",
            );
          }
          result = await runTool(toolName, args, { confirm });
        }
        const elapsedMs = Date.now() - t0;
        // a denied/refused/skipped call shows as "not confirmed" in the tool line
        const skipped = decision?.decision === "deny" || /^（(用户拒绝|该命令非只读|用户取消|非交互|该动作未授权|不要抓取|疑似)/.test(result);
        const invocation = auditRecord({
          toolName, args,
          decision: decision ? decision.decision : "allow",
          level: decision ? decision.level : null,
          startedAt: t0, endedAt: t0 + elapsedMs,
          status: skipped ? "blocked" : "success",
          output: result,
        });
        invocation.action = summarizeAction({ tool: toolName, args, status: invocation.status, decision: invocation.decision });
        onInvocation?.(invocation);
        if (toolName === "web_search" && /无搜索结果|没搜到/.test(result)) searchEmpty++;
        if (toolName === "web_fetch" && /requires_render|疑似 JS 渲染空壳/.test(result)) fetchShell++;
        // Compact one-line tool activity (opencode-style); edit/write also printed
        // a diff card from runTool above. Output is folded — only a summary shows.
        if (!quiet) process.stdout.write(
          GUTTER +
            toolLine(
              { name: toolName, command: args.command, args, output: result, confirmed: skipped ? false : undefined },
              { color: renderMd },
            ) +
            "\n",
        );
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      if (budget) {
        const { cost } = estimateCost({ promptTokens: spentPrompt, completionTokens: spentCompletion });
        const stop = (msg) => {
          if (quiet) { onDelta(`\n\n⚠ 预算守门：${msg}\n建议：配置 search key / 授权 Browser Render / 结束并标记失败。`); return; }
          console.log("\n" + GUTTER + `\x1b[33m⚠ 预算守门：${msg}\x1b[0m`);
          console.log(GUTTER + "\x1b[2m   建议：配置 search key / 授权 Browser Render / 结束并标记失败。\x1b[0m");
        };
        if (searchEmpty >= (budget.maxSearchEmpty ?? 2)) { stop("搜索连续无结果，停止瞎试。"); return content || "（搜索连续无结果，已停止——请配置 Search Provider 后重试。）"; }
        if (fetchShell >= (budget.maxFetchShell ?? 2)) { stop("多次抓到 JS 空壳，停止猜 URL。"); return content || "（多次遇到 JS 渲染页，已停止——授权 browser_render 或换可读来源。）"; }
        if (budget.costCap && cost > budget.costCap && !costOkd) {
          if (confirm && (await confirm(`本任务已花 $${cost.toFixed(2)}（超预算 $${budget.costCap}），继续？`))) costOkd = true;
          else { stop(`成本 $${cost.toFixed(2)} 超预算 $${budget.costCap}。`); return content || "（成本超预算，已停止。）"; }
        }
      }
      continue;
    }

    if (content) messages.push({ role: "assistant", content });
    if (!quiet) console.log("");
    return content;
  }
  if (!quiet) console.log("");
  return "（已达工具调用步数上限）";
}

// Interactive multi-turn chat REPL — `crew chat <agent>` (no task).
// Uses an event queue (not await rl.question) so it stays correct while a model
// call is in flight — works for both a real TTY and piped input.
async function interactiveChat({ agentId, profile, apiKey, baseUrl, resume }) {
  let { model, temperature, system, skills, displayName, title } = profile;
  let name = displayName || titleizeId(agentId);
  let currentAgentId = agentId;
  const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
  const magenta = (s) => `\x1b[35m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const colorOn = !!process.stdout.isTTY;

  // Sticky top bar (opencode-style): default off; toggle live with `/topbar on|off`
  // (or start with CREW_TOPBAR=1). TTY only — a no-op when piped.
  const canTopBar = !!process.stdout.isTTY;
  let promptTok = 0;
  let completionTok = 0;
  let lastPromptTok = 0;
  const topState = () => ({
    title: name,
    tokens: promptTok + completionTok,
    ctxPct: ctxPercent(lastPromptTok, model),
    cost: costFor(model, promptTok, completionTok),
  });
  const NOOP_BAR = { redraw() {}, dispose() {} };
  let topBarOn = process.env.CREW_TOPBAR === "1" && canTopBar;
  let bar = topBarOn ? installTopBar(topState) : NOOP_BAR;
  process.once("SIGINT", () => { bar.dispose(); process.exit(130); });
  process.once("exit", () => bar.dispose());

  console.log("");
  console.log(agentBadge({ name, title, model, skillCount: skills.length }, { color: colorOn }));
  console.log("");

  // Full-screen Ink UI — opt-in via CREW_TUI=ink on a real TTY (the raw renderer stays
  // the default until validated). Ink owns stdin, so branch BEFORE creating readline.
  // Model/gateway/budget logic is unchanged; agentLoop just streams to the store via a sink.
  if (process.env.CREW_TUI === "ink" && !!process.stdout.isTTY && !!process.stdin.isTTY) {
    const inkHistory = [];
    if (resume) {
      const s = loadSession(ROOT, currentAgentId);
      if (s.ok && s.messages.length) inkHistory.push(...s.messages);
    }
    const { startInkChat } = await import("./tui/repl.mjs");
    await startInkChat({
      agentLoop,
      agentLoopDeps: {
        baseUrl, apiKey, model, temperature, system, name, isTTY: true,
        gateway: makeGateway(),
        confirm: async () => true, // v1: auto-approve L2 confirms (gateway still denies L3/L4); Ink confirm modal = follow-up
      },
      history: inkHistory,
      agentName: name,
      renderLines: (t) => renderMessage(t),
      saveSession: () => saveSession(ROOT, currentAgentId, inkHistory),
    });
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  let resolver = null;
  let closed = false;
  const wake = () => {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r();
    }
  };
  rl.on("line", (l) => { queue.push(l); wake(); });
  rl.on("close", () => { closed = true; wake(); });
  const nextLine = async () => {
    if (queue.length) return queue.shift();
    if (closed) return null;
    await new Promise((res) => { resolver = res; });
    return queue.length ? queue.shift() : null;
  };

  const history = [];
  if (resume) {
    const s = loadSession(ROOT, currentAgentId);
    if (s.ok && s.messages.length) {
      history.push(...s.messages);
      const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : "上次";
      console.log(GUTTER + dim(`↩ 已恢复会话（${s.messages.length} 条消息 · ${when}）`) + "\n");
    } else {
      console.log(GUTTER + dim("↩ 没有可恢复的历史会话，开始新会话") + "\n");
    }
  }
  for (;;) {
    process.stdout.write(userRailPrompt({ color: colorOn }));
    const raw = await nextLine();
    if (raw === null) break; // EOF / closed
    const line = raw.trim();
    if (!line) continue;
    if (isCommand(line)) {
      const { text, action } = runCommand(line, { agentId: currentAgentId, name, model, tools: TOOLS.map((t) => t.function?.name).filter(Boolean), root: ROOT, color: colorOn });
      if (text) console.log("\n" + text + "\n");
      if (action?.type === "exit") break;
      if (action?.type === "clear") {
        history.length = 0;
        console.log("\n" + dim("  (上下文已清空)") + "\n");
      }
      if (action?.type === "switch") {
        try {
          const np = await loadProfile(action.agent);
          ({ model, temperature, system, skills, displayName, title } = np);
          name = displayName || titleizeId(action.agent);
          currentAgentId = action.agent;
          history.length = 0;
          console.log("\n" + agentBadge({ name, title, model, skillCount: skills.length }, { color: colorOn }) + "\n");
        } catch (e) {
          console.log("\n  " + dim("切换失败：" + e.message) + "\n");
        }
      }
      if (action?.type === "topbar") {
        if (!canTopBar) {
          console.log("\n" + GUTTER + dim("顶部条仅在交互式终端(TTY)可用") + "\n");
        } else {
          const want = action.value === "toggle" ? !topBarOn : action.value === "on";
          if (want && !topBarOn) {
            bar = installTopBar(topState);
            topBarOn = true;
            console.log("\n" + GUTTER + dim("顶部条已开启 · 再 /topbar off 关闭") + "\n");
          } else if (!want && topBarOn) {
            bar.dispose();
            bar = NOOP_BAR;
            topBarOn = false;
            console.log("\n" + GUTTER + dim("顶部条已关闭") + "\n");
          } else {
            console.log("\n" + GUTTER + dim(`顶部条已${topBarOn ? "开启" : "关闭"}`) + "\n");
          }
        }
      }
      continue;
    }

    // Auto-detect local file paths the user pasted/mentioned and eagerly read them
    // into context (Open Interpreter style), so "C:\…\deck.pptx 讲了啥" just works.
    let userContent = line;
    const attached = detectFilePaths(line);
    if (attached.length) {
      const textBlocks = [];
      const imageBlocks = [];
      for (const p of attached) {
        const tag = basename(p);
        if (isImagePath(p)) {
          const img = await readImageDataUrl(p);
          if (img.ok) {
            imageBlocks.push({ type: "image_url", image_url: { url: img.dataUrl } });
            process.stdout.write(GUTTER + dim(`📎 已附图 ${tag} (${Math.round(img.bytes / 1024)} KB)`) + "\n");
          } else {
            process.stdout.write(GUTTER + dim(`📎 图片读取失败 ${tag}：${img.error}`) + "\n");
          }
        } else {
          const r = await readAnyFile(p);
          if (r.ok) {
            process.stdout.write(GUTTER + dim(`📎 已读取附件 ${tag} · ${r.kind} (${r.text.split("\n").length} 行)`) + "\n");
            textBlocks.push(`【附件：${tag}】\n${r.text}`);
          } else {
            process.stdout.write(GUTTER + dim(`📎 读取附件失败 ${tag}：${r.error}`) + "\n");
          }
        }
      }
      const textPart = textBlocks.length ? textBlocks.join("\n\n") + "\n\n---\n用户消息：" + line : line;
      if (imageBlocks.length) userContent = [{ type: "text", text: textPart }, ...imageBlocks];
      else if (textBlocks.length) userContent = textPart;
    }
    history.push({ role: "user", content: userContent });
    const isTTY = !!process.stdout.isTTY;
    const confirm = async (msg) => {
      process.stdout.write("\n  " + dim("⚠ ") + msg + dim("  [回车=确认 / n=取消] ") + cyan("› "));
      const ans = ((await nextLine()) ?? "").trim().toLowerCase();
      return ans === "" || ans === "y" || ans === "yes";
    };
    try {
      await agentLoop({
        baseUrl, apiKey, model, temperature, system,
        messages: history, name, isTTY,
        renderMd: isTTY || process.env.CREW_MD === "1",
        confirm,
        gateway: makeGateway(),
        onUsage: (u) => {
          if (!u) return;
          promptTok += u.prompt_tokens || 0;
          completionTok += u.completion_tokens || 0;
          if (u.prompt_tokens) lastPromptTok = u.prompt_tokens;
          bar.redraw();
        },
      });
    } catch (error) {
      // Do NOT revert — keep the user message + partial answer in history so
      // "继续" resumes from the cut-off point (working memory must survive a timeout).
      console.error("\n" + GUTTER + `\x1b[33m（回答被中断：${error.message}。说「继续」我接着写，或换个问法。）\x1b[0m` + "\n");
    }
    if (isTTY) {
      const turns = history.filter((m) => m.role === "assistant" && !m.tool_calls).length;
      console.log(GUTTER + statusBar({ model, step: turns }, { color: true }));
    }
    saveSession(ROOT, currentAgentId, history); // persist after each turn for --resume
  }

  rl.close();
  bar.dispose();
  console.log(`\n${GUTTER}${dim(`${name} 下班了，回头见 👋`)}\n`);
}

// Ask the user the one question that defines an "effective task" (PRD §19.2):
// was the deliverable actually useful? Enter/y = useful, n = not. Skipped when
// stdin isn't a TTY (piped/CI) so the runtime stays non-interactive-safe.
async function askUseful() {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await new Promise((res) => rl.question("\n" + GUTTER + "这次任务有用吗？[Y/n] ", res));
    const t = String(ans).trim().toLowerCase();
    if (t === "n" || t === "no" || t === "没用") return false;
    return true;
  } finally {
    rl.close();
  }
}

// Ask a free-form line (lowercased); null when stdin isn't a TTY.
async function askLine(question) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await new Promise((res) => rl.question(question, res));
    return String(ans).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

function printSearchKeyHelp() {
  console.log("\n" + GUTTER + "配置搜索 Provider（任选其一，Tavily 免费最省事）：");
  console.log(GUTTER + "  · Tavily（免费 1000/月，免信用卡）：tavily.com 拿 key → setx TAVILY_API_KEY tvly-xxxx");
  console.log(GUTTER + "  · 或 SERPER_API_KEY / BRAVE_API_KEY");
  console.log(GUTTER + "  配好后重跑：crew run <agent> --task <id>\n");
}

// `crew run <agent> --task <id>` — the v0.3 Task Runtime. Resolve a manifest demo
// task, run it through the permission-gated agent loop while recording a TaskRun
// (state machine + tool-call audit), store the deliverable as an Artifact, grade
// it against the rubric + required sections, and capture the effective-task signal.
// PRD v0.3 §8.2 (state machine) / §13 (gateway) / §15 (grader) / §19.2 (effective).
async function runTaskMode({ agentId, profile, apiKey, baseUrl, taskId }) {
  const { model, temperature, system, displayName, title, runtime } = profile;
  const name = displayName || titleizeId(agentId);
  const tasks = Array.isArray(runtime?.demo_tasks) ? runtime.demo_tasks : [];
  const demo = tasks.find((t) => t && t.id === taskId);
  if (!demo) {
    const ids = tasks.map((t) => t?.id).filter(Boolean).join(", ") || "(无)";
    console.error(`Error: 员工 ${agentId} 没有任务 "${taskId}"。可用任务：${ids}`);
    process.exit(1);
  }
  const taskText = demo.input?.task_text || demo.title || taskId;
  const required = Array.isArray(demo.output_schema?.required_sections) ? demo.output_schema.required_sections : [];

  // Recall: inject the employee's prior memory (reliable sources, verified SOPs) so
  // it builds on past work instead of starting cold. (PRD §14 — memory recall.)
  const mem = loadMemory(ROOT, agentId);
  const memText = mem.ok ? summarizeForPrompt(mem.items) : "";
  const sys = memText ? system + "\n\n# 你的记忆（过往任务沉淀，可直接复用）\n" + memText : system;

  const run = newTaskRun({ employeeId: agentId, goal: taskText, taskId: `task_${Date.now()}` });
  const gateway = makeGateway();

  console.log(statusHeader({ name, role: title, status: "working", model }));
  console.log(GUTTER + `\x1b[2m▸ ${demo.title || taskId}\x1b[0m\n`);

  // Search Planner (PRD §11.1): if the task carries research hints, show the plan
  // (multi-strategy queries, official-domain-first) before working, and pass it in.
  let planNote = "";
  if (demo.research_hints) {
    const h = demo.research_hints;
    const queries = generateQueries({ entity: h.entity, aliases: h.aliases, officialDomains: h.official_domains, productIds: h.product_ids });
    console.log(GUTTER + "\x1b[2m研究计划（Search Planner · 官方域名优先）：\x1b[0m");
    queries.slice(0, 6).forEach((q, i) => console.log(GUTTER + `\x1b[2m  ${i + 1}. ${q}\x1b[0m`));
    console.log("");
    planNote =
      "\n\n# 研究计划（按此检索，官方域名优先；某条搜不到就换下一条策略，绝不放弃）\n建议检索式：\n" +
      queries.map((q) => "- " + q).join("\n") +
      "\n失败剧本：" + FAILURE_PLAYBOOK.map((s) => s.label).join(" → ");
  }

  // Step 1 — Search Provider Preflight (Preflight Doctor, Search Harness v1): a
  // research employee must have a verifiable search link. No provider → don't start
  // formally; let the user configure, or degrade to "知识库初判"(NOT counted effective).
  let degradeNote = "";
  if (demo.research_hints && pickBackend().name === "ddg") {
    console.log(GUTTER + "\x1b[33m⚠ Preflight：未配置 Web Search Provider（Tavily / Serper / Brave）\x1b[0m");
    console.log(GUTTER + "\x1b[2m   研究类任务需要可验证搜索链路；没有它只能给「仅凭已有知识」的初步判断，不计为有效任务。\x1b[0m");
    const choice = await askLine(GUTTER + "   [回车]=降级运行(不计有效)  [c]=看配置方法  [n]=取消 › ");
    if (choice === "c") { printSearchKeyHelp(); process.exit(0); }
    if (choice === "n") { console.log(GUTTER + "已取消。\n"); process.exit(0); }
    run.degraded = true;
    console.log(GUTTER + "\x1b[2m   → 降级运行：仅基于已有知识，关键数字标 [需核实]。\x1b[0m\n");
    degradeNote =
      "\n\n# 重要：本次没有可靠联网检索（无 Search Provider，web_search 大概率返回空），任务已降级为「仅凭已有知识的初步判断」。不要靠反复 web_fetch 猜 URL 或抓搜索引擎结果页硬凑——既烧钱又拿不到结果。请：①开头说明本次为降级初判、需用户配置 TAVILY_API_KEY（免费）才能做可靠调研；②按交付物结构（含 来源/置信度/建议）给初步结论，关键数字一律标 [需核实]，置信度标「低」；③最多试 1–2 个官方 URL 后即收尾。";
  }

  transition(run, "planned");
  transition(run, "running_tool");

  let output = "";
  let promptTok = 0;
  let completionTok = 0;
  try {
    output = (await agentLoop({
      baseUrl, apiKey, model, temperature, system: sys,
      messages: [{ role: "user", content: taskText + planNote + degradeNote }], name,
      isTTY: !!process.stdout.isTTY,
      renderMd: !!process.stdout.isTTY || process.env.CREW_MD === "1",
      gateway,
      onInvocation: (rec) => {
        run.tool_invocations.push(rec);
        addEvent(run, { type: "tool_called", summary: rec.action || rec.tool_name, tool_name: rec.tool_name, status: rec.status });
      },
      onUsage: (u) => {
        if (!u) return;
        promptTok += u.prompt_tokens || 0;
        completionTok += u.completion_tokens || 0;
      },
      budget: { costCap: demo.budget_limit ?? 0.5, maxSearchEmpty: 2, maxFetchShell: 2 },
      confirm: async (msg) => {
        const a = await askLine("\n" + GUTTER + "⚠ " + msg + " [y/N] ");
        return a === "y" || a === "yes" || a === "是";
      },
    })) || "";
  } catch (error) {
    transition(run, "failed");
    saveTaskRun(ROOT, run);
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }

  transition(run, "extracting_evidence");
  transition(run, "drafting_artifact");
  const artifact = newArtifact({ taskId: run.id, type: "research_report", title: demo.title || taskId, content: output });
  saveArtifact(ROOT, artifact);
  run.artifact = artifact.id;

  transition(run, "grading");
  const graded = await grade({ task: taskText, artifact: output });
  const missing = required.filter((s) => !output.includes(s));
  const outputValid = graded.passed && missing.length === 0;
  run.output_valid = outputValid;

  // Dream/reflect: derive memory + playbook candidates from this run and keep the
  // good ones — reliable sources, a project fact, the tool playbook. (PRD §14.4.)
  const review = outputValid ? reviewTaskRun({ taskRun: run, deliverable: output, existingMemory: mem.items }) : null;
  let learned = 0;
  if (review) {
    for (const cand of review.new_memory_candidates) {
      const r = addMemory(ROOT, agentId, cand);
      if (r.ok && !r.skipped) learned++;
    }
    for (const pb of review.new_playbook_candidates) {
      const r = addMemory(ROOT, agentId, { category: "verified_sops", text: `${pb.title}：${pb.steps.join(" → ")}`, confidence: review.confidence });
      if (r.ok && !r.skipped) learned++;
    }
    run.dream = { candidates: review.new_memory_candidates.length + review.new_playbook_candidates.length, confidence: review.confidence };
  }

  // Step 6 — Dream learns from FAILURE, not just success (the most valuable lessons).
  // These sink into failure_paths memory so the employee starts the next task wiser.
  const lessons = [];
  if (run.degraded) lessons.push("研究类任务先过 Search Provider preflight（配 TAVILY_API_KEY 等）再开工，别没 key 硬上。");
  if (!outputValid) lessons.push("无来源/置信度/建议的报告会被 Outcome Grader 判 rejected——先把证据补齐再交。");
  if (run.tool_invocations.some((r) => r.decision === "deny")) lessons.push("越权工具（发邮件/删除/支付等）会被权限网关拦截，别试。");
  if (run.tool_invocations.some((r) => r.tool_name === "web_fetch" && r.status === "blocked")) lessons.push("官方页抓到 JS 空壳要转 browser_render，别反复猜 URL 烧钱。");
  for (const lesson of lessons) addMemory(ROOT, agentId, { category: "failure_paths", text: lesson, confidence: "high" });

  transition(run, "delivered");

  const noCriticalBlock = !run.tool_invocations.some((r) => r.decision === "deny");
  const useful = await askUseful();
  run.user_feedback = useful === null ? "skipped" : useful ? "useful" : "not_useful";
  const effective = outputValid && noCriticalBlock && useful === true && !run.degraded;
  run.effective = effective;
  if (useful === true) transition(run, "accepted");
  else if (useful === false) transition(run, "rejected");

  // Budget Guard (PRD §8.1): tally this task's token cost.
  const { tokens, cost } = estimateCost({ promptTokens: promptTok, completionTokens: completionTok });
  run.tokens = tokens;
  run.cost = cost;

  saveTaskRun(ROOT, run);

  // Step 4 — Evidence Store: bind each cited source to an evidence card (auditable
  // per-run trail with source_type); the report's sources assemble from the cards.
  const cited = [...new Set(output.match(/https?:\/\/[^\s)]+/g) || [])];
  for (const src of cited) {
    addEvidence(ROOT, run.id, newEvidenceCard({ field: "来源", value: src, sourceUrl: src, confidence: run.degraded ? "low" : "high" }));
  }
  const evidence = loadEvidence(ROOT, run.id);
  run.evidence_count = evidence.ok ? evidence.cards.length : 0;
  const sources = assembleSources(evidence.ok ? evidence.cards : []);
  // Task Report (PRD §19.1): export a shareable markdown report next to the run.
  const reportPath = join(ROOT, ".crewclaw", "runs", `${run.id}.report.md`);
  try { writeFileSync(reportPath, renderReport({ taskRun: run, deliverable: output, sources, grade: graded }), "utf8"); } catch {}

  // Workbench info layer (PRD §17.3): main view shows human action summaries.
  if (run.tool_invocations.length) {
    console.log("\n" + GUTTER + "\x1b[2m员工动作：\x1b[0m");
    run.tool_invocations.forEach((r, i) => console.log(GUTTER + `\x1b[2m  ${i + 1}. ${r.action || r.tool_name}\x1b[0m`));
  }
  const tick = (b) => (b ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
  console.log("\n" + GUTTER + "\x1b[1m任务验收\x1b[0m");
  console.log(GUTTER + `  交付物 ${artifact.id} · 工具调用 ${run.tool_invocations.length} 次 · 状态 ${run.status}`);
  console.log(GUTTER + `  ${tick(outputValid)} 结构达标${missing.length ? `（缺：${missing.join("、")}）` : ""}   ${tick(graded.passed)} 验收规则${graded.passed ? "" : `（待补：${graded.feedback}）`}`);
  console.log(GUTTER + `  ${tick(effective)} 有效任务 · 反馈：${run.user_feedback}${run.degraded ? " · 降级运行（未配 Search Provider）" : ""}`);
  console.log(GUTTER + `  \x1b[2m${formatBudget({ tokens, cost, limit: demo.budget_limit })}\x1b[0m`);
  if (learned) console.log(GUTTER + `  \x1b[2m📓 沉淀 ${learned} 条记忆（来源/事实/SOP）\x1b[0m`);
  if (run.evidence_count) console.log(GUTTER + `  \x1b[2m🔖 ${run.evidence_count} 条证据卡 → ${run.id}.evidence.json\x1b[0m`);
  if (lessons.length) console.log(GUTTER + `  \x1b[2m📕 复盘出 ${lessons.length} 条失败教训 → failure_paths\x1b[0m`);
  console.log(GUTTER + `  \x1b[2mTaskRun → .crewclaw/runs/${run.id}.json · 报告 ${run.id}.report.md\x1b[0m`);
  console.log(GUTTER + `  \x1b[2m${actionBar(["accept", "reject", "dream", "inspect"])}\x1b[0m\n`);
}

async function main() {
  const { flags, agentId, task: baseTask } = parseArgs(process.argv.slice(2));

  if (!agentId) {
    console.error('Usage: crew run <agent> "<task>"   |   crew chat <agent>   (interactive)');
    process.exit(2);
  }
  if (!safeAgentId(agentId)) {
    console.error(`Error: invalid agent id "${agentId}" (use lowercase letters, digits, hyphens).`);
    process.exit(1);
  }

  await loadDotEnv();
  const apiKey = process.env.ZENMUX_API_KEY;
  const baseUrl = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1").replace(/\/$/, "");
  if (!apiKey) {
    console.error("Error: ZENMUX_API_KEY not set (expected in crewhire/.env.local).");
    process.exit(1);
  }

  let profile;
  try {
    profile = await loadProfile(agentId);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // --task <id> → v0.3 Task Runtime: run a manifest demo task as a graded, recorded
  // TaskRun (the "试工" closed loop), distinct from free-form chat or one-shot.
  if (flags.task) {
    await runTaskMode({ agentId, profile, apiKey, baseUrl, taskId: flags.task });
    return;
  }

  // No task and not JSON → interactive chat REPL (crew chat <agent>).
  if (!baseTask && !flags.input && !flags.json) {
    await interactiveChat({ agentId, profile, apiKey, baseUrl, resume: flags.resume });
    return;
  }

  let task = baseTask;
  if (flags.input) {
    const inputPath = resolve(ROOT, flags.input);
    if (!existsSync(inputPath)) {
      console.error(`Error: --input file not found: ${flags.input}`);
      process.exit(1);
    }
    task = `${baseTask}\n\n--- input: ${flags.input} ---\n${await readFile(inputPath, "utf8")}`;
  }
  if (!task) {
    console.error('Usage: crew run <agent> "<task>"   |   crew chat <agent>   (interactive)');
    process.exit(2);
  }

  const { model, temperature, system, skills, displayName } = profile;
  const name = displayName || titleizeId(agentId);
  const started = Date.now();

  if (flags.json) {
    // Machine-readable: used by `crew standup` to fan out in parallel.
    try {
      const { content, usage } = await callModel({
        baseUrl, apiKey, model, temperature, system,
        messages: [{ role: "user", content: task }], stream: false,
      });
      process.stdout.write(
        JSON.stringify({ agent: agentId, content, usage, elapsed_ms: Date.now() - started }) + "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({ agent: agentId, error: error.message, elapsed_ms: Date.now() - started }) + "\n",
      );
      process.exit(1);
    }
    return;
  }

  // Live, tool-using single-shot for `crew run`.
  console.log(`${name} · model ${model} · ${skills.length} skills · live`);
  try {
    await agentLoop({
      baseUrl, apiKey, model, temperature, system,
      messages: [{ role: "user", content: task }], name,
      isTTY: !!process.stdout.isTTY,
      renderMd: !!process.stdout.isTTY || process.env.CREW_MD === "1",
      gateway: makeGateway(),
    });
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Error: ${error?.message ?? error}`);
  process.exit(1);
});
