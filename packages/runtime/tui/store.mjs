// tui/store.mjs — the observable chat state that bridges the raw runtime and the Ink UI.
// agentLoop's existing callbacks (onDelta / onInvocation / onUsage) write here; the Ink
// <Chat> subscribes and renders. Keeping state OUTSIDE React means the runtime drives it
// with zero React knowledge, and we can unit-test the whole state machine with no TTY.
//
// Streaming note: appendDelta fires per-token (high frequency). The React side throttles
// snapshots to ~frame rate (see the subscribe hook) — the store itself stays synchronous
// and authoritative so tests are deterministic.
export function createChatStore(initial = {}) {
  let state = {
    messages: [],   // committed turns: { role:'user'|'assistant', text, tools:[] }
    live: null,     // the in-flight assistant turn: { text, tools:[] } | null
    status: "idle", // 'idle' | 'thinking' | 'streaming' | 'tool' | 'error'
    usage: { promptTok: 0, completionTok: 0, lastPromptTok: 0 },
    ...initial,
  };
  const subs = new Set();
  const emit = () => { for (const fn of subs) fn(state); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  return {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    // user submits a prompt → a committed user turn
    pushUser(text) {
      set({ messages: [...state.messages, { role: "user", text, tools: [] }] });
    },
    // a model turn begins (spinner state until first delta)
    beginTurn() { set({ live: { text: "", tools: [] }, status: "thinking" }); },
    appendDelta(d) {
      if (!state.live) return;
      set({ live: { ...state.live, text: state.live.text + d }, status: "streaming" });
    },
    addTool(inv) {
      const live = state.live || { text: "", tools: [] };
      set({ live: { ...live, tools: [...live.tools, inv] }, status: "tool" });
    },
    addUsage(u) {
      if (!u) return;
      set({
        usage: {
          promptTok: state.usage.promptTok + (u.prompt_tokens || 0),
          completionTok: state.usage.completionTok + (u.completion_tokens || 0),
          lastPromptTok: u.prompt_tokens || state.usage.lastPromptTok,
        },
      });
    },
    // turn finishes: move the live turn into committed history (so <Static> commits it
    // to scrollback and never repaints it again — the OpenTUI commit pattern).
    commitTurn() {
      if (!state.live) { set({ status: "idle" }); return; }
      const { text, tools } = state.live;
      // drop an empty assistant turn that produced only tool calls + no prose
      const committed = text.trim() || tools.length
        ? [...state.messages, { role: "assistant", text, tools }]
        : state.messages;
      set({ messages: committed, live: null, status: "idle" });
    },
    setStatus(status) { set({ status }); },
    setError(text) {
      // keep whatever streamed so "继续" can resume; mark the turn errored
      if (state.live) {
        set({ messages: [...state.messages, { role: "assistant", text: state.live.text, tools: state.live.tools, errored: true }], live: null, status: "error" });
      } else {
        set({ status: "error" });
      }
    },
  };
}
