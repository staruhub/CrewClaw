// Pure per-turn runners shared by Ink and JSONL frontends. This file must not
// import React/Ink so headless JSONL tests can run with only Node built-ins.

import { expandPartsToContent } from "./parts.mjs";

export function historyToTurns(history) {
  const out = [];
  for (const m of history || []) {
    if (m.role === "user") {
      out.push({
        role: "user",
        text: typeof m.content === "string" ? m.content : "（含附件）",
      });
    } else if (m.role === "assistant" && m.content && !m.tool_calls) {
      out.push({
        role: "assistant",
        app: {
          timeline: [],
          answer: m.content,
          tools: {},
          evidence: [],
          artifacts: [],
          usage: { promptTok: 0, completionTok: 0 },
          status: "done",
        },
      });
    }
  }
  return out;
}

export function buildRunTurn({
  agentLoop,
  agentLoopDeps = {},
  history,
  saveSession,
  root,
}) {
  // `input` is either a plain string (legacy) or {text, parts} (v0.8 M6). With parts, expand
  // attachments to content blocks via the shared parts.mjs; without, push the string unchanged.
  return async function runTurn(input, sink) {
    const content =
      typeof input === "string"
        ? input
        : await expandPartsToContent(input, {
            root: root || agentLoopDeps.root,
          });
    history.push({ role: "user", content });
    const output = await agentLoop({
      ...agentLoopDeps,
      messages: history,
      renderMd: false,
      onDelta: sink.onDelta,
      onThinking: sink.onThinking,
      onInvocation: sink.onInvocation,
      onUsage: sink.onUsage,
      confirm: sink.confirm || agentLoopDeps.confirm,
    });
    if (saveSession) saveSession();
    return output;
  };
}

export function buildQuickUtilityTurn({ agentLoop, agentLoopDeps = {} }) {
  const LIGHT_SYSTEM =
    "你是一个通用快捷助手。请简短、直接地回答用户这一个快捷问题(天气/时间/单位换算等),不要展开,也不要使用任何员工的专业身份或长期上下文。";
  return async function runQuickUtility(text, sink) {
    return agentLoop({
      ...agentLoopDeps,
      system: LIGHT_SYSTEM,
      messages: [{ role: "user", content: text }],
      renderMd: false,
      onDelta: sink.onDelta,
      onThinking: sink.onThinking,
      onInvocation: sink.onInvocation,
      onUsage: sink.onUsage,
      confirm: sink.confirm || agentLoopDeps.confirm,
    });
  };
}
