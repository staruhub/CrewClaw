// Session persistence for `crew chat`: save the conversation to disk and
// `--resume` it later. We keep only the clean user↔assistant transcript (drop
// tool-call plumbing) and strip image payloads so saved files stay small.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
  writeJsonAtomic,
} from "./state-lock.mjs";

function sessionsDir(root) {
  return join(root, ".sessions");
}
function safeSessionId(agentId) {
  const value = String(agentId ?? "");
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("invalid session agent id");
  }
  return value;
}
function sessionFile(root, agentId) {
  const safeAgentId = safeSessionId(agentId);
  return resolveStatePath(join(sessionsDir(root), `${safeAgentId}.json`), root);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter(b => b?.type === "text")
      .map(b => b.text)
      .join("\n");
    const imgs = content.filter(b => b?.type === "image_url").length;
    return text + (imgs ? `\n[已省略 ${imgs} 张图片附件]` : "");
  }
  return String(content ?? "");
}

// Reduce a live history (which contains tool_calls / tool messages / multimodal
// blocks) to a clean, resumable user↔assistant text transcript.
export function sanitizeForSave(history) {
  const out = [];
  for (const m of history || []) {
    if (m?.role === "user") {
      out.push({ role: "user", content: contentToText(m.content) });
    } else if (
      m?.role === "assistant" &&
      !m.tool_calls &&
      typeof m.content === "string" &&
      m.content.trim()
    ) {
      out.push({ role: "assistant", content: m.content });
    }
    // drop: tool messages, and assistant messages that only carry tool_calls
  }
  return out;
}

export function saveSession(root, agentId, history) {
  try {
    const normalizedAgentId = safeSessionId(agentId);
    const data = {
      agentId: normalizedAgentId,
      savedAt: new Date().toISOString(),
      messages: sanitizeForSave(history),
    };
    const path = sessionFile(root, normalizedAgentId);
    return withStateLock(
      `${path}.lock`,
      () => {
        writeJsonAtomic(path, data, { root });
        return { ok: true, count: data.messages.length };
      },
      { root }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadSession(root, agentId) {
  try {
    const normalizedAgentId = safeSessionId(agentId);
    const f = sessionFile(root, normalizedAgentId);
    return withStateLock(
      `${f}.lock`,
      () => {
        if (!existsSync(f)) return { ok: false, error: "no saved session" };
        const data = JSON.parse(
          readStateFileGuarded(f, { root }).toString("utf8")
        );
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          data.agentId !== normalizedAgentId ||
          typeof data.savedAt !== "string" ||
          !Array.isArray(data.messages) ||
          data.messages.some(
            message =>
              !message ||
              !["user", "assistant"].includes(message.role) ||
              typeof message.content !== "string"
          )
        ) {
          throw new Error("saved session has an invalid structure");
        }
        return {
          ok: true,
          messages: data.messages,
          savedAt: data.savedAt,
        };
      },
      { root }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}
