// tui/chat.mjs — the full-screen Ink REPL for `crew chat` (inline model: native terminal
// scrollback via <Static>, flicker-free dynamic frame at the bottom). UI-ONLY: the actual
// model turn is injected as `runTurn(text, {onDelta,onInvocation,onUsage})`, so this file
// never imports run.mjs (no model/gateway/budget logic, no run.mjs edit conflicts). The
// markdown renderer is injected as `renderLines(text) -> string[]` (ui-markdown.renderMessage).
import React from "react";
import { render, Box, Static, Text, useInput, useApp } from "ink";
import htm from "htm";
import { createChatStore } from "./store.mjs";
import { UserMessage, AssistantMessage, StatusBar } from "./components.mjs";
import { theme, glyphs } from "./theme.mjs";

const html = htm.bind(React.createElement);
const isTTY = !!process.stdin.isTTY;

// Coalesce the store's per-token emits to ~30fps so React doesn't reconcile per character
// (the throttle the flicker research flagged — Ink still diffs, but we feed it fewer frames).
function useStore(store) {
  const subscribe = React.useCallback((cb) => {
    let t = null;
    const onChange = () => { if (t) return; t = setTimeout(() => { t = null; cb(); }, 33); };
    const off = store.subscribe(onChange);
    return () => { if (t) clearTimeout(t); off(); };
  }, [store]);
  return React.useSyncExternalStore(subscribe, () => store.get());
}

export function ChatApp({ store, runTurn, agentName, renderLines, submitRef }) {
  const state = useStore(store);
  const { exit } = useApp();
  const [input, setInput] = React.useState("");
  const busy = state.status === "thinking" || state.status === "streaming" || state.status === "tool";

  const submit = React.useCallback(async (text) => {
    if (!text || !text.trim()) return;
    store.pushUser(text);
    store.beginTurn();
    try {
      await runTurn(text, {
        onDelta: (d) => store.appendDelta(d),
        onInvocation: (inv) => store.addTool(inv),
        onUsage: (u) => store.addUsage(u),
      });
      store.commitTurn();
    } catch (e) {
      store.setError(String((e && e.message) || e));
    }
  }, [store, runTurn]);

  React.useEffect(() => { if (submitRef) submitRef.current = submit; }, [submit, submitRef]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }
    if (busy) return; // ignore typing mid-turn
    if (key.return) { const t = input; setInput(""); submit(t); return; }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch);
  }, { isActive: isTTY });

  const tokens = state.usage.promptTok + state.usage.completionTok;
  return html`
    <${Box} flexDirection="column">
      <${Static} items=${state.messages}>
        ${(m, i) => m.role === "user"
          ? html`<${UserMessage} key=${i} text=${m.text} />`
          : html`<${AssistantMessage} key=${i} name=${agentName} parts=${m.parts} renderLines=${renderLines} />`}
      </>
      ${state.live
        ? html`<${AssistantMessage} name=${agentName} parts=${state.live.parts} renderLines=${renderLines} caret=${true} />`
        : null}
      <${Box} marginTop=${1} flexDirection="column">
        <${StatusBar} name=${agentName} status=${state.status} tokens=${tokens} />
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
export function mountChat({ runTurn, agentName = "鲸", renderLines = (t) => String(t).split("\n"), initialMessages = [] }) {
  const store = createChatStore({ messages: initialMessages });
  const submitRef = { current: null };
  const app = render(html`<${ChatApp} store=${store} runTurn=${runTurn} agentName=${agentName} renderLines=${renderLines} submitRef=${submitRef} />`);
  return {
    store,
    submit: (t) => submitRef.current && submitRef.current(t),
    unmount: app.unmount,
    waitUntilExit: app.waitUntilExit,
  };
}
