// tui/chat.mjs — the full-screen Ink REPL for `crew chat`, TaskRun-centric (the workbench).
// Each user turn spawns a TaskRun: agentLoop streams into it via the bridge sink, AppState
// reduces, TurnView renders the WORK TIMELINE (not a message stream — the iron law). UI-only;
// runTurn + renderLines are injected so this never imports run.mjs.
import React from "react";
import { render, Box, Static, Text, useInput, useApp } from "ink";
import htm from "htm";
import { createWorkbenchStore } from "./workbench-store.mjs";
import { routeTurn } from "./route.mjs";
import { UserMessage, TurnView, StatusHeader } from "./components.mjs";
import { theme, glyphs } from "./theme.mjs";
import { getToolTruth } from "../tool-truth.mjs";
import { getMemoryTruth } from "../memory-harness.mjs";
import { costFor } from "../ui-topbar.mjs";

const html = htm.bind(React.createElement);
const isTTY = !!process.stdin.isTTY;
const TOOLS = getToolTruth();    // fine-grained per-capability truth (§9), computed once
const MEMORY = getMemoryTruth();  // Memory Truth (§9.8)

// AppState status → StatusHeader label key
const STATUS_MAP = { idle: "idle", running: "streaming", awaiting_approval: "tool", done: "idle", rejected: "error", error: "error" };

// Coalesce the store's bursty emits to ~30fps so React doesn't reconcile per token.
function useStore(store) {
  const subscribe = React.useCallback((cb) => {
    let t = null;
    const onChange = () => { if (t) return; t = setTimeout(() => { t = null; cb(); }, 33); };
    const off = store.subscribe(onChange);
    return () => { if (t) clearTimeout(t); off(); };
  }, [store]);
  return React.useSyncExternalStore(subscribe, () => store.get());
}

export function ChatApp({ store, runTurn, agentName, renderLines, submitRef, meta = {} }) {
  const state = useStore(store);
  const { exit } = useApp();
  const [input, setInput] = React.useState("");
  const busy = !!state.live;

  const submit = React.useCallback(async (text) => {
    if (!text || !text.trim()) return;
    store.pushUser(text);
    const run = store.startTurn({ title: text, mode: meta.mode });
    try {
      // §6 Intent/Scope Router decides what to do: upgrade to TaskRun / quick utility /
      // memory / matched PendingAction / decline — then runs the model turn if appropriate.
      await routeTurn(text, {
        emit: (type, data) => run.emit(type, data),
        runModelTurn: (msg) => runTurn(msg, run.sink),
        pendingActions: run.get().pendingActions,
        employeeScope: meta.employeeScope,
        env: process.env,
        role: meta.role,
        taskRunId: `chat-${Date.now()}`,
        root: process.env.CREWCLAW_ROOT || process.cwd(),
      });
      store.commitTurn();
    } catch (e) {
      store.failTurn(String((e && e.message) || e));
    }
  }, [store, runTurn, meta]);

  React.useEffect(() => { if (submitRef) submitRef.current = submit; }, [submit, submitRef]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }
    // L2 approval modal: while the agent awaits a decision, a/d (or y/n) decide; swallow the
    // rest so the human gate can't be typed past (§14.3 — replaces the old auto-yes).
    if (state.live && state.live.approval) {
      if (ch === "a" || ch === "y") store.resolveApproval("allow");
      else if (ch === "d" || ch === "n") store.resolveApproval("deny");
      return;
    }
    if (busy) return; // ignore typing mid-turn
    if (key.return) { const t = input; setInput(""); submit(t); return; }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch);
  }, { isActive: isTTY });

  const liveUsage = (state.live && state.live.usage) || { promptTok: 0, completionTok: 0 };
  const promptTok = state.sessionUsage.promptTok + (liveUsage.promptTok || 0);
  const completionTok = state.sessionUsage.completionTok + (liveUsage.completionTok || 0);
  const tokens = promptTok + completionTok;
  const rawCost = meta.model ? costFor(meta.model, promptTok, completionTok) : 0;
  const costText = typeof rawCost === "string" ? rawCost : "$" + (Number(rawCost) || 0).toFixed(2);
  const headerStatus = STATUS_MAP[state.live ? state.live.status : "idle"] || "idle";

  return html`
    <${Box} flexDirection="column">
      <${Static} items=${state.turns}>
        ${(t, i) => t.role === "user"
          ? html`<${UserMessage} key=${i} text=${t.text} />`
          : html`<${TurnView} key=${i} state=${t.app} name=${agentName} renderLines=${renderLines} />`}
      </>
      ${state.live ? html`<${TurnView} state=${state.live} name=${agentName} renderLines=${renderLines} caret=${true} />` : null}
      ${state.live && state.live.approval ? html`
        <${Box} marginTop=${1} borderStyle="round" borderColor="yellow" paddingX=${1} flexDirection="column">
          <${Text} color="yellow" bold>⚠ 需要授权${state.live.approval.tool ? " · " + state.live.approval.tool : ""}</>
          <${Text}>${state.live.approval.reason || "敏感操作,请确认"}</>
          <${Text} dimColor>[a] 允许执行    [d] 拒绝</>
        </>` : null}
      <${Box} marginTop=${1} flexDirection="column">
        <${StatusHeader} name=${agentName} role=${meta.role} mode=${meta.mode || "Chat"} status=${headerStatus} tokens=${tokens} costText=${costText} toolTruth=${TOOLS} memory=${MEMORY} />
        <${Box}>
          <${Text} color=${theme.user}>${glyphs.userRail + " "}</>
          <${Text}>${input}</>
          <${Text} dimColor>${busy ? " (生成中…)" : "▏"}</>
        </>
      </>
    </>
  `;
}

// Mount the chat UI. Returns { store, submit, unmount, waitUntilExit }. `submit` lets a
// non-TTY harness drive a turn without keyboard input (used by the demo/tests).
export function mountChat({ runTurn, agentName = "鲸", renderLines = (t) => String(t).split("\n"), initialTurns = [], meta = {} }) {
  const store = createWorkbenchStore(meta, initialTurns);
  const submitRef = { current: null };
  const app = render(html`<${ChatApp} store=${store} runTurn=${runTurn} agentName=${agentName} renderLines=${renderLines} submitRef=${submitRef} meta=${meta} />`);
  return {
    store,
    submit: (t) => submitRef.current && submitRef.current(t),
    unmount: app.unmount,
    waitUntilExit: app.waitUntilExit,
  };
}
