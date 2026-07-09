// conformance/runner.mjs — LIVE conformance runner (PRD v0.6.1 §5, G1).
//
// Unlike the pure-module spec-vectors.mjs (which marks 6/10 vectors as HOST_ONLY
// "pending" and never drives them), this runner spawns the REAL runtime — the same
// `run.mjs` the Ratatui workbench spawns — feeds each vector's input on stdin, and
// asserts the emitted TaskEvent JSONL sequence. That is the only check that proves a
// capability is wired into the live default path, not just present as a module.
//
// It runs with CREW_MOCK=1 so it is deterministic and needs no API key (CI-safe). The
// search-preflight vector additionally scrubs provider keys so "missing_key ⇒ blocked"
// is exercised honestly.
//
// Usage:  node packages/runtime/conformance/runner.mjs [--agent <id>] [--json] [--keep]
// Exit 0 iff every vector passes.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "..", "run.mjs");

// Each vector: drive `input` through the live pipeline and assert on the event types
// that appeared. `want` = types that MUST appear; `deny` = types that must NOT.
// `scrubSearchKeys` removes provider keys so the search vector sees no provider.
export const LIVE_VECTORS = Object.freeze([
  {
    id: 1,
    label: "hi 轻聊不升级、不产 artifact + session.ready 广播 caps.ansi",
    input: "hi",
    want: ["session.ready", "task.started", "task.completed"],
    deny: ["task.upgraded_from_chat", "artifact.created"],
    // M2 caps negotiation: the engine advertises ANSI support so ANSI-capable front-ends opt
    // into assistant.rendered while others fall back to token.delta untouched.
    assertData: (events) => {
      const ready = events.find((e) => e.type === "session.ready");
      if (!ready) return "session.ready missing";
      if (ready.data?.caps?.ansi !== true) return "session.ready must advertise caps.ansi=true";
      // v0.8 M6: also advertise parts support so front-ends opt into structured attachments.
      if (ready.data?.caps?.parts !== true) return "session.ready must advertise caps.parts=true";
      return null;
    },
  },
  {
    id: 2,
    label: "杭州天气 → quick.utility，不吃模型、不升级",
    input: "杭州天气？",
    want: ["quick.utility"],
    deny: ["task.upgraded_from_chat", "artifact.created"],
  },
  {
    id: 3,
    label: "最新模型发布 + 无搜索 key → blocked，不产 artifact",
    input: "最新有哪些模型发布？",
    scrubSearchKeys: true,
    want: ["task.blocked"],
    deny: ["artifact.created"],
  },
  {
    id: 4,
    label: "ROI 示例 → 升级 TaskRun + 产 artifact + 定妆 assistant.rendered",
    input: "给我一份内部知识问答ROI示例",
    want: ["task.upgraded_from_chat", "artifact.created", "outcome.checked", "assistant.rendered"],
    deny: [],
    // AC-MD-004: the completed turn is typeset once — assistant.rendered carries a non-empty
    // ansi_lines array (the shared markdown renderer's output), proving the M2 downbridge fired.
    assertData: (events) => {
      const rendered = events.find((e) => e.type === "assistant.rendered");
      if (!rendered) return "assistant.rendered missing";
      const lines = rendered.data?.ansi_lines;
      if (!Array.isArray(lines) || lines.length === 0) return "ansi_lines must be a non-empty array";
      return null;
    },
  },
  {
    id: 6,
    label: "jizhu → memory.state 真值，无虚假 persistent",
    input: "jizhu",
    want: ["memory.state", "memory.requested"],
    deny: ["artifact.created"],
    assertData: (events) => {
      const st = events.find((e) => e.type === "memory.state");
      if (!st) return "memory.state missing";
      if (st.data?.memory?.persistent === "available")
        return "claims persistent memory available (untruthful)";
      return null;
    },
  },
  {
    id: 7,
    label: "输出 markdown → artifact.created + 可 reveal",
    input: "输出一份markdown",
    want: ["artifact.created", "workspace.revealed"],
    deny: [],
  },
  {
    id: 8,
    label: "打开文件夹 → workspace.revealed（非裸 bash）",
    input: "打开文件夹",
    want: ["workspace.revealed"],
    deny: [],
  },
  {
    id: 12,
    label: "/model → command.output（引擎执行，不算任务）",
    input: "/model",
    // AC-CMD-002: a slash command emits command.output and must NOT start a task.
    want: ["command.output"],
    deny: ["task.started"],
    assertData: (events) => {
      const out = events.find((e) => e.type === "command.output");
      if (!out) return "command.output missing";
      if (!Array.isArray(out.data?.ansi_lines) || out.data.ansi_lines.length === 0)
        return "command.output should carry non-empty ansi_lines";
      return null;
    },
  },
  {
    id: 13,
    label: "/clear → command.output{clear:true}，清空上下文",
    input: "/clear",
    // AC-CMD-003: /clear runs as a command (clear flag set), never as a task.
    want: ["command.output"],
    deny: ["task.started"],
    assertData: (events) => {
      const out = events.find((e) => e.type === "command.output");
      if (!out) return "command.output missing";
      if (out.data?.clear !== true) return "/clear must set command.output.clear=true";
      return null;
    },
  },
  {
    id: 10,
    label: "任务结束进入 Approval（不直接 completed）",
    input: "给我一份内部知识问答ROI示例",
    want: ["approval.requested", "pending.actions"],
    // a deliverable-producing task must NOT auto-complete — accept closes it later.
    deny: ["task.completed"],
  },
  {
    id: 11,
    label: "接受交付物后写 ProofPack 并完成（CC-PROOF-001）",
    // two lines: produce a deliverable, then accept it with the bare pending-action "1".
    inputs: ["给我一份内部知识问答ROI示例", "1"],
    want: ["approval.requested", "approval.accepted", "task.completed"],
    deny: [],
    assertData: (events) => {
      const acc = events.find((e) => e.type === "approval.accepted");
      if (!acc) return "approval.accepted missing";
      if (!acc.data?.proofpack) return "approval.accepted has no proofpack path";
      return null;
    },
  },
  {
    id: 14,
    // AC-IMG-002 / CC-PARTS-001: a user.message carrying an inline image part reaches the model as
    // an image_url content block. The mock model echoes the received block kinds into its reply
    // ("[parts-received: text,image_url] …"), so the assistant.rendered text proves the parts
    // downbridge fired end-to-end (JSONL → applyUserAction passthrough → runTurn → expandPartsToContent).
    label: "user.message parts[] → image_url content block 抵达模型（CC-PARTS-001）",
    input: JSON.stringify({
      type: "user.message",
      data: {
        text: "看看这张图 [Image 1]",
        parts: [
          { type: "text", text: "看看这张图 " },
          {
            type: "image",
            media_type: "image/png",
            // 1x1 transparent PNG
            data_url:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
          },
        ],
      },
    }),
    want: ["task.started", "assistant.rendered"],
    deny: [],
    assertData: (events) => {
      const rendered = events.find((e) => e.type === "assistant.rendered");
      if (!rendered) return "assistant.rendered missing";
      const joined = (rendered.data?.ansi_lines || []).join("\n");
      if (!/parts-received:[^\]]*image_url/.test(joined)) {
        return "model did not receive an image_url content block (parts downbridge broken)";
      }
      return null;
    },
  },
]);

function runVector(vector, { agent, root }) {
  return new Promise((resolve) => {
    const env = { ...process.env, CREW_MOCK: "1", CREW_TUI: "ratatui", CREWCLAW_ROOT: root };
    if (vector.scrubSearchKeys) {
      for (const k of ["TAVILY_API_KEY", "SERPER_API_KEY", "BRAVE_API_KEY", "SEARXNG_URL"]) delete env[k];
    }
    const child = spawn(process.execPath, [RUNTIME, agent], {
      env,
      cwd: join(HERE, "..", "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const killer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", () => {
      clearTimeout(killer);
      const events = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((e) => e && typeof e.type === "string");
      resolve({ events, stderr: err });
    });
    const lines = vector.inputs || [vector.input];
    // For a multi-line vector (produce → accept) the second line must arrive AFTER the
    // first turn emitted approval.requested; the bridge ignores input while busy, so a
    // small stagger keeps the accept from being dropped.
    let i = 0;
    const feed = () => {
      if (i >= lines.length) { child.stdin.end(); return; }
      child.stdin.write(lines[i++] + "\n");
      if (i < lines.length) setTimeout(feed, 1500);
      else setTimeout(() => child.stdin.end(), 500);
    };
    feed();
  });
}

function judge(vector, events) {
  const types = new Set(events.map((e) => e.type));
  const failures = [];
  for (const t of vector.want || []) if (!types.has(t)) failures.push(`missing ${t}`);
  for (const t of vector.deny || []) if (types.has(t)) failures.push(`unexpected ${t}`);
  if (vector.assertData) {
    const msg = vector.assertData(events);
    if (msg) failures.push(msg);
  }
  return { pass: failures.length === 0, failures };
}

export async function runConformance({ agent = "ai-adoption-whale" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "crew-conf-"));
  const results = [];
  try {
    for (const vector of LIVE_VECTORS) {
      const { events, stderr } = await runVector(vector, { agent, root });
      const verdict = judge(vector, events);
      results.push({ id: vector.id, label: vector.label, ...verdict, seen: [...new Set(events.map((e) => e.type))], stderr: verdict.pass ? "" : stderr.slice(-400) });
    }
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const agentIx = argv.indexOf("--agent");
  const agent = agentIx !== -1 ? argv[agentIx + 1] : "ai-adoption-whale";
  const results = await runConformance({ agent });
  const passed = results.filter((r) => r.pass).length;
  if (asJson) {
    console.log(JSON.stringify({ passed, total: results.length, results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(`${mark} [${r.id}] ${r.label}`);
      if (!r.pass) {
        console.log(`    ${r.failures.join("; ")}`);
        console.log(`    seen: ${r.seen.join(", ")}`);
        if (r.stderr) console.log(`    stderr: ${r.stderr.replace(/\n/g, " ")}`);
      }
    }
    console.log(`\nConformance: ${passed}/${results.length} vectors passed.`);
  }
  process.exit(passed === results.length ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
