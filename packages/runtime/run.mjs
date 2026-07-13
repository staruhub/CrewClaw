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

import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { agentBadge, statusBar, userRailPrompt, visibleLen } from "./ui.mjs";
import { renderMdLine, renderMessage } from "./ui-markdown.mjs";
import { toolLine } from "./ui-tools.mjs";
import { installTopBar, costFor, ctxPercent } from "./ui-topbar.mjs";
import { webSearch, cleanHtml, pickBackend } from "./tools-web.mjs";
import { diffCard } from "./ui-diff.mjs";
import {
  fsToolSchemas,
  computeEdit,
  computeWrite,
  applyWrite,
} from "./tools-fs.mjs";
import {
  readAnyFile,
  detectFilePaths,
  isImagePath,
  readImageDataUrl,
} from "./tools-files.mjs";
import { saveSession, loadSession } from "./session-store.mjs";
import { isCommand, runCommand } from "./commands.mjs";
import { renderTable, isTableRow } from "./ui-table.mjs";
import { createMdPrinter as makeMdPrinter } from "./ui-stream.mjs";
import { GUTTER, reindent } from "./ui-layout.mjs";
import {
  makeGateway,
  auditRecord,
  isPublicHttpUrlAsync,
  resolvePathInsideRoot,
  resolveWebFetchCapability,
} from "./tool-gateway.mjs";
import {
  newTaskRun,
  transition,
  addEvent,
  saveTaskRun,
  loadTaskRun,
  evaluateCompletionGate,
} from "./task-state.mjs";
import { newArtifact, saveArtifact, markAccepted } from "./artifact-store.mjs";
import { grade } from "./outcome-grader.mjs";
import { loadMemory, addMemory, summarizeForPrompt } from "./memory-store.mjs";
import { reviewTaskRun } from "./dream.mjs";
import { buildReflection, writeReflection } from "./reflect.mjs";
import { legacyLearningEnabled } from "./tui/prefs.mjs";
import { statusHeader, actionBar } from "./workbench-view.mjs";
import { permissionRequest } from "./permission-copy.mjs";
import { generateQueries, FAILURE_PLAYBOOK } from "./search-harness.mjs";
import { summarizeAction } from "./event-summary.mjs";
import { estimateCost, formatBudget } from "./budget-guard.mjs";
import { renderReport } from "./task-report.mjs";
import {
  applyUserAction,
  createTaskJsonlEmitter,
  createTaskModeSink,
  parseUserActionLine,
} from "./tui/task-jsonl.mjs";
import {
  newEvidenceCard,
  addEvidence,
  loadEvidence,
  assembleSources,
} from "./evidence-store.mjs";
import { isJsShell, routeBySize, extractPrompt } from "./web-extract.mjs";
import { renderPage } from "./render-provider.mjs";
import { requestPublicText } from "./safe-http.mjs";
import { loadProfileSources } from "./profile-skills.mjs";
import {
  configuredProvidersFromEnv,
  loadToolCatalog,
  loadWorkspaceCapabilityGrants,
  resolveEmployeeTools,
  validateEmployeeToolNeeds,
} from "./employee-tools.mjs";
import { readStateFileGuarded, writeStateFileAtomic } from "./state-lock.mjs";
import {
  captureArtifactFingerprint,
  persistProofPackDurably,
} from "./acceptance-transaction.mjs";
import { assembleProofPack } from "./proofpack.mjs";
import {
  findPendingTaskApproval,
  loadPendingTaskApproval,
  loadTaskApprovalDecision,
  persistPendingTaskApproval,
  persistTaskApprovalDecision,
  removePendingTaskApproval,
  verifyTaskApprovalDecisionBinding,
  verifyPendingTaskApprovalBinding,
  verifyPendingTaskArtifact,
  withTaskSettlementLock,
} from "./task-approval-store.mjs";
import yaml from "./yaml.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// INSTALL_ROOT owns immutable profiles/code. WORKSPACE_ROOT owns every user/runtime read or write.
// Keeping these distinct is essential when CrewClaw is installed globally or evals use an isolated
// CREWCLAW_ROOT: authorization and execution must resolve relative paths against the same root.
const INSTALL_ROOT = resolve(__dirname, "../..");
const WORKSPACE_ROOT = resolve(process.env.CREWCLAW_ROOT || process.cwd());
const TOOL_CATALOG = loadToolCatalog(INSTALL_ROOT);
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 45000);
const MAX_DOTENV_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_DREAM_RESPONSE_CHARS = 64 * 1024;

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function loadDotEnv({
  workspaceRoot = WORKSPACE_ROOT,
  installRoot = INSTALL_ROOT,
  env = process.env,
} = {}) {
  if (env.CREW_DISABLE_DOTENV === "1") return;
  const candidates = [
    { path: join(workspaceRoot, ".env.local"), root: workspaceRoot },
    { path: join(installRoot, ".env.local"), root: installRoot },
  ];
  let text = null;
  for (const candidate of candidates) {
    try {
      if (!pathEntryExists(candidate.path)) continue;
      text = readStateFileGuarded(candidate.path, {
        root: candidate.root,
        maxBytes: MAX_DOTENV_BYTES,
      }).toString("utf8");
    } catch {
      throw new Error(
        "refusing unsafe .env.local (expected a single-link regular file no larger than 1 MiB)"
      );
    }
    break;
  }
  if (text === null) return;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    // Strip surrounding quotes and a trailing inline comment (B1 hardening).
    let value = m[2].replace(/\s+#.*$/, "").trim();
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (env[m[1]] === undefined) env[m[1]] = value;
  }
}

function readInputFile(rawPath) {
  if (
    typeof rawPath !== "string" ||
    !rawPath.trim() ||
    rawPath.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(
      "refusing unsafe --input file (expected a workspace-local path without parent traversal)"
    );
  }
  try {
    return readStateFileGuarded(resolve(WORKSPACE_ROOT, rawPath), {
      root: WORKSPACE_ROOT,
      maxBytes: MAX_INPUT_BYTES,
    }).toString("utf8");
  } catch {
    throw new Error(
      "refusing unsafe --input file (expected a single-link regular file inside the workspace no larger than 1 MiB)"
    );
  }
}

// Reject ids that try to escape the profile roots (B2 hardening).
function safeAgentId(agentId) {
  return /^[a-z0-9-]+$/.test(agentId);
}

function buildSystemPrompt(soul, skills) {
  const parts = [soul.trim()];
  if (skills.length) {
    parts.push("\n\n# Installed Skills\n");
    parts.push(
      "You have the following ChaoGeek-certified skills installed. Use the one that fits the task.\n"
    );
    for (const skill of skills) parts.push("\n---\n\n" + skill.trim());
  }
  return parts.join("\n");
}

function parseArgs(argv) {
  const flags = {
    json: false,
    input: null,
    resume: false,
    task: null,
    mock: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--mock") flags.mock = true;
    else if (a === "--ascii") continue;
    else if (a === "--input") flags.input = argv[++i] ?? null;
    else if (a === "--task") flags.task = argv[++i] ?? null;
    else positional.push(a);
  }
  // CREW_MOCK=1 is an explicit test-harness contract for the runtime entrypoint. Eval's real
  // child uses an allowlisted environment, so a parent value cannot leak into certification.
  if (process.env.CREW_MOCK === "1") flags.mock = true;
  return {
    flags,
    agentId: positional[0],
    task: positional.slice(1).join(" ").trim(),
  };
}

// callModel now takes a `messages` array (the conversation so far: user/assistant
// turns). The system prompt is prepended here. One-shot callers pass a single
// user message; the chat REPL passes the growing history.
// Deterministic offline model — CREW_MOCK=1 makes callModel return canned content
// instead of hitting the network, so the conformance runner drives the full pipeline
// key-free and reproducibly in CI. It never emits tool_calls (the mock produces the
// final deliverable directly), which keeps the event sequence deterministic. The reply
// echoes a Markdown-shaped body so persistDeliverable's "looks like a deliverable" test
// passes and the artifact contract runs. (§12.4 conformance; PRD v0.6.1 G1.)
function mockModelReply({ messages }) {
  const lastUser = [...(messages || [])]
    .reverse()
    .find(m => m && m.role === "user");
  // v0.8 M6：若最后一条 user 消息是 content-block 数组（含附件），回显收到的块类型，让 conformance
  // 断言 image_url/文本块确实抵达模型（AC-IMG-002）。仅在数组 content 时触发，纯文本路径不受影响。
  let goal;
  if (Array.isArray(lastUser?.content)) {
    const kinds = lastUser.content.map(b => (b && b.type) || "?").join(",");
    const textBlock = lastUser.content.find(b => b && b.type === "text");
    goal = `[parts-received: ${kinds}] ${textBlock?.text || ""}`;
  } else {
    goal = typeof lastUser?.content === "string" ? lastUser.content : "任务";
  }
  const title = goal.replace(/\s+/g, " ").trim().slice(0, 40) || "任务";
  return (
    `# ${title}\n\n` +
    `这是一份用于一致性验证的模拟交付物（CREW_MOCK）。\n\n` +
    `## 假设\n- [假设] 示例假设 A\n- [假设] 示例假设 B\n\n` +
    `## 结论\n- 要点一：说明。\n- 要点二：说明。\n\n` +
    `## 风险\n- [需核实] 关键数字需要来源验证。\n`
  );
}

async function callModel({
  baseUrl,
  apiKey,
  model,
  temperature,
  system,
  messages,
  tools,
  stream,
  onDelta,
  onThinking,
  mock = false,
  signal,
}) {
  if (mock === true) {
    const content = mockModelReply({ messages });
    if (stream && typeof onThinking === "function") {
      // v0.11 M4：mock 也吐一段"思考"，让 thinking 管道在 CREW_MOCK 下可端到端验证（无需真 API/额度）。
      for (const ch of "先拆解需求，再决定检索与产出格式。".match(
        /.{1,12}/gs
      ) || [])
        onThinking(ch);
    }
    if (stream && typeof onDelta === "function") {
      for (const ch of content.match(/.{1,24}/gs) || [content]) onDelta(ch);
    }
    return {
      content,
      usage: { prompt_tokens: 64, completion_tokens: 128, total_tokens: 192 },
      toolCalls: [],
    };
  }
  const controller = new AbortController();
  let timedOut = false;
  const cancelFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancelFromCaller();
  else signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
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
          ? {
              "Accept-Encoding": "identity",
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            }
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
      const result = {
        content: data?.choices?.[0]?.message?.content ?? "",
        usage: data?.usage ?? null,
        toolCalls: data?.choices?.[0]?.message?.tool_calls ?? [],
      };
      if (!String(result.content).trim() && !result.toolCalls.length) {
        throw new Error("model returned an empty response without tool calls");
      }
      return result;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = null;
    const toolAcc = [];
    let done = false;
    const consumeLine = line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return true;
      if (!payload) return false;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (error) {
        const context = payload.replace(/\s+/g, " ").slice(0, 160);
        throw new Error(
          `invalid SSE data frame (${error?.message || "invalid JSON"}): ${context}`
        );
      }
      if (parsed?.usage) usage = parsed.usage;
      const delta = parsed?.choices?.[0]?.delta;
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning) onThinking?.(reasoning);
      if (delta?.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolAcc[i])
            toolAcc[i] = {
              id: "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          if (tc.id) toolAcc[i].id = tc.id;
          if (tc.function?.name) toolAcc[i].function.name += tc.function.name;
          if (tc.function?.arguments)
            toolAcc[i].function.arguments += tc.function.arguments;
        }
      }
      return false;
    };
    streamLoop: for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (consumeLine(line)) {
          done = true;
          break streamLoop;
        }
      }
    }
    buffer += decoder.decode();
    if (!done && buffer) {
      const tailLines = buffer.split(/\r?\n/);
      for (const line of tailLines) {
        if (consumeLine(line)) {
          done = true;
          break;
        }
      }
    }
    const toolCalls = toolAcc.filter(Boolean);
    if (!content.trim() && !toolCalls.length) {
      throw new Error("model returned an empty response without tool calls");
    }
    return { content, usage, toolCalls };
  } catch (error) {
    if (controller.signal.aborted && signal?.aborted && !timedOut) {
      const cancelled = new Error("generation cancelled");
      cancelled.code = "CREW_GENERATION_CANCELLED";
      throw cancelled;
    }
    if (timedOut || error.name === "AbortError") {
      throw new Error(
        `timed out after ${Math.round(TIMEOUT_MS / 1000)}s (network or endpoint stalled)`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelFromCaller);
  }
}

async function callDreamModel(input, { baseUrl, apiKey, model, onUsage } = {}) {
  const system =
    "你是 CrewClaw 的真实任务复盘器。仅返回一个 JSON 对象，且只能包含：" +
    "summary,new_memory_candidates,new_playbook_candidates,confidence,needs_user_review。" +
    "memory candidate 只能含 category,text,confidence；playbook candidate 只能含 title,steps。" +
    "不得输出代码围栏、解释、密钥、令牌、用户私密资料或未经任务证据支持的事实；" +
    "所有候选必须 needs_user_review=true，证据不足则返回空数组。";
  const response = await callModel({
    baseUrl,
    apiKey,
    model,
    temperature: 0,
    system,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    stream: false,
    mock: false,
  });
  onUsage?.(response.usage);
  const content = String(response.content || "");
  if (!content.trim() || content.length > MAX_DREAM_RESPONSE_CHARS) {
    throw new Error("dream model response is empty or exceeds 64 KiB");
  }
  return content;
}

async function loadProfile(
  agentId,
  {
    workspaceRoot = WORKSPACE_ROOT,
    env = process.env,
    surface = "chat",
    configuredProviders,
  } = {}
) {
  const sources = await loadProfileSources(INSTALL_ROOT, agentId);
  if (!sources)
    throw new Error(
      `no runnable profile for "${agentId}" (no SOUL.md in agents/ or experts/).`
    );
  const soul = sources.soul.text;
  let temperature = 0.3;
  let modelFromConfig = "";
  if (sources.config) {
    const cfg = yaml.load(sources.config.text) || {};
    if (typeof cfg.temperature === "number") temperature = cfg.temperature;
    if (cfg.model && typeof cfg.model.default === "string")
      modelFromConfig = cfg.model.default;
  }
  // Prefer the human display name from the manifest (e.g. "AI 落地鲸").
  let displayName = "";
  let title = "";
  let runtime = null;
  let dreamPolicy = null;
  let employeeSpec = null;
  if (sources.hire) {
    try {
      const mf = yaml.load(sources.hire.text) || {};
      if (mf?.metadata?.name) displayName = String(mf.metadata.name);
      if (mf?.identity?.title) title = String(mf.identity.title);
      if (mf?.runtime && typeof mf.runtime === "object") runtime = mf.runtime;
    } catch {
      // fall back to titleized id
    }
  }
  if (sources.employeeSpec) {
    employeeSpec = yaml.load(sources.employeeSpec.text) || {};
    if (
      employeeSpec.dream_policy &&
      typeof employeeSpec.dream_policy === "object"
    ) {
      dreamPolicy = employeeSpec.dream_policy;
    }
  }
  const skills = sources.skillFiles.map(skill => skill.text);
  const avatar = (sources.avatar?.text || "")
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .slice(0, 8);
  const grantSnapshot = loadWorkspaceCapabilityGrants({
    root: workspaceRoot,
    employeeId: agentId,
  });
  if (sources.employeeSpec) {
    const validation = validateEmployeeToolNeeds(employeeSpec?.tool_needs, {
      catalog: TOOL_CATALOG,
    });
    if (!validation.ok) {
      throw new Error(
        `invalid employee tool_needs: ${validation.errors
          .map(error => `${error.capability}: ${error.reason}`)
          .join("; ")}`
      );
    }
  }
  const toolResolution = resolveEmployeeTools({
    catalog: TOOL_CATALOG,
    toolSchemas: TOOLS,
    toolNeeds: employeeSpec?.tool_needs || {},
    grants: grantSnapshot.grants,
    configuredProviders: configuredProviders ?? configuredProvidersFromEnv(env),
    env,
    surface,
  });
  toolResolution.grantSource = grantSnapshot.source;
  toolResolution.grantWarning = grantSnapshot.warning;
  const degradedPrompt = toolResolution.degraded.length
    ? `\n\n# 当前工具降级\n${toolResolution.degraded
        .map(item => `- ${item.capability}: ${item.reason}`)
        .join("\n")}\n不得声称调用了不可用工具；请使用现有输入或明确说明缺口。`
    : "";
  return {
    temperature,
    model:
      modelFromConfig ||
      process.env.HERMES_MODEL ||
      "anthropic/claude-opus-4.8",
    skills,
    displayName,
    title,
    runtime,
    dreamPolicy,
    employeeSpec,
    toolResolution,
    grantSnapshot,
    surface,
    profileDir: sources.profileDir,
    avatar,
    system: buildSystemPrompt(soul, skills) + degradedPrompt,
  };
}

function employeeAgentLoopDeps(profile, root = WORKSPACE_ROOT) {
  const resolution = profile?.toolResolution || {
    visibleTools: [],
    employeePolicy: { tools: {} },
  };
  return {
    tools: resolution.visibleTools || [],
    gateway: makeGateway({
      root,
      employeePolicy: resolution.employeePolicy || { tools: {} },
    }),
  };
}

function requiredToolPreflight(toolResolution) {
  const blocking = Array.isArray(toolResolution?.blocking)
    ? toolResolution.blocking
    : [];
  return {
    ok: blocking.length === 0,
    code: blocking.length ? "tool_preflight_blocked" : "ready",
    blocking,
    degraded: Array.isArray(toolResolution?.degraded)
      ? toolResolution.degraded
      : [],
    reason: blocking.length
      ? `必需工具不可用：${blocking
          .map(item => `${item.capability}（${item.reason}）`)
          .join("；")}`
      : "必需工具可用",
  };
}

async function denyUnavailableApproval() {
  return false;
}

function normalizeOfficialDomains(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(value => {
          const raw = String(value || "")
            .trim()
            .toLowerCase();
          if (!raw) return "";
          try {
            return new URL(
              raw.includes("://") ? raw : `https://${raw}`
            ).hostname
              .replace(/^\*\./, "")
              .replace(/^\.+|\.+$/g, "");
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    ),
  ];
}

function createTaskEvidenceCard(sourceUrl, { officialDomains, degraded }) {
  const card = newEvidenceCard({
    field: "来源",
    value: sourceUrl,
    sourceUrl,
    officialDomains,
  });
  card.confidence = degraded
    ? "low"
    : card.source_type === "official"
      ? "high"
      : ["docs", "community", "news"].includes(card.source_type)
        ? "medium"
        : "low";
  return card;
}

function titleizeId(agentId) {
  return agentId
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --- Minimal streaming Markdown → ANSI renderer for the live chat TUI ---

// Buffers streamed text and prints each line rendered once it completes.
// render=false (non-TTY / piped) → pass-through raw so captured output stays clean.
// Delegates to the dependency-injected, unit-tested printer in ui-stream.mjs.
function createMdPrinter(render) {
  return makeMdPrinter(render, {
    renderMdLine,
    renderTable,
    isTableRow,
    visibleLen,
    GUTTER,
  });
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
        properties: {
          command: { type: "string", description: "The shell command to run" },
        },
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
          path: {
            type: "string",
            description: "Directory to search (default: current directory)",
          },
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
          extract: {
            type: "string",
            description:
              "可选：你要从这页抽取/验证什么（如『Seed 2.1 的价格、上下文、能力』）。正文较长时据此按任务抽要点，省 token。",
          },
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
            description:
              "Optional: only recent results, e.g. 'week' for this week's events",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description:
        "Read a repository diff through a structured, read-only Git invocation. This tool never accepts a shell command.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          base: {
            type: "string",
            description: "Optional safe Git revision to compare against.",
          },
          staged: {
            type: "boolean",
            description:
              "Read the staged diff instead of the working-tree diff.",
          },
          path: {
            type: "string",
            description: "Optional workspace-relative path filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description:
        "Read concise repository branch and working-tree status through structured Git arguments.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Optional workspace-relative path filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "test_run",
      description:
        "Run one repository-defined test/check/lint/verify script by exact package.json script name. Arbitrary commands and arguments are not accepted.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          script: {
            type: "string",
            description:
              "Exact package.json script name, such as test, test:unit, check, lint, or ci:check.",
          },
        },
        required: ["script"],
      },
    },
  },
];

TOOLS.push(...fsToolSchemas);

function generationCancelledError(reason = "generation cancelled") {
  const message =
    typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "generation cancelled";
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "CREW_GENERATION_CANCELLED";
  return error;
}

function throwIfGenerationCancelled(signal) {
  if (signal?.aborted) throw generationCancelledError(signal.reason);
}

function toolTimeoutError(timeoutMs) {
  const error = new Error(`工具执行超过 ${timeoutMs}ms 的员工策略时限`);
  error.name = "AbortError";
  error.code = "tool_timeout";
  return error;
}

// A capability timeout is distinct from a user cancelling generation. Pass a
// child signal to the executor, then give cooperative process/network tools a
// bounded chance to confirm that their descendants have actually stopped. We
// never emit a successful cancellation merely because the parent signal fired.
const TOOL_TERMINATION_GRACE_MS = 3000;
async function runToolWithDeadline(invoke, { signal, timeoutMs } = {}) {
  const hasTimeout =
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000;
  if (!signal && !hasTimeout) return await invoke(undefined);
  const controller = new AbortController();
  return await new Promise((resolvePromise, reject) => {
    let settled = false;
    let timer = null;
    let abortTimer = null;
    let abortOutcome = null;
    const onParentAbort = () =>
      requestAbort(generationCancelledError(signal?.reason));
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (abortTimer) clearTimeout(abortTimer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    };
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!controller.signal.aborted && value instanceof Error)
        controller.abort(value);
      settle(value);
    };
    const requestAbort = outcome => {
      if (settled || abortOutcome) return;
      abortOutcome = outcome;
      if (!controller.signal.aborted) controller.abort(outcome);
      abortTimer = setTimeout(() => {
        const error = new Error("工具取消后未在 3s 内确认终止");
        error.code = "tool_termination_timeout";
        finish(reject, error);
      }, TOOL_TERMINATION_GRACE_MS);
    };
    if (signal?.aborted) {
      finish(reject, generationCancelledError(signal.reason));
      return;
    }
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    if (hasTimeout) {
      timer = setTimeout(
        () => requestAbort(toolTimeoutError(timeoutMs)),
        timeoutMs
      );
    }
    const execution = Promise.resolve().then(() => invoke(controller.signal));
    // The rejection handler remains attached after an abort/timeout wins the
    // race, so a late non-cooperative adapter cannot create an unhandled error.
    execution.then(
      value =>
        abortOutcome
          ? finish(reject, abortOutcome)
          : finish(resolvePromise, value),
      error => {
        if (
          abortOutcome &&
          [
            "process_tree_termination_failed",
            "tool_termination_timeout",
          ].includes(error?.code)
        ) {
          finish(reject, error);
        } else {
          finish(reject, abortOutcome || error);
        }
      }
    );
  });
}

// Windows taskkill can be denied even for a direct child in restricted desktop
// sandboxes. For explicit test_run, a fixed PowerShell owner first assigns
// itself to a KILL_ON_CLOSE Job Object, then starts the target. Its descendants
// inherit that job; killing the direct owner closes the final handle and lets
// Windows reap the entire tree without taskkill.
const WINDOWS_JOB_PAYLOAD_ENV = "CREWCLAW_WINDOWS_JOB_PAYLOAD";
const WINDOWS_JOB_OWNER_PS = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$source = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

public static class CrewClawWindowsJobOwner {
  const uint KillOnJobClose = 0x00002000;
  const int ExtendedLimitInformation = 9;

  [StructLayout(LayoutKind.Sequential)]
  public struct Basic {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public IntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Extended {
    public Basic BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport(
    "kernel32.dll",
    EntryPoint = "CreateJobObjectW",
    ExactSpelling = true,
    CharSet = CharSet.Unicode,
    SetLastError = true
  )]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

  [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
  static extern bool SetInformationJobObject(
    IntPtr job, int infoClass, IntPtr info, uint length);

  [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
  public static extern bool AssignProcessToJobObject(
    IntPtr job, IntPtr process);

  static Exception Win32(string operation) {
    return new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }

  static IntPtr CreateKillOnCloseJob() {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw Win32("CreateJobObject");
    var limits = new Extended();
    limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
    int bytes = Marshal.SizeOf(typeof(Extended));
    IntPtr memory = Marshal.AllocHGlobal(bytes);
    try {
      Marshal.StructureToPtr(limits, memory, false);
      if (!SetInformationJobObject(
        job, ExtendedLimitInformation, memory, (uint)bytes
      )) throw Win32("SetInformationJobObject");
      return job;
    } finally {
      Marshal.FreeHGlobal(memory);
    }
  }

  // PowerShell 5.1 lacks ProcessStartInfo.ArgumentList. Use the standard CRT
  // quoting algorithm rather than building an executable shell command.
  static string Quote(string value) {
    value = value ?? String.Empty;
    if (value.Length == 0) return "\"\"";
    if (!value.Any(c => Char.IsWhiteSpace(c) || c == '"')) return value;
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') {
        slashes++;
        continue;
      }
      if (c == '"') {
        result.Append('\\', slashes * 2 + 1);
        result.Append(c);
        slashes = 0;
        continue;
      }
      result.Append('\\', slashes);
      result.Append(c);
      slashes = 0;
    }
    result.Append('\\', slashes * 2);
    result.Append('"');
    return result.ToString();
  }

  public static int Run(string executable, string[] args, string cwd) {
    if (String.IsNullOrWhiteSpace(executable)) {
      throw new ArgumentException("missing executable");
    }
    // This wrapper owns the only job handle. It intentionally remains open
    // until wrapper exit, when KILL_ON_CLOSE terminates every descendant.
    IntPtr job = CreateKillOnCloseJob();
    using (var self = Process.GetCurrentProcess()) {
      if (!AssignProcessToJobObject(job, self.Handle)) {
        throw Win32("AssignProcessToJobObject(self)");
      }
    }
    var info = new ProcessStartInfo {
      FileName = executable,
      Arguments = String.Join(
        " ", (args ?? new string[0]).Select(Quote).ToArray()
      ),
      UseShellExecute = false,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      CreateNoWindow = true
    };
    if (!String.IsNullOrWhiteSpace(cwd)) info.WorkingDirectory = cwd;
    using (var child = new Process()) {
      child.StartInfo = info;
      child.OutputDataReceived += (sender, eventArgs) => {
        if (eventArgs.Data != null) Console.Out.WriteLine(eventArgs.Data);
      };
      child.ErrorDataReceived += (sender, eventArgs) => {
        if (eventArgs.Data != null) Console.Error.WriteLine(eventArgs.Data);
      };
      try {
        if (!child.Start()) {
          throw new InvalidOperationException("target failed to start");
        }
      } catch (Exception error) {
        Console.Error.WriteLine("CREW_WINDOWS_TARGET_UNAVAILABLE:" + error.Message);
        return 71;
      }
      child.BeginOutputReadLine();
      child.BeginErrorReadLine();
      child.WaitForExit();
      child.WaitForExit();
      return child.ExitCode;
    }
  }
}
'@

try {
  if ($env:CREW_FORCE_WINDOWS_JOB_SETUP_FAIL -eq "1") {
    throw "forced Windows Job setup failure"
  }
  Add-Type -TypeDefinition $source -ErrorAction Stop
  $encoded = $env:CREWCLAW_WINDOWS_JOB_PAYLOAD
  if ([String]::IsNullOrWhiteSpace($encoded)) {
    throw "missing Windows Job payload"
  }
  $json = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($encoded)
  )
  $payload = $json | ConvertFrom-Json
  if ($null -eq $payload -or
      [String]::IsNullOrWhiteSpace([string]$payload.executable)) {
    throw "invalid Windows Job payload"
  }
  Remove-Item Env:CREWCLAW_WINDOWS_JOB_PAYLOAD -ErrorAction SilentlyContinue
  $exitCode = [CrewClawWindowsJobOwner]::Run(
    [string]$payload.executable,
    @($payload.args | ForEach-Object { [string]$_ }),
    [string]$payload.cwd
  )
  exit ([int]$exitCode)
} catch {
  [Console]::Error.WriteLine(
    "CREW_WINDOWS_JOB_UNAVAILABLE:" + $_.Exception.Message
  )
  exit 70
}
`;
const WINDOWS_JOB_OWNER_COMMAND = Buffer.from(
  WINDOWS_JOB_OWNER_PS,
  "utf16le"
).toString("base64");

function windowsJobError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function spawnWindowsJobOwner(executable, args, { cwd, env } = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      executable: String(executable),
      args: (args || []).map(value => String(value)),
      cwd: String(cwd || ""),
    }),
    "utf8"
  ).toString("base64");
  if (payload.length > 24 * 1024) {
    throw windowsJobError(
      "Windows Job 参数过长，拒绝启动未受控进程",
      "windows_job_payload_too_large"
    );
  }
  const systemRoot = String(
    process.env.SystemRoot || process.env.windir || "C:\\Windows"
  );
  const powershell = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const child = spawn(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      WINDOWS_JOB_OWNER_COMMAND,
    ],
    {
      cwd,
      env: {
        ...(env || process.env),
        [WINDOWS_JOB_PAYLOAD_ENV]: payload,
      },
      windowsHide: true,
      shell: false,
    }
  );
  child.__crewclawJobOwner = true;
  return child;
}

function processTreeTerminationError(reason) {
  const error = new Error(`无法确认进程树已终止：${reason}`);
  error.code = "process_tree_termination_failed";
  return error;
}

function terminateChildTree(child) {
  if (!child?.pid) return Promise.resolve();
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  if (child.__crewclawJobOwner) {
    return new Promise((resolveTermination, rejectTermination) => {
      if (child.exitCode !== null || child.signalCode) {
        resolveTermination();
        return;
      }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolveTermination();
      };
      const fail = reason => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        rejectTermination(processTreeTerminationError(reason));
      };
      const timer = setTimeout(
        () => fail("Windows Job owner 在 3s 内未退出"),
        3000
      );
      child.once("close", finish);
      try {
        if (
          child.kill("SIGKILL") === false &&
          child.exitCode === null &&
          !child.signalCode
        ) {
          fail("Windows Job owner 拒绝终止信号");
        }
      } catch (error) {
        fail(error?.message || String(error));
      }
    });
  }
  if (process.platform === "win32") {
    return new Promise((resolveTermination, rejectTermination) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallbackTimer);
        resolveTermination();
      };
      const fail = reason => {
        if (finished) return;
        finished = true;
        clearTimeout(fallbackTimer);
        rejectTermination(processTreeTerminationError(reason));
      };
      const directFallback = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      };
      const fallbackTimer = setTimeout(() => {
        directFallback();
        fail("taskkill 在 3s 内未确认进程树终止");
      }, 3000);
      try {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, shell: false, stdio: "ignore" }
        );
        killer.once("error", () => {
          directFallback();
          fail("无法启动 taskkill");
        });
        killer.once("close", code => {
          if (code === 0) finish();
          else {
            directFallback();
            fail(`taskkill 退出码 ${code}`);
          }
        });
      } catch (error) {
        directFallback();
        fail(error?.message || String(error));
      }
    });
  }
  // POSIX children are spawned detached below, making pid the process-group id. Killing the
  // negative id reaps package-manager/shell grandchildren as well as the direct child.
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
  return Promise.resolve();
}

// Run a shell command — prefer Git Bash on Windows (the System32 bash.exe may
// only be a WSL installer stub), otherwise use the platform shell. 30s timeout.
function runShell(command, { cwd = WORKSPACE_ROOT, signal } = {}) {
  return new Promise((resolve, reject) => {
    let out = "";
    let done = false;
    let timer;
    let activeChild = null;
    const children = new Set();
    const windowsBash =
      process.platform === "win32"
        ? [
            join(
              process.env.ProgramFiles || "C:\\Program Files",
              "Git",
              "bin",
              "bash.exe"
            ),
            process.env.LOCALAPPDATA
              ? join(
                  process.env.LOCALAPPDATA,
                  "Programs",
                  "Git",
                  "bin",
                  "bash.exe"
                )
              : "",
          ].find(candidate => candidate && existsSync(candidate))
        : null;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = s => {
      if (done) return;
      done = true;
      cleanup();
      resolve(s);
    };
    const settleAfterTermination = settle => {
      if (done) return;
      done = true;
      cleanup();
      void Promise.all(
        [...children].map(child => terminateChildTree(child))
      ).then(settle, reject);
    };
    const onAbort = () => {
      const cancellation = generationCancelledError(signal?.reason);
      settleAfterTermination(() => reject(cancellation));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const attach = (child, isFallback) => {
      activeChild = child;
      children.add(child);
      child.stdout?.on("data", d => (out += d));
      child.stderr?.on("data", d => (out += d));
      child.once("error", e => {
        children.delete(child);
        if (done || child !== activeChild) return;
        activeChild = null;
        if (process.platform === "win32") {
          done = true;
          cleanup();
          reject(
            windowsJobError(
              `Windows Job owner 无法启动：${e.message}`,
              "windows_job_unavailable"
            )
          );
        } else if (!isFallback) {
          try {
            attach(
              spawn(command, {
                shell: true,
                windowsHide: true,
                cwd,
                detached: process.platform !== "win32",
              }),
              true
            );
          } catch (err) {
            finish("（无法执行命令：" + err.message + "）");
          }
        } else {
          finish("（无法执行命令：" + e.message + "）");
        }
      });
      child.once("close", code => {
        children.delete(child);
        if (done || child !== activeChild) return;
        activeChild = null;
        if (
          process.platform === "win32" &&
          code === 70 &&
          /CREW_WINDOWS_JOB_UNAVAILABLE:/.test(out)
        ) {
          done = true;
          cleanup();
          reject(windowsJobError(out.trim(), "windows_job_unavailable"));
          return;
        }
        if (
          process.platform === "win32" &&
          code === 71 &&
          /CREW_WINDOWS_TARGET_UNAVAILABLE:/.test(out)
        ) {
          if (!isFallback) {
            out = "";
            try {
              attach(spawnShellChild(true), true);
            } catch (error) {
              done = true;
              cleanup();
              reject(error);
            }
            return;
          }
          finish(`（无法执行命令：${out.trim()}）`);
          return;
        }
        finish(out.trim().slice(0, 4000) || "（无输出）");
      });
    };
    const spawnShellChild = isFallback => {
      if (process.platform === "win32") {
        if (!isFallback && windowsBash) {
          return spawnWindowsJobOwner(windowsBash, ["-lc", command], { cwd });
        }
        const systemRoot = String(
          process.env.SystemRoot || process.env.windir || "C:\\Windows"
        );
        const commandShell =
          process.env.ComSpec || join(systemRoot, "System32", "cmd.exe");
        return spawnWindowsJobOwner(commandShell, ["/d", "/s", "/c", command], {
          cwd,
        });
      }
      return isFallback
        ? spawn(command, {
            shell: true,
            windowsHide: true,
            cwd,
            detached: true,
          })
        : spawn("bash", ["-lc", command], {
            windowsHide: true,
            cwd,
            detached: true,
          });
    };
    timer = setTimeout(() => {
      const timedOut = (out.trim() || "") + "\n（命令超时 30s，已终止）";
      settleAfterTermination(() => resolve(timedOut));
    }, 30000);
    try {
      const primaryIsFallback = process.platform === "win32" && !windowsBash;
      attach(spawnShellChild(primaryIsFallback), primaryIsFallback);
    } catch (error) {
      if (process.platform === "win32") {
        done = true;
        cleanup();
        reject(
          error?.code
            ? error
            : windowsJobError(
                `Windows Job owner 无法启动：${error.message}`,
                "windows_job_unavailable"
              )
        );
        return;
      }
      try {
        attach(spawnShellChild(true), true);
      } catch (err) {
        finish("（无法执行命令：" + err.message + "）");
      }
    }
  });
}

function runStructuredProcess(
  executable,
  args,
  {
    cwd = WORKSPACE_ROOT,
    timeoutMs = 30000,
    maxOutput = 12000,
    allowedExitCodes = [0],
    env = process.env,
    signal,
    requireWindowsJob = false,
  } = {}
) {
  return new Promise((resolveOutput, rejectOutput) => {
    let output = "";
    let truncated = false;
    let settled = false;
    let timer;
    let child;
    let jobOwner = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const append = chunk => {
      const value = String(chunk || "");
      const captureLimit = maxOutput * 2;
      const remaining = Math.max(0, captureLimit - output.length);
      if (output.length < captureLimit) {
        output += value.slice(0, remaining);
      }
      if (value.length > remaining) truncated = true;
    };
    const makeError = (message, code) => {
      const error = new Error(message);
      error.code = code;
      error.output = output.slice(0, maxOutput);
      return error;
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveOutput(
        String(value || "")
          .trim()
          .slice(0, maxOutput) + (truncated ? "\n…（输出已截断）" : "") ||
          "（无输出）"
      );
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectOutput(error);
    };
    const failAfterTermination = error => {
      if (settled) return;
      settled = true;
      cleanup();
      void terminateChildTree(child).then(
        () => rejectOutput(error),
        terminationError => rejectOutput(terminationError)
      );
    };
    const onAbort = () => {
      if (settled) return;
      failAfterTermination(generationCancelledError(signal?.reason));
    };
    if (signal?.aborted) {
      fail(generationCancelledError(signal.reason));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      jobOwner = process.platform === "win32" && requireWindowsJob;
      child = jobOwner
        ? spawnWindowsJobOwner(executable, args, { cwd, env })
        : spawn(executable, args, {
            cwd,
            windowsHide: true,
            shell: false,
            env,
            detached: process.platform !== "win32",
          });
    } catch (error) {
      fail(
        makeError(
          `无法启动结构化工具：${error.message}`,
          error?.code ||
            (jobOwner ? "windows_job_unavailable" : "tool_spawn_failed")
        )
      );
      return;
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", error =>
      fail(
        makeError(
          `结构化工具执行失败：${error.message}`,
          jobOwner ? "windows_job_unavailable" : "tool_spawn_failed"
        )
      )
    );
    child.once("close", code => {
      if (settled) return;
      if (
        jobOwner &&
        code === 70 &&
        /CREW_WINDOWS_JOB_UNAVAILABLE:/.test(output)
      ) {
        fail(
          makeError(
            `Windows Job 进程树隔离不可用：${output.trim()}`,
            "windows_job_unavailable"
          )
        );
        return;
      }
      if (allowedExitCodes.includes(code)) finish(output);
      else
        fail(
          makeError(
            `${output.trim() || executable}（进程退出码 ${code}）`,
            "tool_process_failed"
          )
        );
    });
    timer = setTimeout(() => {
      failAfterTermination(
        makeError(
          `结构化工具超时 ${Math.round(timeoutMs / 1000)}s`,
          "tool_timeout"
        )
      );
    }, timeoutMs);
  });
}

function invalidToolArguments(message) {
  const error = new Error(message);
  error.code = "invalid_tool_arguments";
  throw error;
}

function safeGitEnvironment(root) {
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
  ]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  return {
    ...env,
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_LITERAL_PATHSPECS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    GIT_CEILING_DIRECTORIES: dirname(resolve(root)),
  };
}

function checkedRepoPathspec(rawPath, root) {
  if (rawPath == null || String(rawPath).trim() === "") {
    const checkedRoot = resolvePathInsideRoot(".", root, {
      mustExist: true,
      rejectSymlinks: true,
    });
    return checkedRoot.ok
      ? { ok: true, root: checkedRoot.rootPath, pathspec: null }
      : checkedRoot;
  }
  const checked = resolvePathInsideRoot(String(rawPath), root, {
    rejectSymlinks: true,
  });
  if (!checked.ok) return checked;
  return {
    ok: true,
    root: checked.rootPath,
    pathspec: relative(checked.rootPath, checked.path).replaceAll("\\", "/"),
  };
}

function safeGitRevision(value) {
  const revision = String(value || "").trim();
  return revision && /^[A-Za-z0-9][A-Za-z0-9._/@{}^~:+-]{0,127}$/.test(revision)
    ? revision
    : null;
}

async function runGitDiff(args, root, signal) {
  const target = checkedRepoPathspec(args?.path, root);
  if (!target.ok) invalidToolArguments(`git_diff 路径无效：${target.error}`);
  const command = [
    "-C",
    target.root,
    "-c",
    "core.pager=cat",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ];
  if (args?.staged === true) command.push("--cached");
  if (args?.base != null) {
    const base = safeGitRevision(args.base);
    if (!base) invalidToolArguments("git_diff base 不是安全的 Git revision");
    command.push(base);
  }
  command.push("--");
  if (target.pathspec) command.push(target.pathspec);
  return runStructuredProcess("git", command, {
    cwd: target.root,
    timeoutMs: 15000,
    maxOutput: 16000,
    env: safeGitEnvironment(target.root),
    signal,
  });
}

async function runGitStatus(args, root, signal) {
  const target = checkedRepoPathspec(args?.path, root);
  if (!target.ok) invalidToolArguments(`git_status 路径无效：${target.error}`);
  const command = [
    "-C",
    target.root,
    "-c",
    "core.pager=cat",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "status",
    "--short",
    "--branch",
    "--untracked-files=normal",
  ];
  if (target.pathspec) command.push("--", target.pathspec);
  return runStructuredProcess("git", command, {
    cwd: target.root,
    timeoutMs: 10000,
    env: safeGitEnvironment(target.root),
    signal,
  });
}

const SAFE_TEST_SCRIPT =
  /^(?:(?:test|check|lint|typecheck|verify|validate)(?::[a-z0-9._-]+)*|ci:check)$/i;

async function runDefinedTestScript(args, root, signal) {
  const script = String(args?.script || "").trim();
  if (!SAFE_TEST_SCRIPT.test(script)) {
    invalidToolArguments(
      "test_run 只接受仓库定义的 test/check/lint/typecheck/verify/validate/ci:check 类脚本"
    );
  }
  const manifestPath = resolvePathInsideRoot("package.json", root, {
    mustExist: true,
    rejectSymlinks: true,
  });
  if (!manifestPath.ok)
    invalidToolArguments(
      `test_run 无法读取 package.json：${manifestPath.error}`
    );
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath.path, "utf8"));
  } catch (error) {
    invalidToolArguments(`test_run 无法解析 package.json：${error.message}`);
  }
  if (
    !manifest.scripts ||
    typeof manifest.scripts !== "object" ||
    typeof manifest.scripts[script] !== "string"
  ) {
    invalidToolArguments(`test_run 拒绝：package.json 未定义脚本 ${script}`);
  }
  const declaredManager = String(manifest.packageManager || "npm").split(
    "@"
  )[0];
  const manager = ["npm", "pnpm", "yarn", "bun"].includes(declaredManager)
    ? declaredManager
    : "npm";
  const executable =
    process.platform === "win32"
      ? process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe"
      : manager;
  // Windows cannot CreateProcess a .cmd shim directly. The command string remains closed: both
  // manager and script passed the allowlists above, and no model-provided arguments are accepted.
  const commandArgs =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          `${manager === "bun" ? "bun.exe" : `${manager}.cmd`} run ${script}`,
        ]
      : ["run", script];
  return runStructuredProcess(executable, commandArgs, {
    cwd: manifestPath.rootPath,
    timeoutMs: 120000,
    maxOutput: 16000,
    signal,
    requireWindowsJob: process.platform === "win32",
  });
}

// Fetch a public URL's text (GET only) so agents can answer live questions
// (weather, news, APIs). Read-only by nature, so it auto-runs without confirm.
async function webFetch(url, { extract = "", task = "", signal } = {}) {
  const currentUrl = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(currentUrl))
    return "（web_fetch 需要 http(s):// 开头的 URL）";
  throwIfGenerationCancelled(signal);
  const controller = new AbortController();
  let timedOut = false;
  const cancelFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancelFromCaller();
  else signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const res = await requestPublicText(currentUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "CrewClaw/0.18", Accept: "text/plain,*/*" },
    });
    if (!res.ok) {
      if (res.code === "response_too_large")
        return "（页面过大（>2 MiB）：请给更具体的子页面 URL。）";
      if (res.code === "redirect_limit")
        return "（web_fetch 重定向次数过多或缺少 Location）";
      return "（web_fetch 已阻止本地/内网/元数据 URL）";
    }
    const ct = res.headers.get("content-type") || "";
    let body = res.body;
    const isHtml = /html|xml/i.test(ct) || /^\s*</.test(body);
    if (isHtml) {
      const md = await htmlToMd(body, res.url);
      throwIfGenerationCancelled(signal);
      // Step 2 — WebFetchExtract: a JS-rendered shell becomes a clean requires_render
      // state (not 8000 chars of nav chrome); large pages are aux-model compressed.
      if (isJsShell({ markdown: md, html: body })) {
        return "（疑似 JS 渲染空壳：抓到的多是导航/脚本，正文缺失。requires_render —— 别再猜 URL，改用 web_search 找可读来源，或向用户申请 browser_render。）";
      }
      body = await mdToExtract(md, res.url, { extract, task, signal });
    } else {
      body = body.trim().slice(0, 8000);
    }
    if (res.status < 200 || res.status >= 300)
      return `（HTTP ${res.status}）${String(body).slice(0, 300)}`;
    return body || "（空响应）";
  } catch (e) {
    if (signal?.aborted && !timedOut) {
      throw generationCancelledError(signal.reason);
    }
    return (
      "（web_fetch 失败：" +
      (e.name === "AbortError" ? "超时 15s" : e.message) +
      "）"
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelFromCaller);
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
async function mdToExtract(md, url, { extract = "", task = "", signal } = {}) {
  throwIfGenerationCancelled(signal);
  const route = routeBySize(md.length);
  if (route === "reject")
    return "（页面过大（>2M 字符）：请给更具体的子页面 URL。）";
  return route === "full"
    ? md
    : await auxExtract(md, {
        extract,
        task,
        url,
        chunk: route === "chunk",
        signal,
      });
}

// browser.render upgrade channel (Step 3): used ONLY after requires_render. Renders
// the JS page with the configured provider (default local Playwright), then runs the
// SAME extract pipeline so the main model gets task facts, not a raw DOM.
async function webRender(url, { extract = "", signal } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u))
    return "（browser_render 需要 http(s):// 开头的 URL）";
  throwIfGenerationCancelled(signal);
  if (!(await isPublicHttpUrlAsync(u, { signal })))
    return "（browser_render 已阻止本地/内网/元数据 URL）";
  throwIfGenerationCancelled(signal);
  if (isSearchEnginePage(u))
    return "（搜索引擎结果页不渲染——请用 web_search 找来源。）";
  const r = await renderPage(u, { signal });
  throwIfGenerationCancelled(signal);
  if (!r.ok) {
    if (
      r.reason === "no_render_provider" ||
      r.reason === "playwright_not_installed"
    ) {
      return (
        "（无可用 Render Provider" +
        (r.note ? "：" + r.note : "") +
        "。否则就已有信息标 unknown，别猜。）"
      );
    }
    return "（browser_render 失败：" + (r.note || r.error || r.reason) + "）";
  }
  const md = await htmlToMd(r.html, u);
  throwIfGenerationCancelled(signal);
  return await mdToExtract(md, u, { extract, signal });
}

// Compress a long page with a cheap aux model against the task (Hermes-style size
// routing). Falls back to truncated markdown with no key / on error, so it never
// blocks the agent. Aux model is configurable (CREW_EXTRACT_MODEL), defaults to main.
async function auxExtract(
  md,
  { extract = "", task = "", url = "", chunk = false, signal } = {}
) {
  throwIfGenerationCancelled(signal);
  const apiKey = flags.mock ? "explicit-cli-mock" : process.env.ZENMUX_API_KEY;
  if (!apiKey)
    return (
      md.slice(0, 8000) +
      "\n…（正文较长已截断；给 web_fetch 传 extract 参数可让我按任务抽要点）"
    );
  const baseUrl = (
    process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.CREW_EXTRACT_MODEL ||
    process.env.HERMES_MODEL ||
    "anthropic/claude-opus-4.8";
  const page = chunk ? md.slice(0, 60000) : md;
  const sys =
    "你是网页信息抽取器：只输出对任务有用的结构化事实，保留来源线索（标题/段落/日期/价格单位/链接文字），缺失字段标 unknown，绝不编造，删掉导航/广告/页脚/样板。";
  const prompt =
    extractPrompt({ task: extract || task, fields: [] }) +
    "\n\n# 网页正文（markdown）\n" +
    page;
  try {
    const r = await callModel({
      baseUrl,
      apiKey,
      model,
      temperature: 0,
      system: sys,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      signal,
    });
    const out = String(r?.content || "").trim();
    return out
      ? `（已按任务从 ${url} 抽取要点${chunk ? "·仅前段，页面很大" : ""}）\n` +
          out
      : md.slice(0, 8000);
  } catch (error) {
    if (signal?.aborted) throw generationCancelledError(signal.reason);
    return md.slice(0, 8000) + "\n…（抽取失败，返回截断正文）";
  }
}

// Execute one tool call after the Permission Gateway has classified it. The gateway decision is
// the single authorization truth source: runTool must not reclassify a command with a second,
// weaker allow-list. `confirm` only resolves a gateway `confirm` decision.
// A search-engine result page is noise for a reader (and usually anti-scraped), so
// block web_fetch on SERPs — a stuck agent must use web_search, not scrape Bing/DDG.
function isSearchEnginePage(url) {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (/(^|\.)duckduckgo\.com$/.test(host)) return true;
    if (/(^|\.)bing\.com$/.test(host) && path.startsWith("/search"))
      return true;
    if (/(^|\.)google\.[a-z.]+$/.test(host) && path.startsWith("/search"))
      return true;
    if (/(^|\.)yandex\.[a-z.]+$/.test(host) && path.startsWith("/search"))
      return true;
    if (/(^|\.)(baidu|so)\.com$/.test(host) && path === "/s") return true;
    if (/(^|\.)sogou\.com$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

async function runTool(
  name,
  args,
  {
    confirm,
    quiet = false,
    permission = { decision: "deny", scope: "unknown", level: "L4" },
    root = WORKSPACE_ROOT,
    signal,
  } = {}
) {
  throwIfGenerationCancelled(signal);
  if (permission.decision === "deny") return "（该动作未授权：权限网关拒绝）";

  const requestApproval = async message => {
    if (permission.decision !== "confirm") return true;
    if (!confirm) return false;
    return !!(await confirm(message, {
      tool: name,
      scope: permission.scope,
      level: permission.level,
      reason: permission.reason,
    }));
  };
  // Every executable branch must cross this single gate. The Permission Gateway may strengthen
  // even a normally read-only tool to `confirm` (employee `requires_authorization` or
  // `approval: always`), so individual tool implementations must never assume their platform
  // default is sufficient authorization.
  const runApproved = async (
    message,
    operation,
    denied = `（${name} 需要人工确认；未获授权，已跳过）`
  ) => {
    if (!(await requestApproval(message))) return denied;
    throwIfGenerationCancelled(signal);
    return await operation();
  };
  if (name === "web_fetch") {
    const webFetchRequest = resolveWebFetchCapability(args);
    if (webFetchRequest.error) return `（${webFetchRequest.error}）`;
    const url = String(webFetchRequest.args?.url ?? "");
    if (isSearchEnginePage(url))
      return "（不要抓取搜索引擎结果页（duckduckgo/bing/google/百度 等）——那是噪音、常被反爬。请改用 web_search 找来源，或直接 web_fetch 官方域名的具体文章页。）";
    return await runApproved(`读取公开网页 ${url} ?`, () =>
      webFetch(url, {
        extract: webFetchRequest.args.extract,
        signal,
      })
    );
  }
  if (name === "browser_render") {
    const url = String(args?.url ?? "");
    if (!(await isPublicHttpUrlAsync(url, { signal })))
      return "（browser_render 已阻止本地/内网/元数据 URL）";
    return await runApproved(
      "使用 Browser Render 渲染 " + url + "（只读、无登录态）?",
      () => webRender(url, { extract: args?.extract, signal }),
      "（用户拒绝渲染）"
    );
  }
  if (name === "web_search") {
    const query = String(args?.query ?? "").trim();
    if (!query) invalidToolArguments("web_search 缺少 query");
    return await runApproved(
      `搜索公开网页：${query} ?`,
      async () =>
        (await webSearch(query, { recency: args?.recency, signal })).text
    );
  }
  if (name === "search") {
    const q = String(args?.query ?? "").trim();
    if (!q) invalidToolArguments("search 缺少 query");
    const checked = resolvePathInsideRoot(
      args?.path ? String(args.path) : ".",
      root,
      { mustExist: true, rejectSymlinks: true }
    );
    if (!checked.ok) invalidToolArguments(`search 路径无效：${checked.error}`);
    return await runApproved(
      `在工作区 ${String(args?.path || ".")} 中搜索 ${q} ?`,
      () =>
        runStructuredProcess(
          "rg",
          [
            "--line-number",
            "--no-heading",
            "--color",
            "never",
            "-S",
            "--",
            q,
            checked.path,
          ],
          {
            cwd: checked.rootPath,
            timeoutMs: 15000,
            maxOutput: 12000,
            allowedExitCodes: [0, 1],
            signal,
          }
        )
    );
  }
  if (name === "git_diff")
    return await runApproved("读取当前仓库差异 ?", () =>
      runGitDiff(args, root, signal)
    );
  if (name === "git_status")
    return await runApproved("读取当前仓库状态 ?", () =>
      runGitStatus(args, root, signal)
    );
  if (name === "test_run") {
    return await runApproved(
      `运行仓库脚本 ${String(args?.script || "")} ?`,
      () => runDefinedTestScript(args, root, signal),
      "（test_run 需要人工确认；未获授权，已跳过）"
    );
  }
  if (name === "bash") {
    const cmd = String(args?.command ?? "").trim();
    if (!cmd) return "（bash 缺少 command）";
    return await runApproved(
      "执行命令: " + cmd,
      () => runShell(cmd, { cwd: root, signal }),
      `（该命令需要人工确认；未获授权，已跳过）\n命令: ${cmd}`
    );
  }
  if (name === "read_file") {
    const path = String(args?.path ?? "");
    return await runApproved(
      `读取工作区文件 ${path || "(missing)"} ?`,
      async () => {
        const r = await readAnyFile(path, { root });
        throwIfGenerationCancelled(signal);
        return r.ok ? r.text : `（读取失败：${r.error}）`;
      }
    );
  }
  if (name === "edit_file" || name === "write_file") {
    const path = String(args?.path ?? "");
    const r =
      name === "edit_file"
        ? computeEdit(path, args?.old_string, args?.new_string, { root })
        : computeWrite(path, args?.content, { root });
    if (!r.ok)
      return `（${name === "edit_file" ? "编辑" : "写入"}失败：${r.error}）`;
    const diffColor = process.env.CREW_MD === "1" || !!process.stdout.isTTY;
    if (!quiet) {
      process.stdout.write(
        "\n" +
          reindent(
            diffCard(
              { path, oldText: r.oldContent, newText: r.newContent },
              { color: diffColor }
            )
          ) +
          "\n"
      );
    }
    return await runApproved(
      "应用以上改动到 " + path + " ?",
      () => {
        const w = applyWrite(path, r.newContent, { root, guard: r.guard });
        return w.ok ? `✓ 已写入 ${path}` : `（写入失败：${w.error}）`;
      },
      "（用户取消，未写入）"
    );
  }
  return `（未知工具：${name}）`;
}

function buildAgentGuide(tools) {
  const names = (tools || [])
    .map(tool => tool?.function?.name)
    .filter(name => typeof name === "string" && name);
  const available = new Set(names);
  const lines = [
    "",
    "# 工作方式（重要）",
    `本轮唯一可调用的模型工具：${names.length ? names.join("、") : "无"}。不得调用、暗示已调用或请求未列出的工具。`,
    "- 先规划：回答前先给 2–4 步短计划。",
    "- 再执行：需要真实信息时只使用上面列出的工具；能力不可用就明确标注缺口。",
    "- 后结论：只基于真实工具结果和用户输入作答；看不到的标 [placeholder]。",
  ];
  if (available.has("web_search") || available.has("web_fetch")) {
    lines.push(
      "",
      "# 联网研究纪律",
      "- 官方来源优先；关键结论给来源 URL 和置信度，查不到就写 unknown。"
    );
    if (available.has("web_search") && available.has("web_fetch")) {
      lines.push(
        "- 先用 web_search 找目标来源，再用 web_fetch 读取具体页面；不要抓取搜索引擎结果页。"
      );
    }
    if (available.has("browser_render")) {
      lines.push(
        "- 仅当 web_fetch 明确返回 requires_render 时，才申请 browser_render。"
      );
    }
  }
  if (available.has("read_file")) {
    lines.push("- 本地文件使用 read_file，路径必须在获准的工作区范围内。");
  }
  if (available.has("git_diff") || available.has("git_status")) {
    lines.push(
      "- 仓库检查使用结构化 git_diff/git_status，不要尝试拼接 shell 命令。"
    );
  }
  if (available.has("test_run")) {
    lines.push(
      "- test_run 只运行 package.json 已定义的测试、检查或 lint 脚本，并需要人工授权。"
    );
  }
  return lines.join("\n");
}

// One agent turn: plan → (optional tool calls) → answer. Streams text with
// markdown rendering, shows each tool call + result in the TUI, and loops until
// the model returns a final answer. Mutates `messages` with the full exchange.
async function agentLoop({
  baseUrl,
  apiKey,
  model,
  temperature,
  system,
  messages,
  name,
  isTTY,
  renderMd,
  confirm,
  onUsage,
  gateway,
  root = WORKSPACE_ROOT,
  onInvocation,
  onToolEvent,
  budget,
  onDelta,
  onThinking,
  tools = TOOLS,
  signal,
  callModelFn = callModel,
  runToolFn = runTool,
  mock = false,
}) {
  // Ink/sink mode: when onDelta is provided, stream text to the UI and NEVER draw to
  // stdout from here (Ink owns the screen). Every raw-renderer write below is gated on !quiet.
  const quiet = !!onDelta;
  const magenta = s => `\x1b[35m${s}\x1b[0m`;
  const cyan = s => `\x1b[36m${s}\x1b[0m`;
  const dim = s => `\x1b[2m${s}\x1b[0m`;
  const label = magenta(`${name} › `);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const today = new Date().toISOString().slice(0, 10);
  const sys =
    system +
    buildAgentGuide(tools) +
    `\n\n# 时间锚点\n今天是 ${today}。你的训练知识可能截止得更早——所以**日期/模型/事件比你印象中新，并不代表它是假的**，很可能就是真实的近期信息。HTTP 200 只证明页面可读取，不证明内容可信或域名官方；官方性只能依据任务显式声明的官方域名，关键结论仍需检查来源质量并尽量交叉验证。不要仅因日期超出认知就判成虚构；该存疑时标 [需核实]。`;
  let renderCount = 0; // browser_render is capped per task (Step 3 safety)
  // Per-agentLoop means per chat turn / formal task. Employee capability limits must reset for
  // the next task, while every logical invocation in this turn (including refused confirmations)
  // consumes one slot so a model cannot approval-spam around the bound.
  const toolCallCounts = new Map();
  // Step 5 — Budget Guard: stop flailing (cost / repeated empty search / JS shells).
  let spentPrompt = 0,
    spentCompletion = 0,
    searchEmpty = 0,
    fetchShell = 0,
    costOkd = false;

  for (let step = 0; step < 8; step++) {
    if (signal?.aborted) {
      const cancelled = new Error("generation cancelled");
      cancelled.code = "CREW_GENERATION_CANCELLED";
      throw cancelled;
    }
    if (!quiet) process.stdout.write("\n");
    let fi = 0;
    const spin =
      isTTY && !quiet
        ? setInterval(
            () =>
              process.stdout.write(
                "\r" + label + dim(frames[fi++ % frames.length] + " 思考中…")
              ),
            80
          )
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
      res = await callModelFn({
        baseUrl,
        apiKey,
        model,
        temperature,
        system: sys,
        messages,
        tools,
        stream: true,
        onDelta: d => {
          streamed += d;
          if (quiet) onDelta(d);
          else {
            begin();
            md.push(d);
          }
        },
        // v0.11 M4：思考只在 sink 模式（quiet）透传给上层；裸终端不画思考，避免污染流式正文。
        onThinking: t => {
          if (quiet) onThinking?.(t);
        },
        signal,
        mock,
      });
    } catch (error) {
      if (spin) clearInterval(spin);
      if (!quiet) {
        begin();
        md.end();
      } // clear leftover spinner + flush partial (raw mode)
      // Keep the partial answer in history so the user can say "继续" and resume
      // from where it was cut off (a timed-out turn must not lose working memory).
      if (streamed.trim())
        messages.push({
          role: "assistant",
          content: streamed.trim() + "\n\n（…上一条回答在此处被中断）",
        });
      throw error;
    }
    if (!quiet) {
      begin();
      md.end();
    }
    onUsage?.(res.usage);
    if (res.usage) {
      spentPrompt += res.usage.prompt_tokens || 0;
      spentCompletion += res.usage.completion_tokens || 0;
    }

    const { content, toolCalls } = res;
    if (toolCalls && toolCalls.length) {
      const calls = toolCalls.map(tc => ({
        ...tc,
        id: tc.id || `call-${randomUUID()}`,
      }));
      messages.push({
        role: "assistant",
        content: content || "",
        tool_calls: calls,
      });
      if (!quiet) process.stdout.write("\n");
      for (const tc of calls) {
        if (signal?.aborted) {
          const cancelled = new Error("generation cancelled");
          cancelled.code = "CREW_GENERATION_CANCELLED";
          throw cancelled;
        }
        const callId = tc.id;
        let args = {};
        let argsError = null;
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch (error) {
          argsError = error;
        }
        const toolName = tc.function.name;
        const toolBase = {
          id: callId,
          toolName,
          args,
          rawArguments: tc.function.arguments || "{}",
        };
        onToolEvent?.({
          ...toolBase,
          phase: "requested",
          action: summarizeAction({
            tool: toolName,
            args,
            status: "requested",
          }),
        });
        const t0 = Date.now();
        // Permission Gateway (PRD §13): the model declares, one gateway decides, runTool enforces
        // that exact decision. A missing injected gateway falls back to the same fail-closed policy;
        // there is never a second shell allow-list that can downgrade `confirm` to auto-run.
        let decision = argsError
          ? {
              decision: "deny",
              level: "L4",
              scope: "invalid_arguments",
              reason: `工具参数不是有效 JSON：${argsError.message}`,
              decision_source: "input_validation",
            }
          : (gateway || makeGateway({ root })).check(toolName, args);
        if (decision.decision !== "deny") {
          const maxCalls = Number(decision.limits?.max_calls_per_task);
          if (Number.isSafeInteger(maxCalls) && maxCalls > 0) {
            // Shared runtime functions (for example web_fetch) can resolve to
            // separate capabilities. Count against the selected capability, not
            // the broad function name, so a denied/limited extract alias cannot
            // consume or evade the plain-fetch allowance.
            const quotaKey = decision.capability || toolName;
            const used = toolCallCounts.get(quotaKey) || 0;
            if (used >= maxCalls) {
              decision = {
                ...decision,
                decision: "deny",
                reason: `${decision.capability || toolName} 已达到本任务最多 ${maxCalls} 次调用上限`,
                decision_source: "employee_limit",
                limit: { max_calls_per_task: maxCalls, used },
              };
            } else {
              toolCallCounts.set(quotaKey, used + 1);
            }
          }
        }
        let result;
        let executionError = null;
        let lifecycleTerminalEmitted = false;
        let forcedBlocked = false;
        if (decision.decision === "deny") {
          result = `（该动作未授权：${decision.reason}）`;
          onToolEvent?.({
            ...toolBase,
            phase: "blocked",
            decision,
            code: argsError
              ? "invalid_tool_arguments"
              : decision.decision_source === "employee_limit"
                ? "tool_call_limit_exceeded"
                : "permission_denied",
            detail: result,
          });
          lifecycleTerminalEmitted = true;
        } else if (toolName === "browser_render" && ++renderCount > 2) {
          forcedBlocked = true;
          result =
            "（本任务已渲染 2 次，达上限——继续渲染需用户确认，避免浏览器乱点烧钱。）";
          onToolEvent?.({
            ...toolBase,
            phase: "blocked",
            decision,
            code: "browser_render_limit",
            detail: result,
          });
          lifecycleTerminalEmitted = true;
        } else {
          // confirm (L2+): surface a human-readable permission request before the
          // y/n prompt that runTool itself raises. (PRD §13.2 — "讲人话".)
          if (!quiet && decision.decision === "confirm") {
            process.stdout.write(
              "\n" +
                reindent(
                  permissionRequest({
                    employeeName: name,
                    toolLabel: toolName,
                    scope: decision.scope,
                    level: decision.level,
                    reason: decision.reason,
                  }),
                  GUTTER
                ) +
                "\n"
            );
          }
          onToolEvent?.({
            ...toolBase,
            phase: "running",
            decision,
          });
          try {
            const timeoutMs = Number(decision.limits?.timeout_ms);
            result = await runToolWithDeadline(
              toolSignal =>
                runToolFn(toolName, args, {
                  confirm,
                  quiet,
                  permission: decision,
                  root,
                  signal: toolSignal,
                }),
              {
                signal,
                timeoutMs,
              }
            );
          } catch (error) {
            executionError = error;
            result = `（工具执行失败：${error?.message || error}）`;
          }
        }
        const elapsedMs = Date.now() - t0;
        const cancelled =
          !!signal?.aborted &&
          ![
            "process_tree_termination_failed",
            "tool_termination_timeout",
          ].includes(executionError?.code);
        // a denied/refused/skipped call shows as "not confirmed" in the tool line
        const skipped =
          decision.decision === "deny" ||
          forcedBlocked ||
          /^（(用户拒绝|该命令需要人工确认|test_run 需要人工确认|用户取消|非交互|该动作未授权|不要抓取|疑似)/.test(
            result
          );
        const invocation = auditRecord({
          toolName,
          capability: decision.capability,
          capabilities: decision.capabilities,
          args,
          decision: decision.decision,
          decisionSource: decision.decision_source,
          level: decision.level,
          startedAt: t0,
          endedAt: t0 + elapsedMs,
          status: cancelled
            ? "cancelled"
            : executionError
              ? "error"
              : skipped
                ? "blocked"
                : "success",
          output: result,
          error: executionError,
        });
        invocation.action = summarizeAction({
          tool: toolName,
          args,
          status: invocation.status,
          decision: invocation.decision,
        });
        invocation.call_id = callId;
        invocation.args = args;
        onInvocation?.(invocation);
        if (cancelled && !lifecycleTerminalEmitted) {
          onToolEvent?.({
            ...toolBase,
            phase: "cancelled",
            decision,
            code: "generation_cancelled",
            detail: "工具所在生成已取消",
          });
          lifecycleTerminalEmitted = true;
        } else if (executionError && !lifecycleTerminalEmitted) {
          onToolEvent?.({
            ...toolBase,
            phase: "failed",
            decision,
            code: executionError.code || "tool_execution_failed",
            detail: result,
            error: executionError.message || String(executionError),
          });
          lifecycleTerminalEmitted = true;
        } else if (!skipped && !lifecycleTerminalEmitted) {
          onToolEvent?.({
            ...toolBase,
            phase: "succeeded",
            decision,
            summary: invocation.action,
            detail: result,
          });
          lifecycleTerminalEmitted = true;
        } else if (
          !lifecycleTerminalEmitted &&
          decision.decision !== "deny" &&
          !(toolName === "browser_render" && renderCount > 2)
        ) {
          onToolEvent?.({
            ...toolBase,
            phase: "blocked",
            decision,
            code: "authorization_not_granted",
            summary: invocation.action,
            detail: result,
          });
          lifecycleTerminalEmitted = true;
        }
        if (toolName === "web_search" && /无搜索结果|没搜到/.test(result))
          searchEmpty++;
        if (
          toolName === "web_fetch" &&
          /requires_render|疑似 JS 渲染空壳/.test(result)
        )
          fetchShell++;
        // Compact one-line tool activity (opencode-style); edit/write also printed
        // a diff card from runTool above. Output is folded — only a summary shows.
        if (!quiet)
          process.stdout.write(
            GUTTER +
              toolLine(
                {
                  name: toolName,
                  command: args.command,
                  args,
                  output: result,
                  confirmed: skipped ? false : undefined,
                },
                { color: renderMd }
              ) +
              "\n"
          );
        messages.push({ role: "tool", tool_call_id: callId, content: result });
        if (cancelled) {
          const error = new Error("generation cancelled");
          error.code = "CREW_GENERATION_CANCELLED";
          throw error;
        }
      }
      if (budget) {
        const { cost } = estimateCost({
          promptTokens: spentPrompt,
          completionTokens: spentCompletion,
        });
        const stop = msg => {
          if (quiet) {
            onDelta(
              `\n\n⚠ 预算守门：${msg}\n建议：配置 search key / 授权 Browser Render / 结束并标记失败。`
            );
            return;
          }
          console.log("\n" + GUTTER + `\x1b[33m⚠ 预算守门：${msg}\x1b[0m`);
          console.log(
            GUTTER +
              "\x1b[2m   建议：配置 search key / 授权 Browser Render / 结束并标记失败。\x1b[0m"
          );
        };
        if (searchEmpty >= (budget.maxSearchEmpty ?? 2)) {
          stop("搜索连续无结果，停止瞎试。");
          return (
            content ||
            "（搜索连续无结果，已停止——请配置 Search Provider 后重试。）"
          );
        }
        if (fetchShell >= (budget.maxFetchShell ?? 2)) {
          stop("多次抓到 JS 空壳，停止猜 URL。");
          return (
            content ||
            "（多次遇到 JS 渲染页，已停止——授权 browser_render 或换可读来源。）"
          );
        }
        if (budget.costCap && cost > budget.costCap && !costOkd) {
          if (
            confirm &&
            (await confirm(
              `本任务已花 $${cost.toFixed(2)}（超预算 $${budget.costCap}），继续？`
            ))
          )
            costOkd = true;
          else {
            stop(`成本 $${cost.toFixed(2)} 超预算 $${budget.costCap}。`);
            return content || "（成本超预算，已停止。）";
          }
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
async function interactiveChat({
  agentId,
  profile,
  apiKey,
  baseUrl,
  resume,
  mock = false,
}) {
  let {
    model,
    temperature,
    system,
    skills,
    displayName,
    title,
    avatar,
    dreamPolicy,
    toolResolution,
  } = profile;
  let name = displayName || titleizeId(agentId);
  let currentAgentId = agentId;
  const cyan = s => `\x1b[36m${s}\x1b[0m`;
  const magenta = s => `\x1b[35m${s}\x1b[0m`;
  const dim = s => `\x1b[2m${s}\x1b[0m`;
  const colorOn = !!process.stdout.isTTY;

  // Ratatui (or any) front-end: headless event mode — emit TaskEvent JSONL on stdout, read
  // input lines on stdin. The Rust Ratatui workbench spawns this piped and owns the terminal.
  // MUST come before any stdout print so the JSONL stream stays clean.
  if (process.env.CREW_TUI === "ratatui") {
    const rHistory = [];
    if (resume) {
      const s = loadSession(WORKSPACE_ROOT, currentAgentId);
      if (s.ok && s.messages.length) rHistory.push(...s.messages);
    }
    const { startJsonlBridge } = await import("./tui/jsonl-bridge.mjs");
    // v0.13 M2：技能名清单进 session.ready——从 SKILL.md 原文提首个 `# ` 标题（无则 skill-N）。
    // 不动 collectSkills（buildSystemPrompt 依赖其原文形状），只在这里做展示名提取。
    const skillNames = (skills || []).map((s, i) =>
      (s.match(/^#\s+(.+)$/m)?.[1] || `skill-${i + 1}`).trim()
    );
    await startJsonlBridge({
      agentLoop,
      agentLoopDeps: {
        baseUrl,
        apiKey,
        model,
        temperature,
        system,
        name,
        isTTY: false,
        ...employeeAgentLoopDeps({ toolResolution }, WORKSPACE_ROOT),
        root: WORKSPACE_ROOT,
        confirm: async () => true,
        mock,
      },
      agentName: name,
      meta: {
        role: title,
        mode: "Chat",
        model,
        skills: skillNames,
        agentId: currentAgentId,
        avatar: avatar || [],
        dreamPolicy,
        toolCatalog: toolResolution.sessionCatalog,
        canonicalToolCatalog: TOOL_CATALOG.capabilities,
        toolCatalogVersion: TOOL_CATALOG.version,
        toolBlocking: toolResolution.blocking,
        toolDegraded: toolResolution.degraded,
        toolSurface: toolResolution.surface,
        toolGrantSource: toolResolution.grantSource,
        toolGrantWarning: toolResolution.grantWarning,
      },
      history: rHistory,
      saveSession: () => saveSession(WORKSPACE_ROOT, currentAgentId, rHistory),
      root: WORKSPACE_ROOT,
    });
    return;
  }

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
  process.once("SIGINT", () => {
    bar.dispose();
    process.exit(130);
  });
  process.once("exit", () => bar.dispose());

  console.log("");
  console.log(
    agentBadge(
      { name, title, model, skillCount: skills.length },
      { color: colorOn }
    )
  );
  console.log("");

  // Full-screen Ink UI — opt-in via CREW_TUI=ink on a real TTY (the raw renderer stays
  // the default until validated). Ink owns stdin, so branch BEFORE creating readline.
  // Model/gateway/budget logic is unchanged; agentLoop just streams to the store via a sink.
  if (
    process.env.CREW_TUI === "ink" &&
    !!process.stdout.isTTY &&
    !!process.stdin.isTTY
  ) {
    const inkHistory = [];
    if (resume) {
      const s = loadSession(WORKSPACE_ROOT, currentAgentId);
      if (s.ok && s.messages.length) inkHistory.push(...s.messages);
    }
    const { startInkChat } = await import("./tui/repl.mjs");
    await startInkChat({
      agentLoop,
      agentLoopDeps: {
        baseUrl,
        apiKey,
        model,
        temperature,
        system,
        name,
        isTTY: true,
        ...employeeAgentLoopDeps({ toolResolution }, WORKSPACE_ROOT),
        root: WORKSPACE_ROOT,
        // Ink 尚无授权 modal：任何 confirm 决策都必须 fail closed，绝不静默代用户批准。
        confirm: denyUnavailableApproval,
        mock,
      },
      history: inkHistory,
      agentName: name,
      meta: { role: title, mode: "Chat", model },
      renderLines: t => renderMessage(t),
      saveSession: () =>
        saveSession(WORKSPACE_ROOT, currentAgentId, inkHistory),
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
  rl.on("line", l => {
    queue.push(l);
    wake();
  });
  rl.on("close", () => {
    closed = true;
    wake();
  });
  const nextLine = async () => {
    if (queue.length) return queue.shift();
    if (closed) return null;
    await new Promise(res => {
      resolver = res;
    });
    return queue.length ? queue.shift() : null;
  };

  const history = [];
  if (resume) {
    const s = loadSession(WORKSPACE_ROOT, currentAgentId);
    if (s.ok && s.messages.length) {
      history.push(...s.messages);
      const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : "上次";
      console.log(
        GUTTER +
          dim(`↩ 已恢复会话（${s.messages.length} 条消息 · ${when}）`) +
          "\n"
      );
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
      const { text, action } = runCommand(line, {
        agentId: currentAgentId,
        name,
        model,
        tools: (toolResolution.visibleTools || [])
          .map(t => t.function?.name)
          .filter(Boolean),
        root: WORKSPACE_ROOT,
        color: colorOn,
      });
      if (text) console.log("\n" + text + "\n");
      if (action?.type === "exit") break;
      if (action?.type === "clear") {
        history.length = 0;
        console.log("\n" + dim("  (上下文已清空)") + "\n");
      }
      if (action?.type === "switch") {
        try {
          const np = await loadProfile(action.agent, {
            workspaceRoot: WORKSPACE_ROOT,
            env: process.env,
            surface: "chat",
          });
          const candidatePreflight = requiredToolPreflight(np.toolResolution);
          if (!candidatePreflight.ok) {
            throw new Error(candidatePreflight.reason);
          }
          // Commit only after the candidate profile and its required tools have both passed. A
          // failed switch keeps the current employee, tool policy, and conversation untouched.
          ({
            model,
            temperature,
            system,
            skills,
            displayName,
            title,
            toolResolution,
          } = np);
          name = displayName || titleizeId(action.agent);
          currentAgentId = action.agent;
          history.length = 0;
          console.log(
            "\n" +
              agentBadge(
                { name, title, model, skillCount: skills.length },
                { color: colorOn }
              ) +
              "\n"
          );
        } catch (e) {
          console.log("\n  " + dim("切换失败：" + e.message) + "\n");
        }
      }
      if (action?.type === "topbar") {
        if (!canTopBar) {
          console.log(
            "\n" + GUTTER + dim("顶部条仅在交互式终端(TTY)可用") + "\n"
          );
        } else {
          const want =
            action.value === "toggle" ? !topBarOn : action.value === "on";
          if (want && !topBarOn) {
            bar = installTopBar(topState);
            topBarOn = true;
            console.log(
              "\n" + GUTTER + dim("顶部条已开启 · 再 /topbar off 关闭") + "\n"
            );
          } else if (!want && topBarOn) {
            bar.dispose();
            bar = NOOP_BAR;
            topBarOn = false;
            console.log("\n" + GUTTER + dim("顶部条已关闭") + "\n");
          } else {
            console.log(
              "\n" +
                GUTTER +
                dim(`顶部条已${topBarOn ? "开启" : "关闭"}`) +
                "\n"
            );
          }
        }
      }
      continue;
    }

    // Auto-detect local file paths the user pasted/mentioned and eagerly read them
    // into context (Open Interpreter style), so "C:\…\deck.pptx 讲了啥" just works.
    let userContent = line;
    const attached = detectFilePaths(line, { root: WORKSPACE_ROOT });
    if (attached.length) {
      const textBlocks = [];
      const imageBlocks = [];
      for (const p of attached) {
        const tag = basename(p);
        if (isImagePath(p)) {
          const img = await readImageDataUrl(p, { root: WORKSPACE_ROOT });
          if (img.ok) {
            imageBlocks.push({
              type: "image_url",
              image_url: { url: img.dataUrl },
            });
            process.stdout.write(
              GUTTER +
                dim(`📎 已附图 ${tag} (${Math.round(img.bytes / 1024)} KB)`) +
                "\n"
            );
          } else {
            process.stdout.write(
              GUTTER + dim(`📎 图片读取失败 ${tag}：${img.error}`) + "\n"
            );
          }
        } else {
          const r = await readAnyFile(p, { root: WORKSPACE_ROOT });
          if (r.ok) {
            process.stdout.write(
              GUTTER +
                dim(
                  `📎 已读取附件 ${tag} · ${r.kind} (${r.text.split("\n").length} 行)`
                ) +
                "\n"
            );
            textBlocks.push(`【附件：${tag}】\n${r.text}`);
          } else {
            process.stdout.write(
              GUTTER + dim(`📎 读取附件失败 ${tag}：${r.error}`) + "\n"
            );
          }
        }
      }
      const textPart = textBlocks.length
        ? textBlocks.join("\n\n") + "\n\n---\n用户消息：" + line
        : line;
      if (imageBlocks.length)
        userContent = [{ type: "text", text: textPart }, ...imageBlocks];
      else if (textBlocks.length) userContent = textPart;
    }
    history.push({ role: "user", content: userContent });
    const isTTY = !!process.stdout.isTTY;
    const confirm = async msg => {
      process.stdout.write(
        "\n  " + dim("⚠ ") + msg + dim("  [回车=确认 / n=取消] ") + cyan("› ")
      );
      const ans = ((await nextLine()) ?? "").trim().toLowerCase();
      return ans === "" || ans === "y" || ans === "yes";
    };
    try {
      await agentLoop({
        baseUrl,
        apiKey,
        model,
        temperature,
        system,
        messages: history,
        name,
        isTTY,
        renderMd: isTTY || process.env.CREW_MD === "1",
        confirm,
        ...employeeAgentLoopDeps({ toolResolution }, WORKSPACE_ROOT),
        root: WORKSPACE_ROOT,
        onUsage: u => {
          if (!u) return;
          promptTok += u.prompt_tokens || 0;
          completionTok += u.completion_tokens || 0;
          if (u.prompt_tokens) lastPromptTok = u.prompt_tokens;
          bar.redraw();
        },
        mock,
      });
    } catch (error) {
      // Do NOT revert — keep the user message + partial answer in history so
      // "继续" resumes from the cut-off point (working memory must survive a timeout).
      console.error(
        "\n" +
          GUTTER +
          `\x1b[33m（回答被中断：${error.message}。说「继续」我接着写，或换个问法。）\x1b[0m` +
          "\n"
      );
    }
    if (isTTY) {
      const turns = history.filter(
        m => m.role === "assistant" && !m.tool_calls
      ).length;
      console.log(GUTTER + statusBar({ model, step: turns }, { color: true }));
    }
    saveSession(WORKSPACE_ROOT, currentAgentId, history); // persist after each turn for --resume
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
    const ans = await new Promise(res =>
      rl.question("\n" + GUTTER + "这次任务有用吗？[Y/n] ", res)
    );
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
    const ans = await new Promise(res => rl.question(question, res));
    return String(ans).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

function printSearchKeyHelp() {
  console.log(
    "\n" + GUTTER + "配置搜索 Provider（任选其一，Tavily 免费最省事）："
  );
  console.log(
    GUTTER +
      "  · Tavily（免费 1000/月，免信用卡）：tavily.com 拿 key → setx TAVILY_API_KEY tvly-xxxx"
  );
  console.log(GUTTER + "  · 或 SERPER_API_KEY / BRAVE_API_KEY");
  console.log(GUTTER + "  配好后重跑：crew run <agent> --task <id>\n");
}

function createTaskModeActionReader({ emit, root, resolveArtifact }) {
  const approvals = new Map();
  const rl = createInterface({ input: process.stdin });
  let closed = false;
  let closeReason = "input_eof";

  const settle = (id, result) => {
    const pending = approvals.get(id);
    if (!pending) return false;
    approvals.delete(id);
    pending.resolve(result);
    return true;
  };

  const interruptAll = () => {
    closed = true;
    for (const [id] of approvals) {
      settle(id, {
        accepted: false,
        interrupted: true,
        reason: closeReason,
      });
    }
  };
  rl.once("close", interruptAll);

  rl.on("line", raw => {
    const plain = String(raw || "")
      .trim()
      .toLowerCase();
    if (plain === "/exit" || plain === ":q") {
      closeReason = "user_exit";
      rl.close();
      return;
    }
    let action;
    try {
      action = parseUserActionLine(raw);
    } catch (error) {
      emit("debug.line", {
        line: `user action parse error: ${String(error?.message || error)}`,
      });
      return;
    }
    if (!action) return;

    // Legacy task-mode clients may still send a bare a/r/y/n decision. Only consume it when
    // exactly one approval is pending; otherwise it remains ordinary user input.
    if (approvals.size === 1) {
      const [[id, pending]] = approvals;
      const allow = ["a", "accept", "allow", "y", "yes", "是"].includes(plain);
      const deny = ["r", "reject", "deny", "d", "n", "no", "否"].includes(
        plain
      );
      if (allow || deny) {
        if (allow && pending.kind === "deliverable_acceptance") {
          emit("debug.line", {
            line: `structured approval.resolve required for ${id}`,
          });
          return;
        }
        settle(id, {
          accepted: allow,
          interrupted: false,
          decision: allow
            ? "accept"
            : pending.kind === "deliverable_acceptance"
              ? "revise"
              : "deny",
        });
        return;
      }
    }

    const applied = applyUserAction(action, {
      emit,
      root,
      resolveArtifact,
    });
    if (action.type === "approval.resolve") {
      if (applied.invalidDecision) {
        emit("debug.line", {
          line: `invalid approval decision for ${action.data?.id || "unknown"}`,
        });
        return;
      }
      const id = action.data?.id;
      const pending = approvals.get(id);
      if (pending && action.data?.kind && action.data.kind !== pending.kind) {
        emit("debug.line", {
          line: `approval kind mismatch for ${id}`,
        });
        return;
      }
      settle(id, {
        accepted: applied.approval === true,
        interrupted: false,
        decision: applied.approval === true ? "accept" : "reject",
        approvalId: id,
        kind: pending?.kind || action.data?.kind || null,
        source: "approval.resolve",
        decisionAt: Date.now(),
      });
      return;
    }
    if (action.type === "artifact.delete" && applied.ok === true) {
      for (const [id, pending] of approvals) {
        if (
          pending.kind === "deliverable_acceptance" &&
          pending.artifactId ===
            (action.data?.artifact_id ||
              action.data?.artifactId ||
              action.data?.id)
        ) {
          settle(id, {
            accepted: false,
            interrupted: false,
            decision: "artifact_deleted",
          });
        }
      }
    }
    if (!applied.handled) {
      emit("debug.line", {
        line: `user action routed: ${action.type} ${applied.text || ""}`.trim(),
      });
    }
  });

  return {
    waitForApproval(
      id,
      { kind = "deliverable_acceptance", artifactId = null } = {}
    ) {
      if (closed) {
        return Promise.resolve({
          accepted: false,
          interrupted: true,
          reason: closeReason,
        });
      }
      if (approvals.has(id)) {
        return Promise.resolve({
          accepted: false,
          interrupted: true,
          reason: "duplicate_approval_id",
        });
      }
      return new Promise(resolve =>
        approvals.set(id, { resolve, kind, artifactId })
      );
    },
    close(reason = "runtime_complete") {
      closeReason = reason;
      rl.close();
    },
  };
}

function restoreRunSnapshot(run, snapshot) {
  for (const key of Object.keys(run)) delete run[key];
  Object.assign(run, snapshot);
}

function transitionTaskRunDurably(run, nextState, patch = {}) {
  const snapshot = structuredClone(run);
  try {
    transition(run, nextState);
    Object.assign(run, patch);
    const saved = saveTaskRun(WORKSPACE_ROOT, run);
    if (!saved.ok) {
      restoreRunSnapshot(run, snapshot);
      return {
        ok: false,
        code: "task_state_not_persisted",
        reason: saved.error || "TaskRun 状态无法持久化",
      };
    }
    return { ok: true, path: saved.path };
  } catch (error) {
    restoreRunSnapshot(run, snapshot);
    return {
      ok: false,
      code: "task_state_transition_failed",
      reason: error?.message || String(error),
    };
  }
}

function emitTaskApprovalRequested(taskSink, pending) {
  taskSink.emitRaw("approval.requested", {
    id: pending.approvalId,
    kind: "deliverable_acceptance",
    taskRunId: pending.taskRunId,
    artifacts: [
      {
        id: pending.artifact.id,
        path: pending.artifact.path,
        status: "ready",
        fingerprint: pending.fingerprint,
      },
    ],
    reason: "任务已产出交付物，请接受，或要求修订。",
  });
}

function emitRecoverableTaskBlock(taskSink, pending, reason, reasonCode) {
  taskSink.emitRaw("task.blocked", {
    id: pending.taskRunId,
    taskRunId: pending.taskRunId,
    status: "approval_interrupted",
    recoverable: true,
    reason,
    reason_code: reasonCode,
  });
}

function emitPendingApprovalRecoveryBlock(
  taskSink,
  {
    taskRunId,
    employeeId,
    requestedTaskId,
    code,
    reason,
    taskRunIds,
    started = false,
  }
) {
  const fallbackId = `pending-recovery-${String(
    employeeId || "employee"
  ).replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  )}-${String(requestedTaskId || "task").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const id = taskRunId || fallbackId;
  if (!started) {
    taskSink.taskStarted({
      id,
      title: `待验收恢复已阻塞：${requestedTaskId || "unknown task"}`,
    });
  }
  taskSink.emitRaw("task.blocked", {
    id,
    taskRunId: id,
    status: "approval_recovery_blocked",
    recoverable: false,
    reason,
    reason_code: code,
    ...(Array.isArray(taskRunIds)
      ? { candidate_task_run_ids: taskRunIds }
      : {}),
  });
}

function removeUncommittedTaskProofPack(taskRunId) {
  const safeTaskRunId = String(taskRunId || "unknown").replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );
  const path = join(
    WORKSPACE_ROOT,
    ".crewclaw",
    "runs",
    `${safeTaskRunId}.proofpack.json`
  );
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }
  return true;
}

function failTaskModeDelivery({ run, pending, taskSink, code, reason }) {
  const persisted = transitionTaskRunDurably(run, "failed", {
    pending_approval: null,
    memory_commit: null,
    failure: { code, reason, at: new Date().toISOString() },
  });
  if (!persisted.ok) {
    emitRecoverableTaskBlock(
      taskSink,
      pending,
      `验收失败且任务状态无法持久化：${persisted.reason}`,
      persisted.code
    );
    return { ok: false, recoverable: true };
  }
  removeUncommittedTaskProofPack(pending.taskRunId);
  removePendingTaskApproval(WORKSPACE_ROOT, pending.taskRunId);
  taskSink.emitRaw("approval.rejected", {
    id: pending.approvalId,
    taskRunId: pending.taskRunId,
    kind: "deliverable_acceptance",
    decision: "reject",
    reason_code: code,
    reason,
  });
  taskSink.emitRaw("task.failed", {
    id: pending.taskRunId,
    taskRunId: pending.taskRunId,
    status: "failed",
    reason,
    reason_code: code,
  });
  return { ok: false, recoverable: false };
}

function taskModeProofPack(decisionRecord) {
  const frozen = decisionRecord.decision.settlement.snapshot;
  const run = frozen.run;
  const pending = frozen.pending;
  return assembleProofPack({
    task_run_id: run.id,
    plan: run.plan || null,
    timeline_events: run.events,
    tool_calls: run.tool_invocations,
    artifacts: [
      {
        id: pending.artifact.id,
        path: pending.artifact.path,
        fingerprint: pending.fingerprint,
      },
    ],
    evidence: frozen.evidence,
    outcome_checks: [
      {
        valid: true,
        deliverable: pending.artifact.path,
        fingerprint: pending.fingerprint,
      },
    ],
    approval: {
      id: pending.approvalId,
      kind: "deliverable_acceptance",
      decision: "accept",
      // The immutable decision receipt owns this timestamp. Retries therefore reproduce the
      // exact same ProofPack instead of substituting process/recovery time.
      at: new Date(decisionRecord.decision.decisionAt).toISOString(),
    },
    usage: pending.usage,
  });
}

function commitAcceptedTaskMemory({ run, decisionRecord, taskSink }) {
  if (run?.status !== "accepted") {
    return {
      ok: false,
      code: "memory_commit_before_acceptance",
      reason: "任务尚未验收，拒绝提交任务记忆",
    };
  }

  const commit = run.memory_commit;
  const frozenCommit =
    decisionRecord?.decision?.settlement?.snapshot?.run?.memory_commit ||
    commit;
  if (!commit || commit.committed === true)
    return { ok: true, committed: false };
  if (
    !frozenCommit ||
    !isDeepStrictEqual(commit.candidates, frozenCommit.candidates) ||
    commit.lessons !== frozenCommit.lessons
  ) {
    return {
      ok: false,
      code: "memory_commit_settlement_mismatch",
      reason: "TaskRun 的记忆候选不等于 accept 决策冻结快照",
    };
  }
  const candidates = frozenCommit.candidates;
  const snapshot = structuredClone(run);
  let learned = 0;
  const errors = [];
  for (const candidate of candidates) {
    const saved = addMemory(WORKSPACE_ROOT, run.employee_id, candidate);
    if (saved.ok && !saved.skipped) learned++;
    if (!saved.ok && !saved.skipped) {
      errors.push(saved.error || "memory write failed");
    }
  }

  // A partial write is safe to retry because addMemory is lock-protected and deduplicates by
  // category/text. Do not mark the batch committed until every recordable candidate has either
  // been persisted or was intentionally skipped by policy.
  if (errors.length > 0) {
    for (const error of errors) {
      taskSink?.emitRaw("debug.line", {
        line: `memory not persisted: ${error}`,
      });
    }
    return {
      ok: false,
      code: "memory_candidate_not_persisted",
      reason: errors.join("; "),
      learned,
      errors,
    };
  }

  run.memory_commit = {
    ...structuredClone(frozenCommit),
    committed: true,
    committed_at: new Date().toISOString(),
    learned,
    errors,
  };
  run.updated_at = new Date().toISOString();
  const persisted = saveTaskRun(WORKSPACE_ROOT, run);
  if (!persisted.ok) {
    restoreRunSnapshot(run, snapshot);
    return {
      ok: false,
      code: "memory_commit_state_not_persisted",
      reason: persisted.error || "记忆提交状态无法持久化",
    };
  }

  if (learned > 0 || Number(commit.lessons || 0) > 0) {
    taskSink?.memorySaved({
      learned,
      lessons: Number(commit.lessons || 0),
      taskRunId: run.id,
    });
  }
  return { ok: true, committed: true, learned, errors };
}

function taskAcceptanceDecisionReference(decisionRecord, pending) {
  return {
    receipt: decisionRecord.path,
    approval_id: pending.approvalId,
    decision: "accept",
    decision_at: decisionRecord.decision.decisionAt,
    artifact_sha256: pending.fingerprint.sha256,
    settlement_sha256: decisionRecord.decision.settlement.sha256,
  };
}

function acceptedRunBindsDecision(run, decisionRecord, pending) {
  const expected = taskAcceptanceDecisionReference(decisionRecord, pending);
  return (
    run.approval_decision?.receipt === expected.receipt &&
    run.approval_decision?.approval_id === expected.approval_id &&
    run.approval_decision?.decision === expected.decision &&
    run.approval_decision?.decision_at === expected.decision_at &&
    run.approval_decision?.artifact_sha256 === expected.artifact_sha256 &&
    run.approval_decision?.settlement_sha256 === expected.settlement_sha256
  );
}

function emitTaskSettlementBlock(taskSink, pending, result) {
  taskSink.emitRaw("task.blocked", {
    id: pending.taskRunId,
    taskRunId: pending.taskRunId,
    status: "approval_recovery_blocked",
    recoverable: result.recoverable === true,
    reason: result.reason,
    reason_code: result.code,
  });
}

function verifyCurrentTaskSettlement({ run, pending, decisionRecord }) {
  const evidence = loadEvidence(WORKSPACE_ROOT, pending.taskRunId);
  if (!evidence.ok) {
    return {
      ok: false,
      code: "task_accept_settlement_evidence_unavailable",
      reason: `无法安全读取验收 evidence：${evidence.error || "unknown error"}`,
    };
  }
  const binding = verifyTaskApprovalDecisionBinding(
    decisionRecord.decision,
    pending,
    { run, evidence: evidence.cards }
  );
  return binding.ok ? { ok: true, evidence: evidence.cards } : binding;
}

function completeAcceptedTaskModeDelivery({
  run,
  pending,
  decisionRecord,
  taskSink,
}) {
  if (!new Set(["delivered", "accepted"]).has(run.status)) {
    return {
      ok: false,
      code: "invalid_acceptance_state",
      reason: `任务状态为 ${run.status}，不能执行接受结算`,
      recoverable: false,
      run,
    };
  }
  if (
    run.status === "accepted" &&
    !acceptedRunBindsDecision(run, decisionRecord, pending)
  ) {
    return {
      ok: false,
      code: "task_accept_state_decision_mismatch",
      reason: "TaskRun 的 accepted 状态没有绑定同一份不可变验收决策回执",
      recoverable: false,
      run,
    };
  }

  const settlement = verifyCurrentTaskSettlement({
    run,
    pending,
    decisionRecord,
  });
  if (!settlement.ok) {
    return { ...settlement, recoverable: false, run };
  }

  const pack = taskModeProofPack(decisionRecord);
  const persistedPack = persistProofPackDurably({
    root: WORKSPACE_ROOT,
    taskRunId: run.id,
    pack,
  });
  if (!persistedPack.ok) {
    if (run.status === "delivered") {
      return {
        ...failTaskModeDelivery({
          run,
          pending,
          taskSink,
          code: persistedPack.code || "proofpack_not_persisted",
          reason: persistedPack.reason || "ProofPack 无法持久化",
        }),
        emitted: true,
        run,
      };
    }
    return {
      ok: false,
      code: persistedPack.code || "proofpack_not_persisted",
      reason: persistedPack.reason || "ProofPack 无法持久化",
      recoverable: true,
      run,
    };
  }
  if (run.status === "accepted" && run.proofpack !== persistedPack.path) {
    return {
      ok: false,
      code: "task_accept_proofpack_mismatch",
      reason: "TaskRun 的 accepted 状态未绑定相同的 ProofPack",
      recoverable: false,
      run,
    };
  }

  const after = verifyPendingTaskApprovalBinding(WORKSPACE_ROOT, pending, run);
  if (!after.ok) {
    if (run.status === "delivered") {
      try {
        unlinkSync(persistedPack.path);
      } catch {
        // The terminal TaskRun still prevents this uncommitted pack from being announced.
      }
      return {
        ...failTaskModeDelivery({
          run,
          pending,
          taskSink,
          code: after.code,
          reason: after.reason,
        }),
        emitted: true,
        run,
      };
    }
    return { ...after, recoverable: false, run };
  }
  if (
    run.status === "accepted" &&
    (after.artifact?.accepted !== true || after.artifact?.status !== "accepted")
  ) {
    return {
      ok: false,
      code: "task_accept_artifact_state_mismatch",
      reason: "TaskRun 声称已 accepted，但交付物元数据尚未标记为 accepted",
      recoverable: false,
      run,
    };
  }

  if (run.status === "delivered") {
    const marked = markAccepted(WORKSPACE_ROOT, pending.artifact.id);
    if (!marked.ok) {
      return {
        ok: false,
        code: "artifact_acceptance_not_persisted",
        reason: `交付物状态无法持久化：${marked.error || "unknown error"}`,
        recoverable: true,
        run,
      };
    }
    const saved = transitionTaskRunDurably(run, "accepted", {
      pending_approval: null,
      approval_decision: taskAcceptanceDecisionReference(
        decisionRecord,
        pending
      ),
      proofpack: persistedPack.path,
      user_feedback: "useful",
      effective: run.degraded !== true,
      memory_commit: structuredClone(
        decisionRecord.decision.settlement.snapshot.run.memory_commit
      ),
    });
    if (!saved.ok) {
      return { ...saved, recoverable: true, run };
    }
  }

  const memory = commitAcceptedTaskMemory({ run, decisionRecord, taskSink });
  if (!memory.ok) {
    return {
      ...memory,
      reason: `验收已记录，但记忆提交状态无法持久化：${memory.reason}`,
      recoverable: true,
      run,
    };
  }

  // M1（条件式 Dream）：TUI 验收终态落不可变 Reflect（幂等——崩溃重放同 id 内容一致=no-op）。
  try {
    const settledEvidence = loadEvidence(WORKSPACE_ROOT, run.id);
    const reflection = buildReflection(run, {
      evidenceIds: settledEvidence.ok
        ? settledEvidence.cards.map(c => c.id).filter(Boolean)
        : [],
      legacyCommitted: run.memory_commit?.committed === true,
      createdAt: new Date().toISOString(),
    });
    writeReflection(WORKSPACE_ROOT, reflection);
  } catch (error) {
    taskSink?.emitRaw("debug.line", {
      line: `reflect skipped: ${error?.message ?? error}`,
    });
  }

  const removed = removePendingTaskApproval(WORKSPACE_ROOT, pending.taskRunId);
  if (!removed.ok) {
    taskSink.emitRaw("debug.line", {
      line: `${removed.code}: ${removed.reason}`,
    });
  }
  taskSink.emitRaw("artifact.updated", {
    id: pending.artifact.id,
    taskRunId: pending.taskRunId,
    patch: { status: "accepted", accepted: true },
  });
  taskSink.emitRaw("approval.accepted", {
    id: pending.approvalId,
    taskRunId: pending.taskRunId,
    kind: "deliverable_acceptance",
    proofpack: persistedPack.path,
    decision_at: decisionRecord.decision.decisionAt,
  });
  taskSink.taskCompleted({
    id: pending.taskRunId,
    artifactId: pending.artifact.id,
    deliverable: pending.artifact.path,
    ...(pending.reportPath && existsSync(pending.reportPath)
      ? { reportPath: pending.reportPath }
      : {}),
  });
  return { ok: true, run };
}

function acceptTaskModeDelivery({ run, pending, taskSink, result = null }) {
  const settled = withTaskSettlementLock(
    WORKSPACE_ROOT,
    pending.taskRunId,
    () => {
      const loadedRun = loadTaskRun(WORKSPACE_ROOT, pending.taskRunId);
      if (!loadedRun.ok) {
        return {
          ok: false,
          code: "task_accept_run_missing",
          reason: "验收结算时无法重新加载 TaskRun",
          recoverable: false,
        };
      }
      const freshRun = loadedRun.run;
      const loadedPending = loadPendingTaskApproval(
        WORKSPACE_ROOT,
        pending.taskRunId
      );
      if (!loadedPending.ok) return { ...loadedPending, run: freshRun };
      const freshPending = loadedPending.pending || pending;
      if (!loadedPending.pending && freshRun.status !== "accepted") {
        return {
          ok: false,
          code: "task_accept_pending_missing",
          reason: "任务仍未 accepted，但待验收回执已不存在",
          recoverable: false,
          run: freshRun,
        };
      }

      const binding = verifyPendingTaskApprovalBinding(
        WORKSPACE_ROOT,
        freshPending,
        freshRun
      );
      if (!binding.ok) {
        if (freshRun.status === "delivered" && loadedPending.pending) {
          return {
            ...failTaskModeDelivery({
              run: freshRun,
              pending: freshPending,
              taskSink,
              code: binding.code,
              reason: binding.reason,
            }),
            emitted: true,
            run: freshRun,
          };
        }
        return { ...binding, recoverable: false, run: freshRun };
      }

      let loadedDecision = loadTaskApprovalDecision(
        WORKSPACE_ROOT,
        freshPending.taskRunId
      );
      if (!loadedDecision.ok) return { ...loadedDecision, run: freshRun };
      if (!loadedDecision.decision) {
        const genuineResolve =
          result?.accepted === true &&
          result.source === "approval.resolve" &&
          result.approvalId === freshPending.approvalId &&
          result.kind === "deliverable_acceptance" &&
          result.decision === "accept" &&
          Number.isSafeInteger(result.decisionAt) &&
          result.decisionAt >= freshPending.createdAt;
        if (!genuineResolve) {
          return {
            ok: false,
            code: "task_accept_decision_missing",
            reason:
              "没有与本次 approval.resolve accept 对应的不可变验收决策回执",
            recoverable: freshRun.status === "delivered",
            run: freshRun,
          };
        }
        const evidence = loadEvidence(WORKSPACE_ROOT, freshPending.taskRunId);
        if (!evidence.ok) {
          return {
            ok: false,
            code: "task_accept_settlement_evidence_unavailable",
            reason: `无法冻结验收 evidence：${evidence.error || "unknown error"}`,
            recoverable: true,
            run: freshRun,
          };
        }
        const persistedDecision = persistTaskApprovalDecision(
          WORKSPACE_ROOT,
          freshPending,
          {
            decisionAt: result.decisionAt,
            run: freshRun,
            evidence: evidence.cards,
          }
        );
        if (!persistedDecision.ok) {
          return { ...persistedDecision, recoverable: true, run: freshRun };
        }
        loadedDecision = {
          ok: true,
          path: persistedDecision.path,
          decision: persistedDecision.decision,
        };
      }

      const currentSettlement = verifyCurrentTaskSettlement({
        run: freshRun,
        pending: freshPending,
        decisionRecord: loadedDecision,
      });
      if (!currentSettlement.ok) {
        return {
          ...currentSettlement,
          recoverable: false,
          run: freshRun,
        };
      }
      return completeAcceptedTaskModeDelivery({
        run: freshRun,
        pending: freshPending,
        decisionRecord: loadedDecision,
        taskSink,
      });
    }
  );

  if (settled.run) restoreRunSnapshot(run, settled.run);
  if (!settled.ok && !settled.emitted) {
    emitTaskSettlementBlock(taskSink, pending, settled);
  }
  return settled;
}

function reviseTaskModeDelivery({ run, pending, taskSink, reasonCode }) {
  const reason =
    reasonCode === "artifact_deleted"
      ? "用户删除了待验收交付物，需要重新生成"
      : "用户要求修订交付物";
  const saved = transitionTaskRunDurably(run, "revision_needed", {
    pending_approval: null,
    memory_commit: null,
    revision_reason: reason,
  });
  if (!saved.ok) {
    emitRecoverableTaskBlock(
      taskSink,
      pending,
      `修订状态无法持久化：${saved.reason}`,
      saved.code
    );
    return { ok: false, recoverable: true };
  }
  removeUncommittedTaskProofPack(pending.taskRunId);
  removePendingTaskApproval(WORKSPACE_ROOT, pending.taskRunId);
  taskSink.emitRaw("approval.rejected", {
    id: pending.approvalId,
    taskRunId: pending.taskRunId,
    kind: "deliverable_acceptance",
    decision: "reject",
    reason_code: reasonCode || "revision_requested",
    reason,
  });
  taskSink.emitRaw("task.revision_needed", {
    id: pending.taskRunId,
    taskRunId: pending.taskRunId,
    status: "revision_needed",
    reason,
  });
  return { ok: true };
}

function cancelTaskModeDelivery({ run, pending, taskSink }) {
  const reason = "用户退出，待验收任务已取消";
  const saved = transitionTaskRunDurably(run, "rejected", {
    pending_approval: null,
    memory_commit: null,
  });
  if (!saved.ok) {
    emitRecoverableTaskBlock(
      taskSink,
      pending,
      `取消状态无法持久化：${saved.reason}`,
      saved.code
    );
    return { ok: false, recoverable: true };
  }
  removeUncommittedTaskProofPack(pending.taskRunId);
  removePendingTaskApproval(WORKSPACE_ROOT, pending.taskRunId);
  taskSink.emitRaw("approval.rejected", {
    id: pending.approvalId,
    taskRunId: pending.taskRunId,
    kind: "deliverable_acceptance",
    decision: "reject",
    reason_code: "user_exit",
    reason,
  });
  taskSink.taskRejected({
    id: pending.taskRunId,
    status: "rejected",
    reason,
  });
  return { ok: true };
}

function taskPendingIdentityMatchesRun(pending, run) {
  return (
    run.id === pending.taskRunId &&
    run.employee_id === pending.employeeId &&
    run.requested_task_id === pending.requestedTaskId &&
    run.user_goal === pending.goal &&
    run.artifact === pending.artifact.id
  );
}

function settleNonAcceptedTaskModeDelivery({ run, pending, taskSink, result }) {
  const settled = withTaskSettlementLock(
    WORKSPACE_ROOT,
    pending.taskRunId,
    () => {
      const loadedRun = loadTaskRun(WORKSPACE_ROOT, pending.taskRunId);
      if (!loadedRun.ok) {
        return {
          ok: false,
          code: "task_settlement_run_missing",
          reason: "任务结算时无法重新加载 TaskRun",
          recoverable: false,
        };
      }
      const freshRun = loadedRun.run;
      const loadedPending = loadPendingTaskApproval(
        WORKSPACE_ROOT,
        pending.taskRunId
      );
      if (!loadedPending.ok) return { ...loadedPending, run: freshRun };
      const freshPending = loadedPending.pending || pending;

      if (freshRun.status === "accepted") {
        const runBinding = verifyPendingTaskApprovalBinding(
          WORKSPACE_ROOT,
          freshPending,
          freshRun
        );
        if (!runBinding.ok) return { ...runBinding, run: freshRun };
        const loadedDecision = loadTaskApprovalDecision(
          WORKSPACE_ROOT,
          freshPending.taskRunId
        );
        if (!loadedDecision.ok) return { ...loadedDecision, run: freshRun };
        if (!loadedDecision.decision) {
          return {
            ok: false,
            code: "task_accept_decision_missing",
            reason: "accepted TaskRun 缺少不可变验收决策回执",
            recoverable: false,
            run: freshRun,
          };
        }
        const decisionBinding = verifyCurrentTaskSettlement({
          run: freshRun,
          pending: freshPending,
          decisionRecord: loadedDecision,
        });
        if (!decisionBinding.ok) {
          return { ...decisionBinding, run: freshRun };
        }
        if (!acceptedRunBindsDecision(freshRun, loadedDecision, freshPending)) {
          return {
            ok: false,
            code: "task_accept_state_decision_mismatch",
            reason: "accepted TaskRun 未绑定同一份不可变验收决策回执",
            recoverable: false,
            run: freshRun,
          };
        }
        return {
          ok: false,
          code: "task_settlement_already_accepted",
          reason: "另一进程已持久化 accept，当前旧决策不能覆盖 accepted 状态",
          recoverable: false,
          run: freshRun,
        };
      }
      if (freshRun.status !== "delivered") {
        return {
          ok: false,
          code: "task_settlement_already_terminal",
          reason: `另一进程已将任务结算为 ${freshRun.status}`,
          recoverable: false,
          run: freshRun,
        };
      }
      if (!loadedPending.pending) {
        return {
          ok: false,
          code: "task_settlement_pending_missing",
          reason: "任务仍为 delivered，但待验收回执已不存在",
          recoverable: false,
          run: freshRun,
        };
      }
      if (!taskPendingIdentityMatchesRun(freshPending, freshRun)) {
        return {
          ok: false,
          code: "task_settlement_binding_mismatch",
          reason: "锁内重载的待验收回执与 TaskRun 身份不一致",
          recoverable: false,
          run: freshRun,
        };
      }

      const loadedDecision = loadTaskApprovalDecision(
        WORKSPACE_ROOT,
        freshPending.taskRunId
      );
      if (!loadedDecision.ok) return { ...loadedDecision, run: freshRun };
      if (loadedDecision.decision) {
        const decisionBinding = verifyCurrentTaskSettlement({
          run: freshRun,
          pending: freshPending,
          decisionRecord: loadedDecision,
        });
        if (!decisionBinding.ok) {
          return { ...decisionBinding, run: freshRun };
        }
        return {
          ok: false,
          code: "task_settlement_accept_decided",
          reason: "accept 决策已经持久化，旧的拒绝或中断不能撤销该决策",
          recoverable: true,
          run: freshRun,
        };
      }

      if (result?.interrupted === true) {
        if (result.reason === "user_exit") {
          return {
            ...cancelTaskModeDelivery({
              run: freshRun,
              pending: freshPending,
              taskSink,
            }),
            emitted: true,
            run: freshRun,
          };
        }
        taskSink.emitRaw("approval.rejected", {
          id: freshPending.approvalId,
          taskRunId: freshPending.taskRunId,
          kind: "deliverable_acceptance",
          decision: "reject",
          recoverable: true,
          reason_code: result.reason || "input_eof",
          reason: "验收输入中断，待验收状态已持久化，可在下次启动恢复",
        });
        emitRecoverableTaskBlock(
          taskSink,
          freshPending,
          "验收输入中断，待验收状态已持久化，可在下次启动恢复",
          result.reason || "input_eof"
        );
        return {
          ok: false,
          code: result.reason || "input_eof",
          reason: "验收输入中断，待验收状态已持久化，可在下次启动恢复",
          recoverable: true,
          emitted: true,
          run: freshRun,
        };
      }
      return {
        ...reviseTaskModeDelivery({
          run: freshRun,
          pending: freshPending,
          taskSink,
          reasonCode: result?.decision || "revision_requested",
        }),
        emitted: true,
        run: freshRun,
      };
    }
  );

  if (settled.run) restoreRunSnapshot(run, settled.run);
  if (!settled.ok && !settled.emitted) {
    emitTaskSettlementBlock(taskSink, pending, settled);
  }
  return settled;
}

function settleTaskModeDelivery({ run, pending, taskSink, result }) {
  if (result?.accepted === true) {
    return acceptTaskModeDelivery({ run, pending, taskSink, result });
  }
  return settleNonAcceptedTaskModeDelivery({
    run,
    pending,
    taskSink,
    result,
  });
}

async function recoverTaskModeApproval({
  agentId,
  requestedTaskId,
  taskSink,
  actionReader,
  artifacts,
}) {
  const found = findPendingTaskApproval(WORKSPACE_ROOT, {
    employeeId: agentId,
    requestedTaskId,
  });
  if (!found.ok) {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: found.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: found.code,
      reason: found.reason,
      taskRunIds: found.taskRunIds,
    });
    return true;
  }
  const pending = found.pending;
  if (!pending) return false;

  const loaded = loadTaskRun(WORKSPACE_ROOT, pending.taskRunId);
  taskSink.taskStarted({
    id: pending.taskRunId,
    title: `恢复待验收任务：${pending.goal || requestedTaskId}`,
  });
  if (!loaded.ok) {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: pending.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: "pending_approval_run_missing",
      reason: "待验收 TaskRun 记录缺失，无法安全恢复",
      started: true,
    });
    return true;
  }
  const run = loaded.run;
  const binding = verifyPendingTaskApprovalBinding(
    WORKSPACE_ROOT,
    pending,
    run
  );
  if (!binding.ok) {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: pending.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: binding.code,
      reason: binding.reason,
      started: true,
    });
    return true;
  }
  const loadedDecision = loadTaskApprovalDecision(
    WORKSPACE_ROOT,
    pending.taskRunId
  );
  if (!loadedDecision.ok) {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: pending.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: loadedDecision.code,
      reason: loadedDecision.reason,
      started: true,
    });
    return true;
  }
  if (loadedDecision.decision) {
    const decisionBinding = verifyCurrentTaskSettlement({
      run,
      pending,
      decisionRecord: loadedDecision,
    });
    if (!decisionBinding.ok) {
      emitPendingApprovalRecoveryBlock(taskSink, {
        taskRunId: pending.taskRunId,
        employeeId: agentId,
        requestedTaskId,
        code: decisionBinding.code,
        reason: decisionBinding.reason,
        started: true,
      });
      return true;
    }
  }
  if (run.status === "accepted" && !loadedDecision.decision) {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: pending.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: "task_accept_decision_missing",
      reason:
        "TaskRun 声称已 accepted，但缺少与该任务和交付物绑定的验收决策回执",
      started: true,
    });
    return true;
  }
  if (
    new Set(["accepted", "delivered"]).has(run.status) &&
    loadedDecision.decision
  ) {
    taskSink.artifactCreated({
      id: pending.artifact.id,
      taskRunId: pending.taskRunId,
      name: basename(pending.artifact.path),
      kind: "research_report",
      path: pending.artifact.path,
      status: run.status === "accepted" ? "accepted" : "ready",
    });
    taskSink.outcomeChecked({
      id: pending.taskRunId,
      taskRunId: pending.taskRunId,
      valid: true,
      passed: true,
      deliverable: pending.artifact.path,
      artifactId: pending.artifact.id,
    });
    acceptTaskModeDelivery({ run, pending, taskSink });
    return true;
  }
  if (run.status !== "delivered") {
    emitPendingApprovalRecoveryBlock(taskSink, {
      taskRunId: pending.taskRunId,
      employeeId: agentId,
      requestedTaskId,
      code: "invalid_recovery_state",
      reason: `待验收任务状态为 ${run.status}，不能恢复审批`,
      started: true,
    });
    return true;
  }

  const verified = verifyPendingTaskArtifact(WORKSPACE_ROOT, pending);
  if (!verified.ok) {
    taskSink.outcomeChecked({
      id: pending.taskRunId,
      taskRunId: pending.taskRunId,
      valid: false,
      passed: false,
      reason: verified.reason,
      gaps: [verified.code],
    });
    emitTaskApprovalRequested(taskSink, pending);
    failTaskModeDelivery({
      run,
      pending,
      taskSink,
      code: verified.code,
      reason: verified.reason,
    });
    return true;
  }

  artifacts.set(pending.artifact.id, {
    id: pending.artifact.id,
    path: pending.artifact.path,
    taskRunId: pending.taskRunId,
  });
  taskSink.artifactCreated({
    id: pending.artifact.id,
    taskRunId: pending.taskRunId,
    name: basename(pending.artifact.path),
    kind: "research_report",
    path: pending.artifact.path,
    status: "ready",
  });
  taskSink.outcomeChecked({
    id: pending.taskRunId,
    taskRunId: pending.taskRunId,
    valid: true,
    passed: true,
    deliverable: pending.artifact.path,
    artifactId: pending.artifact.id,
  });
  const approvalPromise = actionReader.waitForApproval(pending.approvalId, {
    kind: "deliverable_acceptance",
    artifactId: pending.artifact.id,
  });
  emitTaskApprovalRequested(taskSink, pending);
  const approvalResult = await approvalPromise;
  settleTaskModeDelivery({
    run,
    pending,
    taskSink,
    result: approvalResult,
  });
  return true;
}

// `crew run <agent> --task <id>` — the v0.3 Task Runtime. Resolve a manifest demo
// task, run it through the permission-gated agent loop while recording a TaskRun
// (state machine + tool-call audit), store the deliverable as an Artifact, grade
// it against the rubric + required sections, and capture the effective-task signal.
// PRD v0.3 §8.2 (state machine) / §13 (gateway) / §15 (grader) / §19.2 (effective).
async function runTaskMode({
  agentId,
  profile,
  apiKey,
  baseUrl,
  taskId,
  mock = false,
}) {
  const {
    model,
    temperature,
    system,
    displayName,
    title,
    runtime,
    dreamPolicy,
    toolResolution,
  } = profile;
  const name = displayName || titleizeId(agentId);
  const taskArtifacts = new Map();
  const taskSink =
    process.env.CREW_TUI === "ratatui"
      ? createTaskModeSink({ emit: createTaskJsonlEmitter() })
      : null;
  const actionReader = taskSink
    ? createTaskModeActionReader({
        emit: taskSink.emitRaw,
        root: WORKSPACE_ROOT,
        resolveArtifact: id => taskArtifacts.get(id),
      })
    : null;
  taskSink?.emitRaw("session.ready", {
    employee: { name, role: title, mode: "Task", model },
    tool_catalog: {
      version: TOOL_CATALOG.version,
      capabilities: TOOL_CATALOG.capabilities,
      resolution: toolResolution.sessionCatalog,
      declarations: toolResolution.sessionCatalog,
      blocking: toolResolution.blocking,
      degraded: toolResolution.degraded,
      surface: toolResolution.surface,
      grant_source: toolResolution.grantSource,
      grant_warning: toolResolution.grantWarning,
    },
  });
  const tasks = Array.isArray(runtime?.demo_tasks) ? runtime.demo_tasks : [];
  const demo = tasks.find(t => t && t.id === taskId);
  if (!demo) {
    const ids =
      tasks
        .map(t => t?.id)
        .filter(Boolean)
        .join(", ") || "(无)";
    const message = `员工 ${agentId} 没有任务 "${taskId}"。可用任务：${ids}`;
    if (taskSink) {
      const invalidRun = newTaskRun({
        employeeId: agentId,
        goal: taskId,
      });
      taskSink.taskStarted({ id: invalidRun.id, title: taskId });
      transition(invalidRun, "failed");
      saveTaskRun(WORKSPACE_ROOT, invalidRun);
      taskSink.emitRaw("task.failed", {
        id: invalidRun.id,
        taskRunId: invalidRun.id,
        status: "failed",
        reason: message,
      });
      actionReader?.close("invalid_task");
    }
    console.error(`Error: ${message}`);
    process.exit(1);
  }
  const taskText = demo.input?.task_text || demo.title || taskId;
  const officialDomains = normalizeOfficialDomains(
    demo.research_hints?.official_domains
  );
  const required = Array.isArray(demo.output_schema?.required_sections)
    ? demo.output_schema.required_sections
    : [];

  if (taskSink && actionReader) {
    try {
      const recovered = await recoverTaskModeApproval({
        agentId,
        requestedTaskId: taskId,
        taskSink,
        actionReader,
        artifacts: taskArtifacts,
      });
      if (recovered) {
        actionReader.close();
        return;
      }
    } catch (error) {
      actionReader.close("recovery_failed");
      throw error;
    }
  }

  // Recall: inject the employee's prior memory (reliable sources, verified SOPs) so
  // it builds on past work instead of starting cold. (PRD §14 — memory recall.)
  const mem = loadMemory(WORKSPACE_ROOT, agentId);
  const memText = mem.ok ? summarizeForPrompt(mem.items) : "";
  const sys = memText
    ? system + "\n\n# 你的记忆（过往任务沉淀，可直接复用）\n" + memText
    : system;

  const run = newTaskRun({ employeeId: agentId, goal: taskText });
  run.requested_task_id = taskId;
  run.degraded = toolResolution.degraded.length > 0;
  if (run.degraded) {
    addEvent(run, {
      type: "tool_preflight_degraded",
      summary: toolResolution.degraded
        .map(item => `${item.capability}: ${item.reason}`)
        .join("；"),
      status: "degraded",
    });
  }
  const { gateway, tools: employeeTools } = employeeAgentLoopDeps(
    { toolResolution },
    WORKSPACE_ROOT
  );

  taskSink?.taskStarted({ id: run.id, title: demo.title || taskText });
  for (const capability of toolResolution.resolved.filter(
    item => item.necessity === "required"
  )) {
    taskSink?.toolPreflightChecked({
      id: `capability:${capability.capability}`,
      tool: capability.runtime_tool || capability.capability,
      status: capability.availability,
      ok: capability.availability === "ready",
      label: capability.capability,
      reason: capability.reason,
    });
  }
  const toolPreflight = requiredToolPreflight(toolResolution);
  if (!toolPreflight.ok) {
    const reason = toolPreflight.reason;
    addEvent(run, {
      type: "tool_preflight_blocked",
      summary: reason,
      status: "blocked",
    });
    transition(run, "failed");
    saveTaskRun(WORKSPACE_ROOT, run);
    if (taskSink) {
      taskSink.emitRaw("task.blocked", {
        id: run.id,
        taskRunId: run.id,
        status: toolPreflight.code,
        reason,
        blocking: toolPreflight.blocking,
      });
      actionReader?.close(toolPreflight.code);
    } else {
      console.error(`Error: ${reason}`);
      process.exitCode = 1;
    }
    return;
  }
  for (const capability of toolResolution.degraded) {
    taskSink?.toolPreflightChecked({
      id: `capability:${capability.capability}`,
      tool: capability.capability,
      status: "degraded",
      ok: true,
      label: capability.capability,
      reason: capability.reason,
    });
  }
  if (!taskSink) {
    console.log(statusHeader({ name, role: title, status: "working", model }));
    console.log(GUTTER + `\x1b[2m▸ ${demo.title || taskId}\x1b[0m\n`);
  }

  // Search Planner (PRD §11.1): if the task carries research hints, show the plan
  // (multi-strategy queries, official-domain-first) before working, and pass it in.
  let planNote = "";
  if (demo.research_hints) {
    const h = demo.research_hints;
    const queries = generateQueries({
      entity: h.entity,
      aliases: h.aliases,
      officialDomains,
      productIds: h.product_ids,
    });
    run.plan = {
      kind: "research",
      official_domain_first: true,
      queries: queries.slice(0, 6),
    };
    addEvent(run, {
      type: "plan.created",
      summary: `${run.plan.queries.length} 个检索步骤`,
    });
    taskSink?.planCreated({
      id: `${taskId}:research-plan`,
      steps: queries.slice(0, 6),
    });
    if (!taskSink) {
      console.log(
        GUTTER + "\x1b[2m研究计划（Search Planner · 官方域名优先）：\x1b[0m"
      );
      queries
        .slice(0, 6)
        .forEach((q, i) =>
          console.log(GUTTER + `\x1b[2m  ${i + 1}. ${q}\x1b[0m`)
        );
      console.log("");
    }
    planNote =
      "\n\n# 研究计划（按此检索，官方域名优先；某条搜不到就换下一条策略，绝不放弃）\n建议检索式：\n" +
      queries.map(q => "- " + q).join("\n") +
      "\n失败剧本：" +
      FAILURE_PLAYBOOK.map(s => s.label).join(" → ");
  }

  // Step 1 — Search Provider Preflight (Preflight Doctor, Search Harness v1): a
  // research employee must have a verifiable search link. No provider → don't start
  // formally; let the user configure, or degrade to "知识库初判"(NOT counted effective).
  let degradeNote = toolResolution.degraded.length
    ? `\n\n# 工具降级\n以下条件能力当前不可用，禁止声称已调用，改用现有证据或明确标注缺口：\n${toolResolution.degraded
        .map(item => `- ${item.capability}: ${item.reason}`)
        .join("\n")}`
    : "";
  if (demo.research_hints && pickBackend().name === "ddg") {
    taskSink?.toolPreflightChecked({
      id: "web_search",
      tool: "web_search",
      status: "blocked",
      reason: "missing search provider",
    });
    if (!taskSink) {
      console.log(
        GUTTER +
          "\x1b[33m⚠ Preflight：未配置 Web Search Provider（Tavily / Serper / Brave）\x1b[0m"
      );
      console.log(
        GUTTER +
          "\x1b[2m   研究类任务需要可验证搜索链路；没有它只能给「仅凭已有知识」的初步判断，不计为有效任务。\x1b[0m"
      );
    }
    const choice = taskSink
      ? ""
      : await askLine(
          GUTTER + "   [回车]=降级运行(不计有效)  [c]=看配置方法  [n]=取消 › "
        );
    if (choice === "c") {
      printSearchKeyHelp();
      process.exit(0);
    }
    if (choice === "n") {
      console.log(GUTTER + "已取消。\n");
      process.exit(0);
    }
    run.degraded = true;
    if (!taskSink) {
      console.log(
        GUTTER +
          "\x1b[2m   → 降级运行：仅基于已有知识，关键数字标 [需核实]。\x1b[0m\n"
      );
    }
    degradeNote +=
      "\n\n# 重要：本次没有可靠联网检索（无 Search Provider，web_search 大概率返回空），任务已降级为「仅凭已有知识的初步判断」。不要靠反复 web_fetch 猜 URL 或抓搜索引擎结果页硬凑——既烧钱又拿不到结果。请：①开头说明本次为降级初判、需用户配置 TAVILY_API_KEY（免费）才能做可靠调研；②按交付物结构（含 来源/置信度/建议）给初步结论，关键数字一律标 [需核实]，置信度标「低」；③最多试 1–2 个官方 URL 后即收尾。";
  }

  transition(run, "planned");
  transition(run, "running_tool");

  let output = "";
  let promptTok = 0;
  let completionTok = 0;
  try {
    output =
      (await agentLoop({
        baseUrl,
        apiKey,
        model,
        temperature,
        system: sys,
        messages: [
          { role: "user", content: taskText + planNote + degradeNote },
        ],
        name,
        isTTY: !!process.stdout.isTTY,
        renderMd: !!process.stdout.isTTY || process.env.CREW_MD === "1",
        gateway,
        tools: employeeTools,
        root: WORKSPACE_ROOT,
        onInvocation: rec => {
          run.tool_invocations.push(rec);
          addEvent(run, {
            type: "tool_called",
            summary: rec.action || rec.tool_name,
            tool_name: rec.tool_name,
            status: rec.status,
          });
          taskSink?.onInvocation(rec);
        },
        onUsage: u => {
          if (!u) return;
          promptTok += u.prompt_tokens || 0;
          completionTok += u.completion_tokens || 0;
          taskSink?.onUsage(u);
        },
        onDelta: taskSink ? text => taskSink.onDelta(text) : undefined,
        budget: {
          costCap: demo.budget_limit ?? 0.5,
          maxSearchEmpty: 2,
          maxFetchShell: 2,
        },
        mock,
        confirm: async (msg, approval = {}) => {
          if (taskSink) {
            const id = `approval-${Date.now()}`;
            taskSink.approvalRequired({
              id,
              taskRunId: run.id,
              tool: approval.tool,
              scope: approval.scope,
              reason: msg,
            });
            if (!actionReader) return false;
            const result = await actionReader.waitForApproval(id, {
              kind: "tool_authorization",
            });
            return result.accepted === true;
          }
          const a = await askLine("\n" + GUTTER + "⚠ " + msg + " [y/N] ");
          return a === "y" || a === "yes" || a === "是";
        },
      })) || "";
  } catch (error) {
    transition(run, "failed");
    saveTaskRun(WORKSPACE_ROOT, run);
    taskSink?.emitRaw("task.failed", {
      id: run.id,
      taskRunId: run.id,
      reason: error.message,
      status: "failed",
    });
    actionReader?.close();
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }

  transition(run, "extracting_evidence");
  transition(run, "drafting_artifact");
  const artifact = newArtifact({
    taskId: run.id,
    type: "research_report",
    title: demo.title || taskId,
    content: output,
  });
  const savedArtifact = saveArtifact(WORKSPACE_ROOT, artifact);
  // v0.18 P0-a：落盘失败不得宣称 artifact.created（No-Artifact-No-Done 是 Runtime 不变量，
  // 不是 UI 补救）——created 只在文件真实写入后发；失败在 outcome.checked 里如实 valid:false。
  if (savedArtifact.ok) {
    addEvent(run, {
      type: "artifact.created",
      summary: savedArtifact.mdPath,
    });
    taskArtifacts.set(artifact.id, {
      id: artifact.id,
      path: savedArtifact.mdPath,
      taskRunId: run.id,
    });
    taskSink?.artifactCreated({
      id: artifact.id,
      taskId: run.id,
      name: `${artifact.id}.md`,
      kind: artifact.type,
      path: savedArtifact.mdPath,
      status: "ready",
    });
  }

  transition(run, "grading");
  let gradingError = null;
  let graded;
  try {
    graded = await grade({ task: taskText, artifact: output });
  } catch (error) {
    gradingError = error?.message ?? String(error);
    graded = { passed: false, feedback: gradingError };
  }
  const missing = required.filter(s => !output.includes(s));
  const completion = evaluateCompletionGate({
    artifactId: artifact.id,
    artifactSaved: savedArtifact.ok,
    artifactPath: savedArtifact.ok ? savedArtifact.mdPath : null,
    artifactError: savedArtifact.ok ? null : savedArtifact.error,
    gradingPassed: graded.passed,
    gradingFeedback: graded.feedback,
    gradingError,
    missingSections: missing,
  });
  // A persisted reference is part of the completion decision.  A failed write
  // therefore leaves no dangling id in the TaskRun JSON.
  run.artifact = completion.artifactId;
  const outputValid = completion.valid;
  run.output_valid = outputValid;
  // v0.18 P0-a：主字段统一为 `valid`（Rust reducer 的契约字段）；保留 `passed` 兼容旧消费方
  // （web TaskRun viewer 读 run 文件）。此前只发 passed → Rust 缺 valid 默认成功 = 假绿链。
  taskSink?.outcomeChecked({
    id: run.id,
    taskRunId: run.id,
    valid: outputValid,
    passed: outputValid,
    feedback: completion.reason,
    reason: completion.reason,
    missing,
    gaps: completion.gaps,
    ...(completion.artifactId ? { artifactId: completion.artifactId } : {}),
    ...(completion.deliverable ? { deliverable: completion.deliverable } : {}),
  });
  addEvent(run, {
    type: "outcome.checked",
    summary: completion.reason || (outputValid ? "valid" : "invalid"),
    status: outputValid ? "valid" : "invalid",
  });

  // Dream/reflect only stages candidates here. A task result is not trustworthy
  // memory until the user accepts the deliverable; rejection, EOF and crashes
  // before the durable accepted state must leave the searchable store untouched.
  // M1（条件式 Dream）：per-task reviewTaskRun 是 legacy 学习管线的候选生产者，随
  // legacy_learning flag 走——flag=on 时照跑（真·HEAD 行为，含模型成本），flag=off 时跳过
  // （Reflect 取代其输入采集职责，零模型成本）。commitAcceptedTaskMemory（消费者）同 flag。
  const legacyLearning = legacyLearningEnabled(WORKSPACE_ROOT);
  let review = null;
  if (outputValid && legacyLearning) {
    try {
      review = await reviewTaskRun({
        taskRun: run,
        deliverable: output,
        existingMemory: mem.items,
        policy: dreamPolicy,
        mock,
        modelId: mock ? "mock" : model,
        model: mock
          ? undefined
          : input =>
              callDreamModel(input, {
                baseUrl,
                apiKey,
                model,
                onUsage: usage => {
                  if (!usage) return;
                  promptTok += usage.prompt_tokens || 0;
                  completionTok += usage.completion_tokens || 0;
                  taskSink?.onUsage(usage);
                },
              }),
      });
    } catch {
      run.dream = {
        contract: "crewclaw.dream/v1",
        status: "failed",
        mock,
        model: mock ? "mock" : model,
        generated_at: Date.now(),
        source_task_ids: [run.id],
        candidates: 0,
        new_memory_candidates: [],
        new_playbook_candidates: [],
        reason: "model_or_contract_failure",
      };
      addEvent(run, {
        type: "dream.failed",
        summary: "model_or_contract_failure",
        status: "failed",
      });
    }
  }
  const memoryCandidates = [];
  if (review) {
    // Explicit mock proves the Dream harness only. It is never allowed to seed long-term memory,
    // even if someone runs --mock against their normal production workspace.
    if (!mock) {
      for (const cand of review.new_memory_candidates) {
        memoryCandidates.push(cand);
      }
      for (const pb of review.new_playbook_candidates) {
        memoryCandidates.push({
          category: "verified_sops",
          text: `${pb.title}：${pb.steps.join(" → ")}`,
          confidence: review.confidence,
        });
      }
    }
    run.dream = {
      ...review,
      status: "completed",
      candidates:
        review.new_memory_candidates.length +
        review.new_playbook_candidates.length,
    };
    addEvent(run, {
      type: "dream.completed",
      summary: `${run.dream.candidates} candidates`,
      status: mock ? "mock" : "completed",
    });
  }

  // Failure-path lessons are subject to the same acceptance gate: if they came
  // from an unaccepted output they are discarded with the other candidates.
  const lessons = [];
  if (run.degraded)
    lessons.push(
      "研究类任务先过 Search Provider preflight（配 TAVILY_API_KEY 等）再开工，别没 key 硬上。"
    );
  if (!outputValid)
    lessons.push(
      "无来源/置信度/建议的报告会被 Outcome Grader 判 rejected——先把证据补齐再交。"
    );
  if (run.tool_invocations.some(r => r.decision === "deny"))
    lessons.push("越权工具（发邮件/删除/支付等）会被权限网关拦截，别试。");
  if (
    run.tool_invocations.some(
      r => r.tool_name === "web_fetch" && r.status === "blocked"
    )
  )
    lessons.push("官方页抓到 JS 空壳要转 browser_render，别反复猜 URL 烧钱。");
  // These messages are operational warnings only. Long-term memory must come exclusively from a
  // successful real Dream model response, never from hard-coded heuristic templates.

  transition(run, completion.nextState);

  const noCriticalBlock = !run.tool_invocations.some(
    r => r.decision === "deny"
  );
  const useful = outputValid && !taskSink ? await askUseful() : null;
  run.user_feedback =
    useful === null ? "skipped" : useful ? "useful" : "not_useful";
  const effective =
    outputValid && noCriticalBlock && useful === true && !run.degraded;
  run.effective = effective;
  if (outputValid && useful === true) transition(run, "accepted");
  else if (outputValid && useful === false) transition(run, "rejected");

  // A valid deliverable always carries the canonical (possibly empty) commit shape: the
  // acceptance settlement snapshot requires it, and a Dream failure or mock run must degrade to
  // "no learning" — never to an un-acceptable deliverable. memoryCandidates is already empty in
  // mock mode and when the Dream review failed, so this cannot seed memory it shouldn't.
  run.memory_commit =
    outputValid && run.status !== "rejected"
      ? {
          candidates: memoryCandidates,
          lessons: 0,
          committed: false,
        }
      : null;
  let learned = 0;
  let committedLessons = 0;

  // Budget Guard (PRD §8.1): tally this task's token cost.
  const { tokens, cost } = estimateCost({
    promptTokens: promptTok,
    completionTokens: completionTok,
  });
  run.tokens = tokens;
  run.cost = cost;

  const taskStateSaved = saveTaskRun(WORKSPACE_ROOT, run);
  if (!taskSink && run.status === "accepted" && taskStateSaved.ok) {
    const memory = commitAcceptedTaskMemory({ run, taskSink: null });
    if (!memory.ok) {
      console.error(`${GUTTER}记忆未提交：${memory.reason}`);
    } else {
      learned = Number(memory.learned || 0);
      committedLessons = Number(run.memory_commit?.lessons || 0);
    }
  }

  // Step 4 — Evidence Store: bind each cited source to an evidence card (auditable
  // per-run trail with source_type); the report's sources assemble from the cards.
  const cited = [...new Set(output.match(/https?:\/\/[^\s)]+/g) || [])];
  for (const src of cited) {
    addEvidence(
      WORKSPACE_ROOT,
      run.id,
      createTaskEvidenceCard(src, {
        officialDomains,
        degraded: run.degraded,
      })
    );
  }
  const evidence = loadEvidence(WORKSPACE_ROOT, run.id);
  run.evidence_count = evidence.ok ? evidence.cards.length : 0;
  const sources = assembleSources(evidence.ok ? evidence.cards : []);

  // M1（条件式 Dream）：CLI 终态（accept/reject 均经此，status + user_feedback 已定）落一份
  // 不可变 Reflect 工作日志。确定性、零模型成本、幂等（重放同 id 内容一致=no-op）。
  try {
    const reflection = buildReflection(run, {
      evidenceIds: evidence.ok
        ? evidence.cards.map(c => c.id).filter(Boolean)
        : [],
      legacyCommitted: run.memory_commit?.committed === true,
      createdAt: new Date().toISOString(),
    });
    writeReflection(WORKSPACE_ROOT, reflection);
  } catch (error) {
    console.error(`${GUTTER}reflect 未落盘：${error?.message ?? error}`);
  }
  // Task Report (PRD §19.1): export a shareable markdown report next to the run.
  const reportCandidate = join(
    WORKSPACE_ROOT,
    ".crewclaw",
    "runs",
    `${run.id}.report.md`
  );
  let reportPath = null;
  try {
    writeStateFileAtomic(
      reportCandidate,
      renderReport({
        taskRun: run,
        deliverable: output,
        sources,
        grade: graded,
      }),
      { root: WORKSPACE_ROOT }
    );
    if (captureArtifactFingerprint(reportCandidate).ok) {
      reportPath = reportCandidate;
    }
  } catch (error) {
    taskSink?.emitRaw("debug.line", {
      line: `task report not persisted: ${error?.message || String(error)}`,
    });
  }
  if (outputValid && taskSink && actionReader) {
    const approvalId = `task-approval-${run.id}`;
    const fingerprint = captureArtifactFingerprint(completion.deliverable);
    const pending = {
      protocolVersion: 1,
      approvalId,
      taskRunId: run.id,
      employeeId: agentId,
      requestedTaskId: taskId,
      goal: taskText,
      artifact: {
        id: completion.artifactId,
        path: completion.deliverable,
      },
      fingerprint,
      usage: {
        prompt_tokens: promptTok,
        completion_tokens: completionTok,
      },
      reportPath,
      createdAt: Date.now(),
    };
    if (!fingerprint.ok) {
      taskSink.outcomeChecked({
        id: run.id,
        taskRunId: run.id,
        valid: false,
        passed: false,
        reason: fingerprint.reason,
        gaps: [fingerprint.code],
      });
      const failed = transitionTaskRunDurably(run, "failed", {
        memory_commit: null,
        failure: {
          code: fingerprint.code,
          reason: fingerprint.reason,
          at: new Date().toISOString(),
        },
      });
      taskSink.emitRaw("task.failed", {
        id: run.id,
        taskRunId: run.id,
        status: "failed",
        reason: failed.ok ? fingerprint.reason : failed.reason,
        reason_code: failed.ok ? fingerprint.code : failed.code,
      });
    } else {
      const receipt = persistPendingTaskApproval(WORKSPACE_ROOT, pending, {
        run,
      });
      if (!receipt.ok) {
        const failed = transitionTaskRunDurably(run, "failed", {
          memory_commit: null,
          failure: {
            code: receipt.code,
            reason: receipt.reason,
            at: new Date().toISOString(),
          },
        });
        taskSink.emitRaw("task.failed", {
          id: run.id,
          taskRunId: run.id,
          status: "failed",
          reason: failed.ok ? receipt.reason : failed.reason,
          reason_code: failed.ok ? receipt.code : failed.code,
        });
      } else {
        addEvent(run, {
          type: "approval.requested",
          summary: approvalId,
          status: "pending",
        });
        run.pending_approval = {
          id: approvalId,
          kind: "deliverable_acceptance",
          receipt: receipt.path,
        };
        const pendingState = saveTaskRun(WORKSPACE_ROOT, run);
        if (!pendingState.ok) {
          taskSink.emitRaw("debug.line", {
            line: `pending TaskRun snapshot not updated: ${pendingState.error}`,
          });
        }
        const approvalPromise = actionReader.waitForApproval(approvalId, {
          kind: "deliverable_acceptance",
          artifactId: completion.artifactId,
        });
        emitTaskApprovalRequested(taskSink, pending);
        const approvalResult = await approvalPromise;
        settleTaskModeDelivery({
          run,
          pending,
          taskSink,
          result: approvalResult,
        });
      }
    }
  } else if (outputValid) {
    taskSink?.taskCompleted({
      id: run.id,
      artifactId: completion.artifactId,
      deliverable: completion.deliverable,
      ...(reportPath ? { reportPath } : {}),
    });
  } else {
    taskSink?.emitRaw(
      run.status === "revision_needed" ? "task.revision_needed" : "task.failed",
      {
        id: run.id,
        taskRunId: run.id,
        status: run.status,
        reason: completion.reason,
        gaps: completion.gaps,
        ...(completion.artifactId ? { artifactId: completion.artifactId } : {}),
      }
    );
  }

  // Workbench info layer (PRD §17.3): main view shows human action summaries.
  if (!taskSink) {
    if (run.tool_invocations.length) {
      console.log("\n" + GUTTER + "\x1b[2m员工动作：\x1b[0m");
      run.tool_invocations.forEach((r, i) =>
        console.log(
          GUTTER + `\x1b[2m  ${i + 1}. ${r.action || r.tool_name}\x1b[0m`
        )
      );
    }
    const tick = b => (b ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
    console.log("\n" + GUTTER + "\x1b[1m任务验收\x1b[0m");
    console.log(
      GUTTER +
        `  交付物 ${run.artifact || "未落盘"} · 工具调用 ${run.tool_invocations.length} 次 · 状态 ${run.status}`
    );
    console.log(
      GUTTER +
        `  ${tick(outputValid)} 结构达标${missing.length ? `（缺：${missing.join("、")}）` : ""}   ${tick(graded.passed)} 验收规则${graded.passed ? "" : `（待补：${graded.feedback}）`}`
    );
    console.log(
      GUTTER +
        `  ${tick(effective)} 有效任务 · 反馈：${run.user_feedback}${run.degraded ? " · 降级运行（未配 Search Provider）" : ""}`
    );
    console.log(
      GUTTER +
        `  \x1b[2m${formatBudget({ tokens, cost, limit: demo.budget_limit })}\x1b[0m`
    );
    if (learned)
      console.log(
        GUTTER + `  \x1b[2m📓 沉淀 ${learned} 条记忆（来源/事实/SOP）\x1b[0m`
      );
    if (run.evidence_count)
      console.log(
        GUTTER +
          `  \x1b[2m🔖 ${run.evidence_count} 条证据卡 → ${run.id}.evidence.json\x1b[0m`
      );
    if (committedLessons)
      console.log(
        GUTTER +
          `  \x1b[2m📕 复盘出 ${committedLessons} 条失败教训 → failure_paths\x1b[0m`
      );
    console.log(
      GUTTER +
        `  \x1b[2mTaskRun → .crewclaw/runs/${run.id}.json${
          reportPath ? ` · 报告 ${run.id}.report.md` : " · 报告未落盘"
        }\x1b[0m`
    );
    console.log(
      GUTTER +
        `  \x1b[2m${actionBar(["accept", "reject", "dream", "inspect"])}\x1b[0m\n`
    );
  }
  actionReader?.close();
}

async function main() {
  const { flags, agentId, task: baseTask } = parseArgs(process.argv.slice(2));

  if (!agentId) {
    console.error(
      'Usage: crew run <agent> "<task>"   |   crew chat <agent>   (interactive)'
    );
    process.exit(2);
  }
  if (!safeAgentId(agentId)) {
    console.error(
      `Error: invalid agent id "${agentId}" (use lowercase letters, digits, hyphens).`
    );
    process.exit(1);
  }

  try {
    await loadDotEnv();
  } catch (error) {
    console.error(`Error: ${error?.message || error}`);
    process.exit(1);
  }
  const apiKey = process.env.ZENMUX_API_KEY;
  const baseUrl = (
    process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1"
  ).replace(/\/$/, "");
  if (!apiKey) {
    console.error(
      "Error: ZENMUX_API_KEY not set (expected in crewhire/.env.local)."
    );
    process.exit(1);
  }

  let profile;
  const surface = flags.task
    ? "task"
    : flags.json
      ? "json"
      : !baseTask && !flags.input
        ? "chat"
        : "run";
  try {
    profile = await loadProfile(agentId, {
      workspaceRoot: WORKSPACE_ROOT,
      env: process.env,
      surface,
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // --task <id> → v0.3 Task Runtime: run a manifest demo task as a graded, recorded
  // TaskRun (the "试工" closed loop), distinct from free-form chat or one-shot.
  if (flags.task) {
    await runTaskMode({
      agentId,
      profile,
      apiKey,
      baseUrl,
      taskId: flags.task,
      mock: flags.mock,
    });
    return;
  }

  // `on_unavailable` is executable policy: fail/ask_user blocks, while degrade remains visible
  // in the frozen session truth and prompt. Never silently downgrade a required capability here.
  const preflight = requiredToolPreflight(profile.toolResolution);
  if (!preflight.ok) {
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({
          agent: agentId,
          error: preflight.reason,
          code: preflight.code,
          surface,
          blocking: preflight.blocking,
          degraded: preflight.degraded,
        })}\n`
      );
    } else {
      console.error(`Error: ${preflight.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  // No task and not JSON → interactive chat REPL (crew chat <agent>).
  if (!baseTask && !flags.input && !flags.json) {
    await interactiveChat({
      agentId,
      profile,
      apiKey,
      baseUrl,
      resume: flags.resume,
      mock: flags.mock,
    });
    return;
  }

  let task = baseTask;
  if (flags.input) {
    let input;
    try {
      input = readInputFile(flags.input);
    } catch (error) {
      console.error(`Error: ${error?.message || error}`);
      process.exit(1);
    }
    task = `${baseTask}\n\n--- input: ${flags.input} ---\n${input}`;
  }
  if (!task) {
    console.error(
      'Usage: crew run <agent> "<task>"   |   crew chat <agent>   (interactive)'
    );
    process.exit(2);
  }

  const { model, temperature, system, skills, displayName, toolResolution } =
    profile;
  const name = displayName || titleizeId(agentId);
  const started = Date.now();

  if (flags.json) {
    // Machine-readable, but still the real employee runtime: quiet agentLoop preserves filtered
    // tools, per-call policy, limits, and gateway audit semantics without polluting stdout.
    try {
      let promptTokens = 0;
      let completionTokens = 0;
      const content = await agentLoop({
        baseUrl,
        apiKey,
        model,
        temperature,
        system,
        messages: [{ role: "user", content: task }],
        name,
        isTTY: false,
        renderMd: false,
        ...employeeAgentLoopDeps({ toolResolution }, WORKSPACE_ROOT),
        root: WORKSPACE_ROOT,
        confirm: denyUnavailableApproval,
        onDelta() {},
        onUsage(usage) {
          promptTokens += usage?.prompt_tokens || 0;
          completionTokens += usage?.completion_tokens || 0;
        },
        mock: flags.mock,
      });
      process.stdout.write(
        JSON.stringify({
          agent: agentId,
          content,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
          },
          surface,
          tool_degraded: profile.toolResolution?.degraded || [],
          elapsed_ms: Date.now() - started,
        }) + "\n"
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          agent: agentId,
          error: error.message,
          elapsed_ms: Date.now() - started,
        }) + "\n"
      );
      process.exit(1);
    }
    return;
  }

  // Live, tool-using single-shot for `crew run`.
  console.log(`${name} · model ${model} · ${skills.length} skills · live`);
  try {
    await agentLoop({
      baseUrl,
      apiKey,
      model,
      temperature,
      system,
      messages: [{ role: "user", content: task }],
      name,
      isTTY: !!process.stdout.isTTY,
      renderMd: !!process.stdout.isTTY || process.env.CREW_MD === "1",
      ...employeeAgentLoopDeps({ toolResolution }, WORKSPACE_ROOT),
      root: WORKSPACE_ROOT,
      mock: flags.mock,
    });
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

const isMainModule =
  !!process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMainModule) {
  main().catch(error => {
    console.error(`Error: ${error?.message ?? error}`);
    process.exit(1);
  });
}

export {
  TOOL_CATALOG,
  TOOLS,
  agentLoop,
  callModel,
  createTaskEvidenceCard,
  denyUnavailableApproval,
  employeeAgentLoopDeps,
  loadDotEnv,
  loadProfile,
  normalizeOfficialDomains,
  requiredToolPreflight,
  runStructuredProcess,
  runTool,
};
