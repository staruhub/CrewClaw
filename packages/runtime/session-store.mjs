// Session persistence for `crew chat`: save the conversation to disk and
// `--resume` it later. We keep only the clean user↔assistant transcript (drop
// tool-call plumbing) and strip image payloads so saved files stay small.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function sessionsDir(root) {
  return join(root, ".sessions");
}
function sessionFile(root, agentId) {
  return join(sessionsDir(root), `${String(agentId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("\n");
    const imgs = content.filter((b) => b?.type === "image_url").length;
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
    } else if (m?.role === "assistant" && !m.tool_calls && typeof m.content === "string" && m.content.trim()) {
      out.push({ role: "assistant", content: m.content });
    }
    // drop: tool messages, and assistant messages that only carry tool_calls
  }
  return out;
}

export function saveSession(root, agentId, history) {
  try {
    mkdirSync(sessionsDir(root), { recursive: true });
    const data = { agentId, savedAt: new Date().toISOString(), messages: sanitizeForSave(history) };
    writeFileSync(sessionFile(root, agentId), JSON.stringify(data, null, 2), "utf8");
    return { ok: true, count: data.messages.length };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadSession(root, agentId) {
  try {
    const f = sessionFile(root, agentId);
    if (!existsSync(f)) return { ok: false, error: "no saved session" };
    const data = JSON.parse(readFileSync(f, "utf8"));
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    return { ok: true, messages, savedAt: data?.savedAt ?? null };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}
