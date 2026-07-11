import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const ARTIFACT_KINDS = Object.freeze([
  "markdown",
  "table",
  "spreadsheet",
  "document",
  "deck",
  "code",
  "report",
  "evidence",
  "checklist",
]);

export const ARTIFACT_STATUSES = Object.freeze([
  "draft",
  "ready",
  "needs_revision",
  "accepted",
  "rejected",
]);

function failure(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

function isInside(parent, candidate, { allowSame = false } = {}) {
  const fromParent = path.relative(parent, candidate);
  return (
    (allowSame || fromParent !== "") &&
    !fromParent.startsWith("..") &&
    !path.isAbsolute(fromParent)
  );
}

function throwBoundaryFailure(result) {
  const error = new Error(result.reason);
  error.code = result.code;
  error.path = result.path;
  throw error;
}

export function artifactStorageRoot(root = process.cwd()) {
  return path.resolve(root, ".crewclaw", "artifacts");
}

/**
 * Validate an artifact path against both the lexical artifact namespace and the canonical
 * workspace. Every existing component below the workspace root is lstat'd: symbolic links and
 * Windows junctions/reparse links are rejected before a read or write can traverse them.
 */
export function inspectArtifactPath(
  root,
  targetPath,
  { mustExist = false } = {}
) {
  const workspacePath = path.resolve(root || ".");
  const artifactsPath = artifactStorageRoot(workspacePath);
  const candidatePath = path.resolve(String(targetPath || ""));

  if (!isInside(artifactsPath, candidatePath, { allowSame: true })) {
    return failure(
      "artifact_outside_workspace",
      "交付物路径不属于当前工作区的 artifacts 目录",
      { path: candidatePath }
    );
  }

  let canonicalWorkspace;
  try {
    canonicalWorkspace = realpathSync(workspacePath);
  } catch (error) {
    return failure(
      "artifact_workspace_unavailable",
      "工作区目录不存在或无法解析",
      { path: workspacePath, error: error?.message || String(error) }
    );
  }

  const relativeCandidate = path.relative(workspacePath, candidatePath);
  let cursor = workspacePath;
  let nearestCanonical = canonicalWorkspace;
  let targetStat = null;
  let missing = false;
  for (const segment of relativeCandidate.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (missing) continue;
    try {
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) {
        return failure(
          "artifact_link_component",
          "artifacts 路径包含 symlink 或 junction，拒绝访问",
          { path: cursor }
        );
      }
      if (cursor !== candidatePath && !entry.isDirectory()) {
        return failure(
          "artifact_component_not_directory",
          "artifacts 路径组件不是目录",
          { path: cursor }
        );
      }
      if (cursor === candidatePath && entry.isFile() && entry.nlink > 1) {
        return failure(
          "artifact_link_component",
          "交付物是多链接文件，拒绝访问",
          { path: cursor }
        );
      }
      nearestCanonical = realpathSync(cursor);
      if (
        !isInside(canonicalWorkspace, nearestCanonical, { allowSame: true })
      ) {
        return failure(
          "artifact_symlink_escape",
          "artifacts 路径的真实位置逃逸了工作区",
          { path: nearestCanonical }
        );
      }
      if (cursor === candidatePath) targetStat = entry;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return failure(
          "artifact_path_unavailable",
          "artifacts 路径组件无法检查",
          { path: cursor, error: error?.message || String(error) }
        );
      }
      missing = true;
    }
  }

  if (mustExist && (missing || targetStat === null)) {
    return failure("artifact_missing", "交付物不存在", {
      path: candidatePath,
    });
  }

  let canonicalArtifacts = null;
  if (existsSync(artifactsPath)) {
    try {
      const artifactRootStat = lstatSync(artifactsPath);
      if (artifactRootStat.isSymbolicLink()) {
        return failure(
          "artifact_link_component",
          "artifacts 根目录是 symlink 或 junction，拒绝访问",
          { path: artifactsPath }
        );
      }
      canonicalArtifacts = realpathSync(artifactsPath);
      if (
        !isInside(canonicalWorkspace, canonicalArtifacts, { allowSame: false })
      ) {
        return failure(
          "artifact_symlink_escape",
          "artifacts 根目录的真实位置逃逸了工作区",
          { path: canonicalArtifacts }
        );
      }
      if (
        !missing &&
        !isInside(canonicalArtifacts, nearestCanonical, { allowSame: true })
      ) {
        return failure(
          "artifact_symlink_escape",
          "交付物的真实路径逃逸了 artifacts 根目录",
          { path: nearestCanonical }
        );
      }
    } catch (error) {
      if (error?.code) {
        return failure(
          "artifact_root_unavailable",
          "artifacts 根目录无法安全解析",
          { path: artifactsPath, error: error?.message || String(error) }
        );
      }
      throw error;
    }
  }

  return {
    ok: true,
    path: candidatePath,
    realpath: targetStat ? nearestCanonical : null,
    stat: targetStat,
    workspacePath,
    canonicalWorkspace,
    artifactsPath,
    canonicalArtifacts,
  };
}

/** Create artifact directories one component at a time, never recursively through a link. */
export function ensureArtifactDirectory(root, directoryPath) {
  const workspacePath = path.resolve(root || ".");
  mkdirSync(workspacePath, { recursive: true });
  const directory = path.resolve(directoryPath);
  const lexical = inspectArtifactPath(workspacePath, directory);
  if (!lexical.ok) throwBoundaryFailure(lexical);
  const canonicalWorkspace = realpathSync(workspacePath);

  const relativeDirectory = path.relative(workspacePath, directory);
  let cursor = workspacePath;
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      mkdirSync(cursor);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) {
      const error = new Error(
        "artifacts 路径包含 symlink 或 junction，拒绝访问"
      );
      error.code = "artifact_link_component";
      error.path = cursor;
      throw error;
    }
    if (!entry.isDirectory()) {
      const error = new Error("artifacts 路径组件不是目录");
      error.code = "artifact_component_not_directory";
      error.path = cursor;
      throw error;
    }
    const canonical = realpathSync(cursor);
    if (!isInside(canonicalWorkspace, canonical, { allowSame: true })) {
      const error = new Error("artifacts 路径的真实位置逃逸了工作区");
      error.code = "artifact_symlink_escape";
      error.path = canonical;
      throw error;
    }
  }
  return inspectArtifactPath(workspacePath, directory, { mustExist: true });
}

/** Read a regular artifact through a no-follow descriptor and revalidate its canonical path. */
export function readArtifactFileGuarded(root, targetPath) {
  const before = inspectArtifactPath(root, targetPath, { mustExist: true });
  if (!before.ok) {
    return before.code === "artifact_missing"
      ? failure("artifact_missing_or_empty", "交付物已不存在或为空，不能验收", {
          path: before.path,
        })
      : before;
  }
  if (!before.stat?.isFile()) {
    return failure("artifact_not_file", "交付物路径不是普通文件", {
      path: before.path,
    });
  }

  let fd = null;
  try {
    const noFollow = constants.O_NOFOLLOW || 0;
    fd = openSync(before.path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink > 1) {
      return failure("artifact_link_component", "交付物不是单链接普通文件", {
        path: before.path,
      });
    }
    if (
      opened.dev !== before.stat.dev ||
      opened.ino !== before.stat.ino ||
      opened.size !== before.stat.size ||
      opened.mtimeMs !== before.stat.mtimeMs
    ) {
      return failure(
        "artifact_changed",
        "交付物在打开前发生变化，请重新生成并复核",
        { path: before.path }
      );
    }
    const data = readFileSync(fd);
    const afterRead = fstatSync(fd);
    if (data.length <= 0) {
      return failure(
        "artifact_missing_or_empty",
        "交付物已不存在或为空，不能验收",
        { path: before.path }
      );
    }
    if (
      opened.size !== afterRead.size ||
      opened.mtimeMs !== afterRead.mtimeMs ||
      data.length !== afterRead.size
    ) {
      return failure(
        "artifact_changed",
        "交付物在读取期间发生变化，请重新生成并复核",
        { path: before.path }
      );
    }
    closeSync(fd);
    fd = null;

    const after = inspectArtifactPath(root, before.path, { mustExist: true });
    if (!after.ok) return after;
    if (
      after.realpath !== before.realpath ||
      after.stat.dev !== afterRead.dev ||
      after.stat.ino !== afterRead.ino ||
      after.stat.size !== afterRead.size ||
      after.stat.mtimeMs !== afterRead.mtimeMs
    ) {
      return failure(
        "artifact_changed",
        "交付物路径在读取期间发生变化，请重新生成并复核",
        { path: before.path }
      );
    }
    return {
      ok: true,
      path: before.path,
      realpath: after.realpath,
      bytes: data.length,
      mtimeMs: afterRead.mtimeMs,
      sha256: createHash("sha256").update(data).digest("hex"),
      data,
      canonicalWorkspace: after.canonicalWorkspace,
      canonicalArtifacts: after.canonicalArtifacts,
    };
  } catch (error) {
    return failure("artifact_read_failed", "交付物无法安全读取", {
      path: before.path,
      error: error?.message || String(error),
    });
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

export function verifyGuardedArtifactFingerprint(root, expected = {}) {
  const current = readArtifactFileGuarded(root, expected.path);
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
      { path: current.path, expected, current }
    );
  }
  return current;
}

/** Same-directory fsync + atomic rename, guarded before and after every filesystem transition. */
export function writeArtifactFileAtomic(
  root,
  targetPath,
  content,
  { encoding = "utf8", mode = 0o600 } = {}
) {
  const target = path.resolve(targetPath);
  const parent = path.dirname(target);
  ensureArtifactDirectory(root, parent);
  const before = inspectArtifactPath(root, target);
  if (!before.ok) throwBoundaryFailure(before);

  const payload = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content ?? ""), encoding);
  const temp = path.join(
    parent,
    `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`
  );
  let fd = null;
  try {
    fd = openSync(temp, "wx", mode);
    writeFileSync(fd, payload);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    for (const candidate of [parent, target, temp]) {
      const checked = inspectArtifactPath(root, candidate, {
        mustExist: candidate !== target || existsSync(target),
      });
      if (!checked.ok) throwBoundaryFailure(checked);
    }
    renameSync(temp, target);
    const persisted = readArtifactFileGuarded(root, target);
    if (!persisted.ok) throwBoundaryFailure(persisted);
    if (!persisted.data.equals(payload)) {
      const error = new Error("交付物原子写入后的回读校验失败");
      error.code = "artifact_write_mismatch";
      error.path = target;
      throw error;
    }
    try {
      const dirFd = openSync(parent, constants.O_RDONLY);
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Windows and some filesystems do not expose a directory fsync handle. The file descriptor
      // itself was fsynced and the final bytes were read back through the guarded path.
    }
    return persisted;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    if (existsSync(temp)) {
      const guardedTemp = inspectArtifactPath(root, temp, { mustExist: true });
      if (guardedTemp.ok && guardedTemp.stat?.isFile()) {
        try {
          unlinkSync(temp);
        } catch {}
      }
    }
  }
}

export function writeArtifact({
  name,
  kind,
  content,
  taskRunId,
  root = process.cwd(),
  createdAt = 0,
}) {
  if (!taskRunId || typeof taskRunId !== "string") {
    throw new TypeError("writeArtifact requires a string taskRunId");
  }

  if (!name || typeof name !== "string") {
    throw new TypeError("writeArtifact requires a string name");
  }

  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported artifact kind: ${kind}`);
  }

  if (content === undefined || content === null) {
    throw new TypeError("writeArtifact requires content");
  }

  const artifactRoot = path.resolve(artifactStorageRoot(root), taskRunId);
  const artifactPath = path.resolve(artifactRoot, name);
  const relativePath = path.relative(artifactRoot, artifactPath);

  if (
    path.isAbsolute(name) ||
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Artifact name must resolve inside the task artifact directory"
    );
  }

  const written = writeArtifactFileAtomic(root, artifactPath, content);

  return {
    artifact_id: randomUUID(),
    task_run_id: taskRunId,
    name,
    kind,
    path: artifactPath,
    status: "draft",
    version: 1,
    bytes: written.bytes,
    created_at: createdAt,
  };
}

export function revealStrategy(targetPath, env = process.env) {
  const absolutePath = path.resolve(String(targetPath || ""));
  const platform = detectRevealPlatform(env);

  if (!targetPath) {
    return unavailableStrategy(absolutePath, platform);
  }

  if (platform === "win32") {
    return {
      available: true,
      command: "explorer",
      args: [`/select,${absolutePath}`],
      platform,
    };
  }

  if (platform === "wsl") {
    return {
      available: true,
      command: "sh",
      args: [
        "-lc",
        'explorer.exe /select,"$(wslpath -w "$1")"',
        "crewclaw-reveal",
        absolutePath,
      ],
      platform,
    };
  }

  if (platform === "darwin") {
    return {
      available: true,
      command: "open",
      args: ["-R", absolutePath],
      platform,
    };
  }

  if (platform === "linux") {
    return {
      available: true,
      command: "xdg-open",
      args: [path.dirname(absolutePath)],
      platform,
    };
  }

  return unavailableStrategy(absolutePath, platform);
}

export function assertCreated(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return false;
  }

  if (!artifact.path || typeof artifact.path !== "string") {
    return false;
  }

  if (!Number.isFinite(artifact.bytes) || artifact.bytes <= 0) {
    return false;
  }

  try {
    const fileStat = statSync(artifact.path);
    return (
      fileStat.isFile() && fileStat.size === artifact.bytes && fileStat.size > 0
    );
  } catch {
    return false;
  }
}

function detectRevealPlatform(env) {
  const platform = os.platform();

  if (platform === "linux" && isWsl(env)) {
    return "wsl";
  }

  return platform;
}

function isWsl(env) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.IS_WSL) {
    return true;
  }

  try {
    if (!existsSync("/proc/version")) {
      return false;
    }

    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function unavailableStrategy(absolutePath, platform) {
  return {
    available: false,
    platform,
    fallback: {
      absolute_path: absolutePath,
      copy_action: true,
      manual_command: manualRevealCommand(absolutePath, platform),
    },
  };
}

function manualRevealCommand(absolutePath, platform) {
  if (platform === "win32") {
    return `explorer /select,${quoteForManualCommand(absolutePath)}`;
  }

  if (platform === "wsl") {
    return `explorer.exe /select,"$(wslpath -w ${quoteForManualCommand(absolutePath)})"`;
  }

  if (platform === "darwin") {
    return `open -R ${quoteForManualCommand(absolutePath)}`;
  }

  return `xdg-open ${quoteForManualCommand(path.dirname(absolutePath))}`;
}

function quoteForManualCommand(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
