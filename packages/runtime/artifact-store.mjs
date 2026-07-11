import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  artifactStorageRoot,
  ensureArtifactDirectory,
  inspectArtifactPath,
  readArtifactFileGuarded,
  writeArtifactFileAtomic,
} from "./artifact-contract.mjs";
import { withStateLock } from "./state-lock.mjs";

function artifactsDir(root) {
  return artifactStorageRoot(root);
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function artifactJsonPath(root, id) {
  return resolve(artifactsDir(root), safeId(id) + ".json");
}

function artifactMdPath(root, id) {
  return resolve(artifactsDir(root), safeId(id) + ".md");
}

export function newArtifact({ taskId, type, title, content }) {
  return {
    id: `artifact_${randomUUID()}`,
    task_id: taskId,
    type: type || "research_report",
    title: title || "",
    content: content || "",
    status: "delivered",
    accepted: false,
    created_at: new Date().toISOString(),
  };
}

export function saveArtifact(root, artifact) {
  try {
    const dir = artifactsDir(root);
    const jsonPath = artifactJsonPath(root, artifact.id);
    const mdPath = artifactMdPath(root, artifact.id);
    ensureArtifactDirectory(root, dir);
    writeArtifactFileAtomic(root, mdPath, artifact.content || "");
    writeArtifactFileAtomic(
      root,
      jsonPath,
      `${JSON.stringify(artifact, null, 2)}\n`
    );
    return { ok: true, jsonPath, mdPath };
  } catch (error) {
    return {
      ok: false,
      code: error?.code,
      error: error?.message ?? String(error),
    };
  }
}

export function loadArtifact(root, id) {
  try {
    const read = readArtifactFileGuarded(root, artifactJsonPath(root, id));
    if (!read.ok) return { ok: false, code: read.code, error: read.reason };
    const artifact = JSON.parse(read.data.toString("utf8"));
    return { ok: true, artifact };
  } catch (error) {
    return {
      ok: false,
      code: error?.code,
      error: error?.message ?? String(error),
    };
  }
}

export function markAccepted(root, id) {
  try {
    const path = artifactJsonPath(root, id);
    const guarded = inspectArtifactPath(root, path, { mustExist: true });
    if (!guarded.ok) {
      return { ok: false, code: guarded.code, error: guarded.reason };
    }
    return withStateLock(`${path}.lock`, () => {
      const loaded = loadArtifact(root, id);
      if (!loaded.ok) return { ok: false, error: loaded.error };
      const artifact = {
        ...loaded.artifact,
        accepted: true,
        status: "accepted",
      };
      writeArtifactFileAtomic(
        root,
        path,
        `${JSON.stringify(artifact, null, 2)}\n`
      );
      return { ok: true, artifact };
    });
  } catch (error) {
    return {
      ok: false,
      code: error?.code,
      error: error?.message ?? String(error),
    };
  }
}
