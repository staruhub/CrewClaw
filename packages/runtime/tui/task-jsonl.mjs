import { EVENTS, makeEvent } from "./protocol.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  readArtifactFileGuarded,
  revealStrategy,
  verifyGuardedArtifactFingerprint,
} from "../artifact-contract.mjs";
import { readStateFileGuarded, writeStateFileAtomic } from "../state-lock.mjs";

export function createTaskJsonlEmitter({
  output = process.stdout,
  now = Date.now,
} = {}) {
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

const PREFLIGHT_FAILURE_STATUSES = new Set([
  "blocked",
  "failed",
  "missing_key",
  "unavailable",
  "error",
]);
const APPROVAL_ALLOW_DECISIONS = new Set(["accept", "allow", "yes"]);
const APPROVAL_DENY_DECISIONS = new Set(["reject", "deny", "no"]);

export function parseUserActionLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    return { type: "user.message", data: { text, refs: [] } };
  }

  const action = JSON.parse(text);
  if (
    !action ||
    typeof action !== "object" ||
    !USER_ACTION_TYPES.has(action.type)
  ) {
    return { type: "user.message", data: { text, refs: [] } };
  }
  if (!action.data || typeof action.data !== "object") {
    throw new Error(`UserAction ${action.type} missing data`);
  }
  return action;
}

export function applyUserAction(
  action,
  {
    emit = () => {},
    resolveArtifact,
    root = process.cwd(),
    executeReveal = executeRevealStrategy,
  } = {}
) {
  if (!action) return { handled: true };
  const data = action.data || {};
  switch (action.type) {
    case "artifact.preview": {
      const id = artifactIdOrError(data, emit, action.type);
      if (!id)
        return { handled: true, ok: false, error: "missing artifact_id" };
      const record = resolveArtifact?.(id);
      const guarded = guardArtifactRecord(root, record);
      if (!guarded.ok) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_SELECTED,
          id,
          record,
          guarded.code,
          guarded.reason
        );
      }
      emit(
        EVENTS.ARTIFACT_SELECTED,
        artifactEventData(id, record, {
          path: guarded.path,
          ok: true,
          available: true,
        })
      );
      return { handled: true, ok: true };
    }
    case "artifact.delete": {
      const id = artifactIdOrError(data, emit, action.type);
      if (!id)
        return { handled: true, ok: false, error: "missing artifact_id" };
      const record = resolveArtifact?.(id);
      if (!record?.path) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_DELETED,
          id,
          record,
          "artifact_not_found",
          "未找到可删除的交付物"
        );
      }
      const guarded = guardArtifactRecord(root, record);
      if (!guarded.ok) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_DELETED,
          id,
          record,
          guarded.code,
          guarded.reason
        );
      }
      try {
        const stable = verifyGuardedArtifactFingerprint(root, guarded);
        if (!stable.ok) {
          return emitArtifactFailure(
            emit,
            EVENTS.ARTIFACT_DELETED,
            id,
            record,
            stable.code,
            stable.reason
          );
        }
        unlinkSync(stable.path);
        const ok = !existsSync(stable.path);
        emit(
          EVENTS.ARTIFACT_DELETED,
          artifactEventData(id, record, {
            path: stable.path,
            ok,
            available: false,
            ...(ok ? {} : { reason: "删除后文件仍存在" }),
          })
        );
        return { handled: true, ok };
      } catch (error) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_DELETED,
          id,
          record,
          "delete_failed",
          error?.message || String(error)
        );
      }
    }
    case "artifact.reveal": {
      const id = artifactIdOrError(data, emit, action.type);
      if (!id)
        return { handled: true, ok: false, error: "missing artifact_id" };
      const record = resolveArtifact?.(id);
      const guarded = guardArtifactRecord(root, record);
      if (!guarded.ok) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_REVEALED,
          id,
          record,
          guarded.code,
          guarded.reason
        );
      }
      const strategy = revealStrategy(guarded.path);
      if (!strategy.available) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_REVEALED,
          id,
          record,
          "reveal_unavailable",
          "当前系统没有可用的打开位置命令",
          {
            available: false,
            path: guarded.path,
            command: strategy.fallback?.manual_command,
          }
        );
      }
      try {
        const result = executeReveal(strategy, {
          ...record,
          path: guarded.path,
        });
        const ok = result?.ok === true;
        emit(
          EVENTS.ARTIFACT_REVEALED,
          artifactEventData(id, record, {
            path: guarded.path,
            ok,
            available: true,
            command:
              `${strategy.command} ${(strategy.args || []).join(" ")}`.trim(),
            ...(ok ? {} : { reason: result?.error || "系统打开命令执行失败" }),
          })
        );
        return { handled: true, ok, error: ok ? undefined : result?.error };
      } catch (error) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_REVEALED,
          id,
          record,
          "reveal_failed",
          error?.message || String(error),
          { available: true, path: guarded.path }
        );
      }
    }
    case "artifact.export": {
      const id = artifactIdOrError(data, emit, action.type);
      if (!id)
        return { handled: true, ok: false, error: "missing artifact_id" };
      const record = resolveArtifact?.(id);
      const source = guardArtifactRecord(root, record);
      if (!source.ok) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_EXPORTED,
          id,
          record,
          source.code,
          source.reason
        );
      }
      try {
        const exportRoot = resolve(root, ".crewclaw", "exports");
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
        const destination = join(
          exportRoot,
          `${safeId}-${basename(source.path)}`
        );
        writeStateFileAtomic(destination, source.data, { root });
        const sourceStillStable = verifyGuardedArtifactFingerprint(
          root,
          source
        );
        const exported = readStateFileGuarded(destination, { root });
        const ok =
          sourceStillStable.ok &&
          exported.length === source.bytes &&
          exported.equals(source.data);
        emit(
          EVENTS.ARTIFACT_EXPORTED,
          artifactEventData(id, record, {
            path: destination,
            source_path: source.path,
            ok,
            available: ok,
            ...(ok ? {} : { reason: "导出文件校验失败" }),
          })
        );
        return { handled: true, ok, path: destination };
      } catch (error) {
        return emitArtifactFailure(
          emit,
          EVENTS.ARTIFACT_EXPORTED,
          id,
          record,
          "export_failed",
          error?.message || String(error)
        );
      }
    }
    case "approval.resolve": {
      // v0.18 P0-b：工具授权 ≠ 交付验收。这里**不再发 approval.accepted/rejected**——那两个事件的
      // 语义是"交付物验收"（Rust 端计入 accepted_count KPI + "已验收"通知），此前一次 L2 工具授权
      // 就会把验收 KPI 涨一次。授权的唯一事件是桥侧 pendingConfirm 分支发的 approval.resolved；
      // 没有 pendingConfirm 时收到本 action（过期/重放）→ 静默丢弃，不产生任何事件。
      const decision = String(data.decision || "").toLowerCase();
      if (APPROVAL_ALLOW_DECISIONS.has(decision)) {
        return { handled: true, approval: true, decision };
      }
      if (APPROVAL_DENY_DECISIONS.has(decision)) {
        return { handled: true, approval: false, decision };
      }
      return { handled: true, approval: null, invalidDecision: true };
    }
    case "pending.run":
      emit(EVENTS.DEBUG_LINE, {
        line: `pending action ${data.key}${data.command ? ` ${data.command}` : ""}`,
      });
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

function artifactIdOrError(data, emit, actionType) {
  try {
    return requiredArtifactId(data);
  } catch (error) {
    emit(EVENTS.DEBUG_LINE, {
      line: `${actionType} rejected: ${error.message}`,
    });
    return null;
  }
}

function artifactEventData(id, record, extra = {}) {
  const taskRunId = record?.taskRunId || record?.task_run_id || null;
  return {
    id,
    artifact_id: id,
    ...(taskRunId ? { taskRunId } : {}),
    ...extra,
  };
}

function emitArtifactFailure(emit, type, id, record, code, reason, extra = {}) {
  emit(
    type,
    artifactEventData(id, record, {
      ok: false,
      available: false,
      code,
      reason,
      ...extra,
    })
  );
  return { handled: true, ok: false, error: reason, code };
}

function guardArtifactRecord(root, record) {
  if (!record?.path) {
    return {
      ok: false,
      code: "artifact_not_found",
      reason: "未找到交付物文件",
    };
  }
  return readArtifactFileGuarded(root, record.path);
}

export function executeRevealStrategy(strategy) {
  const result = spawnSync(strategy.command, strategy.args || [], {
    windowsHide: true,
    stdio: "ignore",
    timeout: 5_000,
  });
  return {
    ok: !result.error && result.status === 0,
    error:
      result.error?.message ||
      (result.status === 0 ? undefined : `exit ${result.status}`),
  };
}

export function createTaskModeSink({ emit }) {
  let toolSeq = 0;
  let currentTaskRunId = null;

  return {
    emitRaw(type, data = {}) {
      emit(type, data);
    },

    sessionReady({ name, role, mode = "Task", model }) {
      emit(EVENTS.SESSION_READY, { employee: { name, role, mode, model } });
    },

    taskStarted({ id, title, mode = "Task" }) {
      currentTaskRunId = id;
      emit(EVENTS.TASK_STARTED, { id, title, mode });
    },

    planCreated({ id, steps }) {
      emit(EVENTS.PLAN_CREATED, { id, steps });
    },

    toolPreflightChecked({ id, tool, status, reason, ok, label, detail }) {
      emit(EVENTS.TOOL_PREFLIGHT_CHECKED, {
        id,
        tool,
        ok:
          typeof ok === "boolean"
            ? ok
            : !PREFLIGHT_FAILURE_STATUSES.has(
                String(status || "").toLowerCase()
              ),
        label: label || tool,
        detail: detail || reason,
        status,
        reason,
      });
    },

    onDelta(text) {
      if (text) emit(EVENTS.TOKEN_DELTA, { text });
    },

    onInvocation(invocation = {}) {
      const id = "tool" + ++toolSeq;
      const tool = invocation.toolName || invocation.tool || "tool";
      const label = invocation.line || invocation.action || tool;
      emit(EVENTS.TOOL_REQUESTED, { id, tool, label });
      const failed =
        invocation.status === "blocked" || invocation.status === "error";
      emit(failed ? EVENTS.TOOL_FAILED : EVENTS.TOOL_SUCCEEDED, {
        id,
        summary: invocation.action || label,
        code: failed
          ? invocation.code || invocation.decision || invocation.status
          : undefined,
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

    approvalRequired({ id, taskRunId, taskId, tool, reason, scope }) {
      const correlatedTaskRunId = taskRunId || taskId || currentTaskRunId;
      emit(EVENTS.APPROVAL_REQUIRED, {
        id,
        taskRunId: correlatedTaskRunId,
        kind: "tool_authorization",
        tool,
        reason,
        scope,
      });
    },

    artifactCreated({
      id,
      taskRunId,
      taskId,
      name,
      kind,
      path,
      status = "ready",
      checks,
    }) {
      emit(EVENTS.ARTIFACT_CREATED, {
        id,
        taskRunId: taskRunId || taskId || currentTaskRunId,
        name,
        kind,
        path,
        status,
        checks,
      });
    },

    outcomeChecked(data) {
      const correlatedTaskRunId =
        data?.taskRunId || data?.taskId || data?.id || currentTaskRunId;
      emit(EVENTS.OUTCOME_CHECKED, {
        ...data,
        id: correlatedTaskRunId,
        taskRunId: correlatedTaskRunId,
      });
    },

    memorySaved(data) {
      emit(EVENTS.MEMORY_SAVED, data);
    },

    taskCompleted(data = {}) {
      const correlatedTaskRunId =
        data.taskRunId || data.taskId || data.id || currentTaskRunId;
      emit(EVENTS.TASK_COMPLETED, {
        ...data,
        id: correlatedTaskRunId,
        taskRunId: correlatedTaskRunId,
      });
    },

    taskRejected(data = {}) {
      const correlatedTaskRunId =
        data.taskRunId || data.taskId || data.id || currentTaskRunId;
      emit(EVENTS.TASK_REJECTED, {
        ...data,
        id: correlatedTaskRunId,
        taskRunId: correlatedTaskRunId,
      });
    },
  };
}
