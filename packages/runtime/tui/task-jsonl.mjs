import { EVENTS, makeEvent } from "./protocol.mjs";

export function createTaskJsonlEmitter({ output = process.stdout, now = Date.now } = {}) {
  return function emit(type, data = {}) {
    output.write(JSON.stringify(makeEvent(type, data, now())) + "\n");
  };
}

const USER_ACTION_TYPES = new Set([
  "user.message",
  "pending.run",
  "artifact.preview",
  "artifact.delete",
  "artifact.reveal",
  "artifact.export",
  "approval.resolve",
]);

export function parseUserActionLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    return { type: "user.message", data: { text, refs: [] } };
  }

  const action = JSON.parse(text);
  if (!action || typeof action !== "object" || !USER_ACTION_TYPES.has(action.type)) {
    return { type: "user.message", data: { text, refs: [] } };
  }
  if (!action.data || typeof action.data !== "object") {
    throw new Error(`UserAction ${action.type} missing data`);
  }
  return action;
}

export function applyUserAction(action, { emit }) {
  if (!action) return { handled: true };
  const data = action.data || {};
  switch (action.type) {
    case "artifact.preview":
      emit(EVENTS.ARTIFACT_SELECTED, { artifact_id: requiredArtifactId(data) });
      return { handled: true };
    case "artifact.delete":
      emit(EVENTS.ARTIFACT_DELETED, { artifact_id: requiredArtifactId(data) });
      return { handled: true };
    case "artifact.reveal":
      emit(EVENTS.ARTIFACT_REVEALED, { artifact_id: requiredArtifactId(data), ok: true });
      return { handled: true };
    case "artifact.export":
      emit(EVENTS.ARTIFACT_UPDATED, {
        id: requiredArtifactId(data),
        patch: { status: "exported" },
      });
      return { handled: true };
    case "approval.resolve": {
      const accepted = data.decision === "accept" || data.decision === "allow" || data.decision === "yes";
      emit(accepted ? EVENTS.APPROVAL_ACCEPTED : EVENTS.APPROVAL_REJECTED, {
        id: data.id,
        decision: accepted ? "accept" : "reject",
      });
      return { handled: true, approval: accepted };
    }
    case "pending.run":
      emit(EVENTS.DEBUG_LINE, { line: `pending action ${data.key}${data.command ? ` ${data.command}` : ""}` });
      return { handled: false, text: data.command || data.label || data.key };
    case "user.message":
      // v0.8 M6：透传结构化 parts（可选）。老前端不发 parts → undefined，下游降级纯文本。
      return {
        handled: false,
        text: data.text || "",
        refs: Array.isArray(data.refs) ? data.refs : [],
        parts: Array.isArray(data.parts) ? data.parts : undefined,
      };
    default:
      return { handled: false, text: "" };
  }
}

function requiredArtifactId(data) {
  const id = data.artifact_id || data.artifactId || data.id;
  if (!id) throw new Error("artifact UserAction missing artifact_id");
  return id;
}

export function createTaskModeSink({ emit }) {
  let toolSeq = 0;

  return {
    emitRaw(type, data = {}) {
      emit(type, data);
    },

    sessionReady({ name, role, mode = "Task", model }) {
      emit("session.ready", { employee: { name, role, mode, model } });
    },

    taskStarted({ id, title, mode = "Task" }) {
      emit(EVENTS.TASK_STARTED, { id, title, mode });
    },

    planCreated({ id, steps }) {
      emit(EVENTS.PLAN_CREATED, { id, steps });
    },

    toolPreflightChecked({ id, tool, status, reason }) {
      emit(EVENTS.TOOL_PREFLIGHT_CHECKED, { id, tool, status, reason });
    },

    onDelta(text) {
      if (text) emit(EVENTS.TOKEN_DELTA, { text });
    },

    onInvocation(invocation = {}) {
      const id = "tool" + ++toolSeq;
      const tool = invocation.toolName || invocation.tool || "tool";
      const label = invocation.line || invocation.action || tool;
      emit(EVENTS.TOOL_REQUESTED, { id, tool, label });
      const failed = invocation.status === "blocked" || invocation.status === "error";
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, {
        id,
        summary: invocation.action || label,
        code: failed ? invocation.code || invocation.decision || invocation.status : undefined,
      });
    },

    onUsage(usage) {
      if (usage) {
        emit(EVENTS.TOKEN_USAGE, {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
        });
      }
    },

    approvalRequired({ id, tool, reason, scope }) {
      emit(EVENTS.APPROVAL_REQUIRED, { id, tool, reason, scope });
    },

    artifactCreated({ id, name, kind, path, status = "ready", checks }) {
      emit(EVENTS.ARTIFACT_CREATED, { id, name, kind, path, status, checks });
    },

    outcomeChecked(data) {
      emit(EVENTS.OUTCOME_CHECKED, data);
    },

    memorySaved(data) {
      emit(EVENTS.MEMORY_SAVED, data);
    },

    taskCompleted(data = {}) {
      emit(EVENTS.TASK_COMPLETED, data);
    },

    taskRejected(data = {}) {
      emit(EVENTS.TASK_REJECTED, data);
    },
  };
}
