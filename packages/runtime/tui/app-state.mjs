// tui/app-state.mjs — the AppState reducer. RENDERER-AGNOSTIC core of the Crew Workbench
// Framework: reduce(state, taskEvent) folds the event stream into the workbench state every
// renderer draws. Components read AppState SLICES (timeline / tools / artifacts / evidence /
// approval), never the model's raw text. Pure + deterministic → unit-testable with no TTY.
// Event payloads live under ev.data (namespaced — see protocol.makeEvent).
import { EVENTS } from "./protocol.mjs";

// status symbols — don't rely on color alone (vision UI standard)
export const SYM = { running: "→", ok: "✓", fail: "✗", warn: "!", wait: "?" };

export function initialAppState(meta = {}) {
  return {
    employee: meta.employee || null, // { name, role, model }
    mode: meta.mode || "Chat",       // Chat | Run | Trial | Doctor | ...
    task: null,                      // { id, title, status }
    plan: null,                      // { steps:[], status }
    timeline: [],                    // [{ id, status: SYM.*, label, detail }]
    tools: {},                       // Tool Truth State: { [id]: { tool, status, summary, args } }
    artifacts: [],                   // [{ id, name, type, status, checks }]
    evidence: [],                    // [{ id, fact, source, confidence }]
    approval: null,                  // { id, tool, reason, scope }
    answer: "",                      // current assistant deliverable text (later → semantic blocks)
    usage: { promptTok: 0, completionTok: 0 },
    status: "idle",                  // idle | running | awaiting_approval | done | rejected
    debug: [],                       // raw log lines (debug drawer)
    pendingActions: [],              // [{ key, label, action_type, payload }] (§5.6) — digit input matches here FIRST
    memory: { session: "available", persistent: "unavailable", workspace: "unavailable" }, // Memory Truth (§9.8)
    quickUtility: null,              // QuickUtilityRun result card (§5.3) — NOT a TaskRun
    proof: null,                     // completion verdict { valid, deliverable, gaps } (§5.8 No-Chat-only-Done)
  };
}

const idFor = (state, d) => (d.id != null ? d.id : "ln" + state.timeline.length);
const push = (timeline, id, status, label, detail) => [...timeline, { id, status, label: label || "", detail: detail || "" }];
function mark(timeline, id, status, detail) {
  let idx = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const l = timeline[i];
    if (id != null ? l.id === id : (l.status === SYM.running || l.status === SYM.wait)) { idx = i; break; }
  }
  if (idx < 0) return timeline;
  const copy = timeline.slice();
  copy[idx] = { ...copy[idx], status, detail: detail || copy[idx].detail };
  return copy;
}
const setTool = (tools, id, patch) => ({ ...tools, [id]: { ...(tools[id] || {}), ...patch } });

export function reduce(state, ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case EVENTS.TASK_STARTED:
      return { ...state, task: { id: d.id, title: d.title || "", status: "running" }, mode: d.mode || state.mode, status: "running", answer: "", timeline: push(state.timeline, idFor(state, d), SYM.running, `任务：${d.title || ""}`) };
    case EVENTS.PLAN_CREATED:
      return { ...state, plan: { steps: d.steps || [], status: "proposed" }, timeline: push(state.timeline, idFor(state, d), SYM.ok, "生成计划", (d.steps || []).join(" · ")) };
    case EVENTS.PLAN_APPROVED:
      return { ...state, plan: state.plan ? { ...state.plan, status: "approved" } : state.plan };
    case EVENTS.STEP_STARTED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), SYM.running, d.label) };
    case EVENTS.STEP_COMPLETED:
      return { ...state, timeline: mark(state.timeline, d.id, SYM.ok, d.summary) };
    case EVENTS.TOOL_REQUESTED:
      return {
        ...state,
        tools: setTool(state.tools, d.id, { tool: d.tool, status: "running", args: d.args }),
        approval: d.needsApproval ? { id: d.id, tool: d.tool, reason: d.reason, scope: d.scope } : state.approval,
        status: d.needsApproval ? "awaiting_approval" : state.status,
        timeline: push(state.timeline, idFor(state, d), d.needsApproval ? SYM.wait : SYM.running, d.label || d.tool, d.reason),
      };
    case EVENTS.TOOL_SUCCEEDED:
      return { ...state, tools: setTool(state.tools, d.id, { status: "ok", summary: d.summary }), timeline: mark(state.timeline, d.id, SYM.ok, d.summary) };
    case EVENTS.TOOL_FAILED:
      return { ...state, tools: setTool(state.tools, d.id, { status: "failed", summary: d.code || d.error }), timeline: mark(state.timeline, d.id, SYM.fail, d.code || d.error) };
    case EVENTS.ARTIFACT_CREATED:
      return { ...state, artifacts: [...state.artifacts, { id: d.id, name: d.name, kind: d.kind || d.type, type: d.type || d.kind, path: d.path, status: d.status || "draft", checks: d.checks || [] }], timeline: push(state.timeline, idFor(state, d), SYM.ok, `交付物：${d.name || ""}`, d.path) };
    case EVENTS.ARTIFACT_UPDATED:
      return { ...state, artifacts: state.artifacts.map((a) => (a.id === d.id ? { ...a, ...(d.patch || {}) } : a)) };
    case EVENTS.EVIDENCE_CREATED:
      return { ...state, evidence: [...state.evidence, { id: d.id, fact: d.fact, source: d.source, confidence: d.confidence }] };
    case EVENTS.APPROVAL_REQUIRED:
      return { ...state, approval: { id: d.id, tool: d.tool, reason: d.reason, scope: d.scope }, status: "awaiting_approval" };
    case EVENTS.APPROVAL_RESOLVED:
      return { ...state, approval: null, status: state.task ? "running" : "idle" };
    case EVENTS.TOKEN_DELTA:
      return { ...state, answer: state.answer + (d.text || ""), status: state.status === "idle" ? "running" : state.status };
    case EVENTS.TOKEN_USAGE:
      return { ...state, usage: { promptTok: state.usage.promptTok + (d.prompt || 0), completionTok: state.usage.completionTok + (d.completion || 0) } };
    case EVENTS.TASK_COMPLETED:
      return { ...state, task: state.task ? { ...state.task, status: "done" } : null, status: "done", timeline: push(state.timeline, idFor(state, d), SYM.ok, "完成") };
    case EVENTS.TASK_REJECTED:
      return { ...state, task: state.task ? { ...state.task, status: "rejected" } : null, status: "rejected", timeline: push(state.timeline, idFor(state, d), SYM.fail, `打回：${d.reason || ""}`) };
    // v0.6 — chat-to-workbench hardening
    case EVENTS.TASK_UPGRADED_FROM_CHAT:
      return { ...state, mode: "chat-upgraded", timeline: push(state.timeline, idFor(state, d), SYM.ok, "↑ 从对话升级为 TaskRun", d.reason) };
    case EVENTS.SKILL_LAUNCHED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), SYM.running, `启动技能：${d.skill || d.name || ""}`) };
    case EVENTS.TOOL_PREFLIGHT_CHECKED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), d.ok === false ? SYM.warn : SYM.ok, `预检：${d.label || ""}`, d.detail) };
    case EVENTS.SOURCE_CHECKED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), d.ok === false ? SYM.warn : SYM.ok, `核对来源：${d.source || ""}`, d.detail) };
    case EVENTS.PENDING_ACTIONS:
      return { ...state, pendingActions: d.actions || [] };
    case EVENTS.QUICK_UTILITY:
      return { ...state, quickUtility: { intent: d.intent, result: d.result, source: d.source, status: d.status } };
    case EVENTS.MEMORY_STATE:
      return { ...state, memory: { ...state.memory, ...(d.memory || {}) } };
    case EVENTS.MEMORY_REQUESTED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), SYM.wait, `记忆请求：${d.summary || ""}`) };
    case EVENTS.MEMORY_SAVED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), SYM.ok, `记忆已存：${d.summary || ""}`, d.scope) };
    case EVENTS.WORKSPACE_REVEALED:
      return { ...state, timeline: push(state.timeline, idFor(state, d), d.ok === false ? SYM.warn : SYM.ok, d.ok === false ? "无法打开,路径已给" : "打开位置", d.path) };
    case EVENTS.OUTCOME_CHECKED:
      return { ...state, proof: { valid: d.valid !== false, deliverable: d.deliverable || null, gaps: d.gaps || [], reason: d.reason || "" }, timeline: push(state.timeline, idFor(state, d), d.valid === false ? SYM.warn : SYM.ok, d.valid === false ? "验收：未达标" : "验收：可交付", d.reason || d.deliverable) };
    default:
      return state;
  }
}

// Fold a whole event list (e.g. a replayed run.jsonl) — handy for tests + session restore.
export function reduceAll(events, meta = {}) {
  return (events || []).reduce(reduce, initialAppState(meta));
}
