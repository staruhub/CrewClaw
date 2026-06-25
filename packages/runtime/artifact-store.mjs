import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function artifactsDir(root) {
  return join(root, ".crewclaw", "artifacts");
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function artifactJsonPath(root, id) {
  return join(artifactsDir(root), safeId(id) + ".json");
}

function artifactMdPath(root, id) {
  return join(artifactsDir(root), safeId(id) + ".md");
}

export function newArtifact({ taskId, type, title, content }) {
  return {
    id: "artifact_" + Date.now(),
    task_id: taskId,
    type: type || "research_report",
    title: title || "",
    content: content || "",
    status: "delivered",
    accepted: false,
    created_at: new Date().toISOString()
  };
}

export function saveArtifact(root, artifact) {
  try {
    const dir = artifactsDir(root);
    const jsonPath = artifactJsonPath(root, artifact.id);
    const mdPath = artifactMdPath(root, artifact.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf8");
    writeFileSync(mdPath, artifact.content || "", "utf8");
    return { ok: true, jsonPath, mdPath };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function loadArtifact(root, id) {
  try {
    const artifact = JSON.parse(readFileSync(artifactJsonPath(root, id), "utf8"));
    return { ok: true, artifact };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export function markAccepted(root, id) {
  try {
    const loaded = loadArtifact(root, id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const artifact = { ...loaded.artifact, accepted: true, status: "accepted" };
    writeFileSync(artifactJsonPath(root, id), JSON.stringify(artifact, null, 2), "utf8");
    return { ok: true, artifact };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}
