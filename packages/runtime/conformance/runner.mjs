// conformance/runner.mjs — drive the real JSONL runtime and verify its wire contract.
//
// The conformance suite intentionally does not call route/reducer helpers directly. Each
// vector launches the same run.mjs process as the Rust workbench, drives stdin only after the
// preceding protocol event arrives, and validates every stdout line. Invalid JSON, a malformed
// event, a non-zero child exit, a timeout, missing correlation, or conflicting task terminals
// are all hard failures.

// Usage: node packages/runtime/conformance/runner.mjs [--agent <id>] [--json] [--keep]

// `--keep` preserves the isolated temporary workspace for every vector and prints its path.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

import {
  EVENTS,
  TASK_EVENT_PROTOCOL_VERSION,
  validateTaskEvent,
} from "../tui/protocol.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "..", "run.mjs");
const REPO_ROOT = join(HERE, "..", "..", "..");
const CHILD_TIMEOUT_MS = Number(
  process.env.CREW_CONFORMANCE_TIMEOUT_MS || 60_000
);

const TERMINAL_TYPES = new Set([
  EVENTS.TASK_COMPLETED,
  EVENTS.TASK_REJECTED,
  EVENTS.TASK_BLOCKED,
  EVENTS.TASK_FAILED,
  EVENTS.TASK_REVISION_NEEDED,
]);

// Each vector states observable behavior only. For `inputs`, input 0 follows session.ready;
// each later input follows the event at the corresponding `after` index. This removes timing
// assumptions from multi-step approval scenarios.
export const LIVE_VECTORS = Object.freeze([
  {
    id: 1,
    label: "hi 轻聊不升级、不产 artifact + session.ready 广播 caps.ansi",
    input: "hi",
    want: ["session.ready", "task.started", "task.completed"],
    deny: ["task.upgraded_from_chat", "artifact.created"],
    assertData: events => {
      const ready = events.find(event => event.type === "session.ready");
      if (!ready) return "session.ready missing";
      if (ready.data?.caps?.ansi !== true)
        return "session.ready must advertise caps.ansi=true";
      if (ready.data?.caps?.parts !== true)
        return "session.ready must advertise caps.parts=true";
      return null;
    },
  },
  {
    id: 2,
    label: "杭州天气 → quick.utility，不吃模型、不升级",
    input: "杭州天气？",
    want: ["quick.utility", "task.completed"],
    deny: ["task.upgraded_from_chat", "artifact.created"],
  },
  {
    id: 3,
    label: "最新模型发布 + 无搜索 key → blocked，不产 artifact",
    input: "最新有哪些模型发布？",
    scrubSearchKeys: true,
    want: ["task.blocked"],
    deny: ["artifact.created"],
    assertData: events => {
      const blocked = events.find(event => event.type === "task.blocked");
      if (!blocked) return "task.blocked missing";
      if (blocked.data?.est_cost !== 0)
        return `preflight block must carry exact zero-cost evidence; got ${JSON.stringify(blocked.data)}`;
      return null;
    },
  },
  {
    id: 4,
    label: "ROI 示例 → 升级 TaskRun + 产 artifact + 定妆 assistant.rendered",
    input: "给我一份内部知识问答ROI示例",
    want: [
      "task.upgraded_from_chat",
      "artifact.created",
      "outcome.checked",
      "assistant.rendered",
      "approval.requested",
    ],
    deny: ["task.completed"],
    assertData: events => {
      const rendered = events.find(
        event => event.type === "assistant.rendered"
      );
      if (!rendered) return "assistant.rendered missing";
      if (
        !Array.isArray(rendered.data?.ansi_lines) ||
        rendered.data.ansi_lines.length === 0
      )
        return "ansi_lines must be a non-empty array";
      return null;
    },
  },
  {
    id: 6,
    label: "jizhu → memory.state 真值，无虚假 persistent",
    input: "jizhu",
    want: ["memory.state", "memory.requested", "task.completed"],
    deny: ["artifact.created"],
    assertData: events => {
      const state = events.find(event => event.type === "memory.state");
      if (!state) return "memory.state missing";
      if (state.data?.memory?.persistent === "available")
        return "claims persistent memory available (untruthful)";
      return null;
    },
  },
  {
    id: 7,
    label: "输出 markdown → artifact.created + 可 reveal",
    input: "输出一份markdown",
    want: ["artifact.created", "workspace.revealed", "approval.requested"],
    deny: ["task.completed"],
  },
  {
    id: 8,
    label: "打开文件夹 → workspace.revealed（非裸 bash）",
    input: "打开文件夹",
    want: ["workspace.revealed", "task.completed"],
    deny: [],
  },
  {
    id: 12,
    label: "/model → command.output（引擎执行，不算任务）",
    input: "/model",
    want: ["command.output"],
    deny: ["task.started"],
    assertData: events => {
      const output = events.find(event => event.type === "command.output");
      if (!output) return "command.output missing";
      if (
        !Array.isArray(output.data?.ansi_lines) ||
        output.data.ansi_lines.length === 0
      )
        return "command.output should carry non-empty ansi_lines";
      return null;
    },
  },
  {
    id: 13,
    label: "/clear → command.output{clear:true}，清空上下文",
    input: "/clear",
    want: ["command.output"],
    deny: ["task.started"],
    assertData: events => {
      const output = events.find(event => event.type === "command.output");
      if (!output) return "command.output missing";
      if (output.data?.clear !== true)
        return "/clear must set command.output.clear=true";
      return null;
    },
  },
  {
    id: 10,
    label: "任务结束进入 Approval（不直接 completed）",
    input: "给我一份内部知识问答ROI示例",
    want: ["approval.requested", "pending.actions"],
    deny: ["task.completed"],
  },
  {
    id: 11,
    label: "接受交付物后写 ProofPack 并完成（CC-PROOF-001）",
    inputs: ["给我一份内部知识问答ROI示例", "1"],
    after: ["session.ready", "approval.requested"],
    want: ["approval.requested", "approval.accepted", "task.completed"],
    deny: [],
    assertData: events => {
      const accepted = events.find(event => event.type === "approval.accepted");
      if (!accepted) return "approval.accepted missing";
      if (!accepted.data?.proofpack)
        return "approval.accepted has no proofpack path";
      return null;
    },
  },
  {
    id: 14,
    label:
      "user.message parts[] → image_url content block 抵达模型（CC-PARTS-001）",
    input: JSON.stringify({
      type: "user.message",
      data: {
        text: "看看这张图 [Image 1]",
        parts: [
          { type: "text", text: "看看这张图 " },
          {
            type: "image",
            media_type: "image/png",
            data_url:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
          },
        ],
      },
    }),
    want: ["task.started", "assistant.rendered", "task.completed"],
    deny: [],
    assertData: events => {
      const rendered = events.find(
        event => event.type === "assistant.rendered"
      );
      if (!rendered) return "assistant.rendered missing";
      const joined = (rendered.data?.ansi_lines || []).join("\n");
      if (!/parts-received:[^\]]*image_url/.test(joined))
        return "model did not receive an image_url content block (parts downbridge broken)";
      return null;
    },
  },
  {
    id: 15,
    label: "session.ready 暴露 skills/memory 索引预算且不注入正文",
    input: "/model",
    want: ["session.ready", "command.output"],
    deny: ["task.started"],
    assertData: events => {
      const context = events.find(event => event.type === "session.ready")?.data
        ?.context_index;
      if (!context) return "session.ready missing context_index";
      if (context.skills?.included < 1)
        return "skill index must include at least one real profile skill";
      if (context.skills?.body_injected !== false)
        return "skill bodies must stay out of the system index";
      if (context.skills?.estimated_tokens > context.skills?.budget_tokens)
        return "skill index exceeded its declared token budget";
      if (context.memory?.included < 1)
        return "memory index must include seeded memory records";
      if (context.memory?.body_injected !== false)
        return "memory bodies must stay out of the system index";
      if (context.memory?.estimated_tokens > context.memory?.budget_tokens)
        return "memory index exceeded its declared token budget";
      if (
        !Number.isFinite(context.memory?.full_estimated_tokens) ||
        context.memory.estimated_tokens >=
          context.memory.full_estimated_tokens / 3
      ) {
        return `memory index is not under one third of full injection: ${JSON.stringify(context.memory)}`;
      }
      return null;
    },
  },
]);

function hasAllWanted(vector, events) {
  const seen = new Set(events.map(event => event.type));
  return (vector.want || []).every(type => seen.has(type));
}

function taskIdOf(event) {
  if (typeof event?.data?.taskRunId === "string") return event.data.taskRunId;
  if (TERMINAL_TYPES.has(event?.type) && typeof event?.data?.id === "string") {
    return event.data.id;
  }
  return null;
}

function protocolFailures(events) {
  const failures = [];
  const started = new Map();
  const terminals = new Map();
  const approvals = new Map();

  events.forEach((event, index) => {
    if (event.protocol_version !== TASK_EVENT_PROTOCOL_VERSION) {
      failures.push(
        `event ${index + 1} (${event.type}) protocol_version must be ${TASK_EVENT_PROTOCOL_VERSION}`
      );
    }
    const validation = validateTaskEvent(event);
    if (!validation.ok) {
      failures.push(
        `event ${index + 1} (${event.type}) invalid: ${validation.errors.join(", ")}`
      );
    }

    if (event.type === EVENTS.TASK_STARTED) {
      const id = event.data?.id;
      if (started.has(id)) failures.push(`task ${id} started more than once`);
      else started.set(id, index);
    }

    const taskId = taskIdOf(event);
    if (taskId && event.type !== EVENTS.TASK_STARTED && !started.has(taskId)) {
      failures.push(
        `event ${index + 1} (${event.type}) references task ${taskId} before task.started`
      );
    }

    if (TERMINAL_TYPES.has(event.type) && taskId) {
      const prior = terminals.get(taskId) || [];
      prior.push({ type: event.type, index });
      terminals.set(taskId, prior);
    }

    if (event.type === EVENTS.ARTIFACT_CREATED && taskId) {
      const startIndex = started.get(taskId);
      if (startIndex !== undefined && index <= startIndex)
        failures.push(
          `artifact.created for ${taskId} must follow task.started`
        );
    }

    if (event.type === EVENTS.APPROVAL_REQUESTED) {
      const id = event.data?.id;
      if (approvals.has(id))
        failures.push(`approval ${id} requested more than once`);
      approvals.set(id, { taskRunId: taskId, index });
    }
    if (
      event.type === EVENTS.APPROVAL_ACCEPTED ||
      event.type === EVENTS.APPROVAL_REJECTED
    ) {
      const request = approvals.get(event.data?.id);
      if (!request) {
        failures.push(
          `${event.type} ${event.data?.id} has no matching approval.requested`
        );
      } else if (request.taskRunId !== taskId) {
        failures.push(
          `${event.type} ${event.data?.id} changed task correlation`
        );
      } else if (index <= request.index) {
        failures.push(
          `${event.type} ${event.data?.id} must follow approval.requested`
        );
      }
    }
  });

  for (const [taskId, terminalEvents] of terminals) {
    if (terminalEvents.length !== 1) {
      failures.push(
        `task ${taskId} emitted ${terminalEvents.length} terminal events: ${terminalEvents
          .map(event => event.type)
          .join(", ")}`
      );
    }
  }
  for (const taskId of started.keys()) {
    if (!terminals.has(taskId))
      failures.push(`task ${taskId} has no terminal event`);
  }

  return failures;
}

function canCloseGracefully(vector, events, sentInputs) {
  const inputs = vector.inputs || [vector.input];
  if (sentInputs < inputs.length || !hasAllWanted(vector, events)) return false;

  const startedIds = events
    .filter(event => event.type === EVENTS.TASK_STARTED)
    .map(event => event.data?.id)
    .filter(Boolean);
  if (startedIds.length === 0) return true;

  const terminalIds = new Set(
    events
      .filter(event => TERMINAL_TYPES.has(event.type))
      .map(taskIdOf)
      .filter(Boolean)
  );
  if (startedIds.every(id => terminalIds.has(id))) return true;

  // A persisted human-approval gate is a stable stopping point. `/exit` must convert it into
  // one recoverable task.blocked terminal instead of hanging or silently dropping the gate.
  return events.some(event => event.type === EVENTS.APPROVAL_REQUESTED);
}

function runVector(vector, { agent, root }) {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      CREW_MOCK: "1",
      CREW_TUI: "ratatui",
      CREWCLAW_ROOT: root,
    };
    if (vector.scrubSearchKeys) {
      for (const key of [
        "TAVILY_API_KEY",
        "SERPER_API_KEY",
        "BRAVE_API_KEY",
        "SEARXNG_URL",
      ]) {
        delete env[key];
      }
    }

    const child = spawn(process.execPath, [RUNTIME, agent], {
      env,
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    const events = [];
    const parseErrors = [];
    const inputs = vector.inputs || [vector.input];
    const triggers =
      vector.after ||
      inputs.map((_, index) =>
        index === 0 ? EVENTS.SESSION_READY : EVENTS.APPROVAL_REQUESTED
      );
    let stdoutBuffer = "";
    let stderr = "";
    let sentInputs = 0;
    let exitSent = false;
    let timedOut = false;

    const writeLine = value => {
      if (!child.stdin.destroyed && child.stdin.writable)
        child.stdin.write(`${value}\n`);
    };

    const drive = eventType => {
      while (sentInputs < inputs.length && triggers[sentInputs] === eventType) {
        writeLine(inputs[sentInputs]);
        sentInputs += 1;
      }
      if (!exitSent && canCloseGracefully(vector, events, sentInputs)) {
        exitSent = true;
        // The production front-end closes the child pipe when it exits. End stdin together with
        // the explicit command so no resumed pipe handle can keep a correctly closed readline
        // interface alive indefinitely.
        if (!child.stdin.destroyed && child.stdin.writable) {
          child.stdin.end("/exit\n");
        }
      }
    };

    const acceptLine = rawLine => {
      const line = rawLine.trim();
      if (!line) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        parseErrors.push(
          `invalid stdout JSONL: ${String(error?.message || error)}; line=${line.slice(0, 240)}`
        );
        return;
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        parseErrors.push(
          `stdout JSONL value must be an object; line=${line.slice(0, 240)}`
        );
        return;
      }
      events.push(event);
      drive(event.type);
    };

    child.stdout.on("data", chunk => {
      stdoutBuffer += decoder.write(chunk);
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        acceptLine(line);
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_TIMEOUT_MS);

    child.on("error", error => {
      parseErrors.push(
        `failed to launch runtime: ${String(error?.message || error)}`
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      stdoutBuffer += decoder.end();
      if (stdoutBuffer.trim()) acceptLine(stdoutBuffer);
      resolve({
        events,
        stderr,
        parseErrors,
        code,
        signal,
        timedOut,
        sentInputs,
        expectedInputs: inputs.length,
      });
    });
  });
}

function judge(vector, result) {
  const { events } = result;
  const types = new Set(events.map(event => event.type));
  const failures = [...result.parseErrors];

  if (result.timedOut)
    failures.push(`runtime timed out after ${CHILD_TIMEOUT_MS}ms`);
  if (result.code !== 0) {
    failures.push(
      `runtime exited with code ${String(result.code)}${result.signal ? ` (${result.signal})` : ""}`
    );
  }
  if (result.sentInputs !== result.expectedInputs) {
    failures.push(
      `only sent ${result.sentInputs}/${result.expectedInputs} inputs (missing protocol trigger)`
    );
  }
  for (const type of vector.want || [])
    if (!types.has(type)) failures.push(`missing ${type}`);
  for (const type of vector.deny || [])
    if (types.has(type)) failures.push(`unexpected ${type}`);
  failures.push(...protocolFailures(events));

  if (vector.assertData) {
    const message = vector.assertData(events);
    if (message) failures.push(message);
  }
  return { pass: failures.length === 0, failures };
}

export async function runConformance({
  agent = "ai-adoption-whale",
  keep = false,
  vectorIds = null,
} = {}) {
  const results = [];
  const selected = vectorIds
    ? LIVE_VECTORS.filter(vector => vectorIds.has(vector.id))
    : LIVE_VECTORS;
  for (const vector of selected) {
    const root = mkdtempSync(join(tmpdir(), `crew-conf-${vector.id}-`));
    const stateRoot = join(root, ".crewclaw");
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(
      join(stateRoot, "team.json"),
      `${JSON.stringify([
        {
          workspace_employee_id: `conformance-${agent}`,
          employee_id: agent,
          version: "conformance-harness",
          status: "active",
          hired_at: "2026-01-01T00:00:00.000Z",
          fired_at: null,
          permissions_granted: [],
          package_sha256: null,
          hire_source: "eval_harness",
        },
      ])}\n`
    );
    mkdirSync(join(stateRoot, "memory"), { recursive: true });
    writeFileSync(
      join(stateRoot, "memory", `${agent}.json`),
      `${JSON.stringify(
        Array.from({ length: 50 }, (_, index) => ({
          category: index % 2 ? "project_facts" : "verified_sops",
          confidence: index < 40 ? "high" : "medium",
          text: `Conformance memory ${index}: ${"verified detail ".repeat(80)}tail-${index}`,
          savedAt: new Date(1_700_000_000_000 + index).toISOString(),
        }))
      )}\n`
    );
    try {
      const execution = await runVector(vector, { agent, root });
      const verdict = judge(vector, execution);
      results.push({
        id: vector.id,
        label: vector.label,
        ...verdict,
        seen: [...new Set(execution.events.map(event => event.type))],
        stderr: verdict.pass ? "" : execution.stderr.slice(-800),
        root: keep ? root : undefined,
      });
    } finally {
      if (!keep) {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          // A failed cleanup must not hide the actual conformance verdict.
        }
      }
    }
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const keep = argv.includes("--keep");
  const agentIndex = argv.indexOf("--agent");
  const agent = agentIndex !== -1 ? argv[agentIndex + 1] : "ai-adoption-whale";
  const vectorIndex = argv.indexOf("--vector");
  const vectorIds =
    vectorIndex === -1
      ? null
      : new Set(
          String(argv[vectorIndex + 1] || "")
            .split(",")
            .map(value => Number(value))
            .filter(Number.isSafeInteger)
        );
  const results = await runConformance({ agent, keep, vectorIds });
  const passed = results.filter(result => result.pass).length;

  if (asJson) {
    console.log(
      JSON.stringify({ passed, total: results.length, results }, null, 2)
    );
  } else {
    for (const result of results) {
      const mark = result.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(`${mark} [${result.id}] ${result.label}`);
      if (result.root) console.log(`    workspace: ${result.root}`);
      if (!result.pass) {
        console.log(`    ${result.failures.join("; ")}`);
        console.log(`    seen: ${result.seen.join(", ")}`);
        if (result.stderr)
          console.log(`    stderr: ${result.stderr.replace(/\n/g, " ")}`);
      }
    }
    console.log(`\nConformance: ${passed}/${results.length} vectors passed.`);
  }
  process.exit(passed === results.length ? 0 : 1);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main();
}
