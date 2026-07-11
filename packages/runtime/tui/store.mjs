// tui/store.mjs — the observable chat state bridging the raw runtime and the Ink UI.
// agentLoop's callbacks (onDelta/onInvocation/onUsage) write here; the Ink <Chat>
// subscribes. State lives OUTSIDE React so the runtime drives it with no React knowledge
// and the whole machine is unit-testable with no TTY.
//
// A turn is an ORDERED list of parts (OpenCode/Crush model): text deltas accrete into the
// current text part; a tool call closes it and pushes a tool part; the next delta starts a
// fresh text part. So tools render exactly where they happened (plan → tool → answer),
// never dumped after the prose.
export function createChatStore(initial = {}) {
  let state = {
    messages: [], // committed: { role:'user', text } | { role:'assistant', parts:[...] }
    live: null, // in-flight assistant turn: { parts:[...] } | null
    status: "idle", // 'idle' | 'thinking' | 'streaming' | 'tool' | 'error'
    usage: { promptTok: 0, completionTok: 0, lastPromptTok: 0 },
    ...initial,
  };
  const subs = new Set();
  const emit = () => {
    for (const fn of subs) fn(state);
  };
  const set = patch => {
    state = { ...state, ...patch };
    emit();
  };

  // append a text delta to the trailing text part, or start a new one if the last part
  // is a tool (so tool parts stay interleaved in execution order)
  const withDelta = (parts, d) => {
    const last = parts[parts.length - 1];
    if (last && last.type === "text")
      return [...parts.slice(0, -1), { type: "text", text: last.text + d }];
    return [...parts, { type: "text", text: d }];
  };
  const hasContent = parts =>
    parts.some(p => (p.type === "text" && p.text.trim()) || p.type === "tool");

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    pushUser(text) {
      set({ messages: [...state.messages, { role: "user", text }] });
    },
    beginTurn() {
      set({ live: { parts: [] }, status: "thinking" });
    },
    appendDelta(d) {
      if (!state.live) return;
      set({
        live: { parts: withDelta(state.live.parts, d) },
        status: "streaming",
      });
    },
    addTool(inv) {
      const live = state.live || { parts: [] };
      set({
        live: { parts: [...live.parts, { type: "tool", tool: inv }] },
        status: "tool",
      });
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
    // turn finishes: move the ordered parts into committed history (Ink <Static> commits
    // it to scrollback and never repaints it again)
    commitTurn() {
      if (!state.live) {
        set({ status: "idle" });
        return;
      }
      const parts = state.live.parts;
      const committed = hasContent(parts)
        ? [...state.messages, { role: "assistant", parts }]
        : state.messages;
      set({ messages: committed, live: null, status: "idle" });
    },
    setStatus(status) {
      set({ status });
    },
    setError() {
      if (state.live) {
        set({
          messages: [
            ...state.messages,
            { role: "assistant", parts: state.live.parts, errored: true },
          ],
          live: null,
          status: "error",
        });
      } else {
        set({ status: "error" });
      }
    },
  };
}
