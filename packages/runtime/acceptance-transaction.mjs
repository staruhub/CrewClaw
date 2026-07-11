import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  MAX_STATE_FILE_BYTES,
  readStateFileGuarded,
  resolveStatePath,
  withStateLock,
} from "./state-lock.mjs";

export function captureArtifactFingerprint(filePath) {
  try {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      return failure("artifact_path_missing", "交付物路径缺失，不能验收");
    }
    const path = resolve(filePath);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0) {
      return failure(
        "artifact_missing_or_empty",
        "交付物已不存在或为空，不能验收",
        { path }
      );
    }
    const bytes = readFileSync(path);
    if (bytes.length <= 0 || bytes.length !== stat.size) {
      return failure("artifact_read_incomplete", "交付物读取不完整，不能验收", {
        path,
      });
    }
    return {
      ok: true,
      path,
      realpath: realpathSync(path),
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    return failure(
      "artifact_missing_or_empty",
      "交付物已不存在或无法读取，不能验收",
      {
        path: typeof filePath === "string" ? resolve(filePath) : null,
        error: error?.message || String(error),
      }
    );
  }
}

export function verifyArtifactFingerprint(expected = {}) {
  const current = captureArtifactFingerprint(expected.path);
  if (!current.ok) return current;
  if (
    (expected.realpath && current.realpath !== expected.realpath) ||
    (Number.isFinite(expected.bytes) && current.bytes !== expected.bytes) ||
    (Number.isFinite(expected.mtimeMs) &&
      current.mtimeMs !== expected.mtimeMs) ||
    (expected.sha256 && current.sha256 !== expected.sha256)
  ) {
    return failure(
      "artifact_changed",
      "交付物在等待验收期间发生变化，请重新生成并复核",
      {
        path: current.path,
        expected,
        current,
      }
    );
  }
  return current;
}

export function writeJsonDurably(targetPath, value, { root } = {}) {
  let path = resolve(targetPath);
  let dir = dirname(path);
  let temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd = null;
  try {
    const payload = JSON.stringify(value, null, 2);
    if (typeof payload !== "string") {
      return failure("durable_write_invalid", "持久化内容无法序列化为 JSON");
    }
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (payloadBytes > MAX_STATE_FILE_BYTES) {
      return failure(
        "durable_write_too_large",
        `持久化内容超过 ${MAX_STATE_FILE_BYTES} 字节状态文件上限`,
        { path, bytes: payloadBytes, maxBytes: MAX_STATE_FILE_BYTES }
      );
    }
    if (root) path = resolveStatePath(path, root);
    dir = dirname(path);
    temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    mkdirSync(dir, { recursive: true });
    if (root) path = resolveStatePath(path, root);
    dir = dirname(path);
    temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);

    // A successful rename is not enough: read the final path back so a short/failed write can
    // never be treated as a durable acceptance receipt. Directory fsync is best-effort on Windows.
    const persisted = readStateFileGuarded(path, { root }).toString("utf8");
    if (persisted !== payload) {
      return failure("durable_write_mismatch", "持久化文件回读校验失败", {
        path,
      });
    }
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Some platforms/filesystems do not permit opening a directory handle. The file itself was
      // fsynced and atomically renamed, so keep the verified result.
    }
    return { ok: true, path };
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    if (existsSync(temp)) {
      try {
        unlinkSync(temp);
      } catch {}
    }
    return failure("durable_write_failed", "持久化文件写入失败", {
      path,
      error: error?.message || String(error),
    });
  }
}

export function persistProofPackDurably({ root, taskRunId, pack }) {
  if (
    !root ||
    typeof taskRunId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(taskRunId) ||
    !pack
  ) {
    return failure(
      "proofpack_invalid",
      "ProofPack 缺少 root、合法 taskRunId 或内容"
    );
  }
  const safeTaskRunId = taskRunId;
  let path;
  try {
    path = resolveStatePath(
      join(root, ".crewclaw", "runs", `${safeTaskRunId}.proofpack.json`),
      root
    );
  } catch (error) {
    return failure(
      "proofpack_path_unsafe",
      "ProofPack 路径包含越界链接，任务不能标记为已验收",
      { error: error?.message || String(error) }
    );
  }
  try {
    return withStateLock(
      `${path}.lock`,
      () => {
        if (existsSync(path)) {
          try {
            const existing = JSON.parse(
              readStateFileGuarded(path, { root }).toString("utf8")
            );
            if (JSON.stringify(existing) === JSON.stringify(pack)) {
              return { ok: true, path, existing: true };
            }
            return failure(
              "proofpack_conflict",
              "任务已有不同内容的 ProofPack，拒绝覆盖验收记录",
              { path }
            );
          } catch (error) {
            return failure(
              "proofpack_corrupt",
              "已有 ProofPack 无法读取，拒绝覆盖验收记录",
              { path, error: error?.message || String(error) }
            );
          }
        }
        const result = writeJsonDurably(path, pack, { root });
        return result.ok
          ? result
          : failure(
              "proofpack_not_persisted",
              "ProofPack 落盘失败，任务不能标记为已验收",
              {
                path,
                error: result.error || result.reason,
              }
            );
      },
      { root }
    );
  } catch (error) {
    return failure(
      "proofpack_path_unsafe",
      "ProofPack 路径或互斥状态不安全，任务不能标记为已验收",
      { path, error: error?.message || String(error) }
    );
  }
}

function failure(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}
