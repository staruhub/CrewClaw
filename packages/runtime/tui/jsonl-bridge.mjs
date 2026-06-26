// tui/jsonl-bridge.mjs — headless event mode: the engine (this Node process) emits TaskEvents
// as JSONL to stdout and reads user input lines from stdin. A Rust/Ratatui (or any) front-end
// reduces the JSONL into AppState and renders. This is the "RatatuiRenderer" backend — the
// renderer-agnostic protocol carried over a process boundary (exactly what the protocol's
// serializable { type, ts, data } shape was built for).
//
// Wire format: one JSON object per line, e.g.
//   {"type":"task.started","ts":1719,"data":{"id":"turn1","title":"...","mode":"Chat"}}
//   {"type":"token.delta","ts":1719,"data":{"text":"…"}}
//   {"type":"approval.required","ts":1719,"data":{"id":"appr1","reason":"执行命令: …"}}
// Input lines are either a new task OR — while an approval is pending — the a/d/y/n decision.
// Event-driven (rl.on("line")) NOT for-await: the front's decision line must be read WHILE the
// agent is blocked inside confirm(), which a blocking for-await loop could never reach.
import { createInterface } from "node:readline";
import { makeEvent, EVENTS } from "./protocol.mjs";
import { buildRunTurn } from "./repl.mjs";
import { routeTurn } from "./route.mjs";

export async function startJsonlBridge({
  agentLoop, agentLoopDeps, agentName = "鲸", meta = {}, history = [], saveSession,
  input = process.stdin, output = process.stdout, // injectable for tests
}) {
  let sessionPendingActions = []; // last task's actions — digit input matches these (§6.4)
  const emit = (type, data) => {
    if (type === EVENTS.PENDING_ACTIONS) sessionPendingActions = (data && data.actions) || [];
    output.write(JSON.stringify(makeEvent(type, data, Date.now())) + "\n");
  };

  // a header event so the front-end can paint the badge + tool/memory truth immediately
  emit("session.ready", { employee: { name: agentName, role: meta.role, mode: meta.mode, model: meta.model } });

  let turnSeq = 0, toolSeq = 0, apprSeq = 0;
  let pendingConfirm = null; // resolver set while agentLoop awaits an approval decision (§14.3)
  let busy = false;          // one task at a time (the front sends a line per Enter)

  const sink = {
    onDelta: (text) => emit(EVENTS.TOKEN_DELTA, { text }),
    onInvocation: (inv = {}) => {
      const id = "tool" + ++toolSeq;
      emit(EVENTS.TOOL_REQUESTED, { id, tool: inv.toolName, label: inv.line || inv.action || inv.toolName });
      const failed = inv.status === "blocked" || inv.status === "error";
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, { id, summary: inv.action, code: failed ? (inv.code || inv.action) : undefined });
    },
    onUsage: (u) => { if (u) emit(EVENTS.TOKEN_USAGE, { prompt: u.prompt_tokens, completion: u.completion_tokens }); },
    // L2 approval over the process boundary: emit APPROVAL_REQUIRED, await the front's a/d line.
    confirm: (msg, info = {}) => {
      emit(EVENTS.APPROVAL_REQUIRED, { id: "appr" + ++apprSeq, tool: info.tool || info.toolName, reason: typeof msg === "string" ? msg : info.reason, scope: info.scope });
      return new Promise((resolve) => { pendingConfirm = resolve; });
    },
  };

  const runTurn = buildRunTurn({ agentLoop, agentLoopDeps, history, saveSession });
  const rl = createInterface({ input });

  rl.on("line", async (raw) => {
    const text = String(raw).trim();
    // while the agent awaits approval, the next line IS the a/d/y/n decision — not a new task
    if (pendingConfirm) {
      const allow = text === "a" || text === "allow" || text === "y" || text === "是";
      const resolve = pendingConfirm; pendingConfirm = null;
      emit(EVENTS.APPROVAL_RESOLVED, { decision: allow ? "allow" : "deny" });
      resolve(allow);
      return;
    }
    if (!text) return;
    if (text === "/exit" || text === ":q") { rl.close(); return; }
    if (busy) return; // a task is already running; ignore stray input
    busy = true;
    emit(EVENTS.TASK_STARTED, { id: "turn" + ++turnSeq, title: text, mode: meta.mode });
    try {
      // same §6 Router as the Ink renderer — chat→workbench logic lives once in the engine
      await routeTurn(text, {
        emit,
        runModelTurn: (msg) => runTurn(msg, sink),
        pendingActions: sessionPendingActions,
        employeeScope: meta.employeeScope,
        env: process.env,
        role: meta.role,
        taskRunId: `turn-${turnSeq}-${Date.now()}`,
        root: process.env.CREWCLAW_ROOT || process.cwd(),
      });
      emit(EVENTS.TASK_COMPLETED, {});
    } catch (e) {
      emit(EVENTS.TASK_REJECTED, { reason: String((e && e.message) || e) });
    } finally {
      busy = false;
    }
  });

  await new Promise((resolve) => rl.on("close", resolve));
}
