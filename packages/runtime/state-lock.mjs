import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { resolvePathInsideRoot } from "./tool-gateway.mjs";

const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
export const MAX_STATE_FILE_BYTES = 8 * 1024 * 1024;
const ATOMIC_RENAME_ATTEMPTS = 5;
const ATOMIC_RENAME_RETRY_MS = 10;

function wait(ms) {
  Atomics.wait(WAIT_BUFFER, 0, 0, ms);
}

export function resolveStateDirectory(path, root, { mustExist = false } = {}) {
  if (!root) return path;
  const checked = resolvePathInsideRoot(path, root, {
    mustExist,
    rejectSymlinks: true,
  });
  if (!checked.ok)
    throw new Error(
      `unsafe state directory: ${checked.error} (root=${root}, path=${path})`
    );
  return checked.path;
}

export function resolveStatePath(path, root, { mustExist = false } = {}) {
  if (!root) return path;
  const absolute = resolve(path);
  const checked = resolvePathInsideRoot(dirname(absolute), root, {
    rejectSymlinks: true,
  });
  if (!checked.ok)
    throw new Error(
      `unsafe state path: ${checked.error} (root=${root}, path=${path})`
    );
  const candidate = resolve(checked.path, basename(absolute));
  try {
    const entry = lstatSync(candidate);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      (entry.nlink !== 0 && entry.nlink !== 1)
    )
      throw new Error(
        `unsafe state path: final entry is not a safe file (root=${root}, path=${path})`
      );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (mustExist)
      throw new Error(
        `unsafe state path: file does not exist (root=${root}, path=${path})`
      );
  }
  return candidate;
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readLockOwner(path) {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8"));
    return owner && typeof owner === "object" ? owner : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (["ESRCH", "EINVAL", "ERR_OUT_OF_RANGE"].includes(error?.code)) {
      return false;
    }
    return true;
  }
}

/** Classify a contended lock path without weakening the link/special-file boundary. */
export function classifyStateLockEntry(entry) {
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    (entry.nlink !== 0 && entry.nlink !== 1)
  ) {
    return "unsafe";
  }
  return entry.nlink === 0 ? "delete-pending" : "active";
}

function unlinkLockIfOwned(path, identity, token) {
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      !sameInode(before, identity)
    ) {
      return false;
    }
    if (token && readLockOwner(path)?.token !== token) return false;
    const after = lstatSync(path);
    if (!sameInode(before, after)) return false;
    unlinkSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Read one regular, single-link state file through a no-follow descriptor and recheck identity. */
export function readStateFileGuarded(
  path,
  { root, maxBytes = MAX_STATE_FILE_BYTES } = {}
) {
  path = resolveStatePath(path, root, { mustExist: true });
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(
      `unsafe state read: final entry is not a regular file (${path})`
    );
  }
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    before.size <= 0 ||
    before.size > maxBytes
  ) {
    throw new Error(`unsafe state read: invalid or oversized file (${path})`);
  }

  const noFollow = constants.O_NOFOLLOW || 0;
  let fd = null;
  let data;
  let afterRead;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error(`unsafe state read: file changed before open (${path})`);
    }
    data = readFileSync(fd);
    afterRead = fstatSync(fd);
    if (
      !sameFileIdentity(opened, afterRead) ||
      data.length !== afterRead.size
    ) {
      throw new Error(
        `unsafe state read: file changed while reading (${path})`
      );
    }
  } finally {
    if (fd !== null) closeSync(fd);
  }

  path = resolveStatePath(path, root, { mustExist: true });
  const after = lstatSync(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    !sameFileIdentity(afterRead, after)
  ) {
    throw new Error(
      `unsafe state read: file path changed after read (${path})`
    );
  }
  return data;
}

function stateJsonBuffer(value, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`invalid state JSON byte limit: ${maxBytes}`);
  }

  const json = JSON.stringify(value, null, 2);
  if (typeof json !== "string") {
    throw new Error("state value is not JSON serializable");
  }
  const data = Buffer.from(`${json}\n`, "utf8");
  if (data.length > maxBytes) {
    throw new Error(
      `state JSON exceeds ${maxBytes}-byte limit (${data.length} bytes)`
    );
  }
  return data;
}

function removeTemporaryFile(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function fsyncDirectoryBestEffort(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY);
    fsyncSync(fd);
  } catch {
    // Directory descriptors/fsync are not supported by every Windows filesystem.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function openUniqueStateTemp(path, root, mode) {
  const directory = dirname(path);
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    (constants.O_NOFOLLOW || 0);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tmp = resolveStatePath(
      join(directory, `.${basename(path)}.${randomUUID()}.tmp`),
      root
    );
    try {
      return { fd: openSync(tmp, flags, mode), path: tmp };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not allocate unique state temporary file: ${path}`);
}

function stateFileBuffer(bytes, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`invalid state file byte limit: ${maxBytes}`);
  }
  if (
    typeof bytes !== "string" &&
    !Buffer.isBuffer(bytes) &&
    !(bytes instanceof Uint8Array)
  ) {
    throw new TypeError("state file content must be a string or byte array");
  }

  let data;
  if (Buffer.isBuffer(bytes)) data = bytes;
  else if (typeof bytes === "string") data = Buffer.from(bytes, "utf8");
  else data = Buffer.from(bytes);
  if (data.length <= 0 || data.length > maxBytes) {
    throw new Error(
      `state file is empty or exceeds ${maxBytes}-byte limit (${data.length} bytes)`
    );
  }
  return data;
}

/**
 * Cross-process lock for the small JSON state files used by the runtime. `open(..., "wx")`
 * is the single atomic arbitration point on Windows and POSIX. A stale lock left by a crashed
 * process is reclaimed after `staleMs`; callers otherwise fail instead of silently losing data.
 */
export function withStateLock(
  lockPath,
  fn,
  { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS, root } = {}
) {
  lockPath = resolveStatePath(lockPath, root);
  mkdirSync(dirname(lockPath), { recursive: true });
  lockPath = resolveStatePath(lockPath, root);
  const deadline = Date.now() + timeoutMs;
  let fd;
  let lockIdentity;
  const owner = {
    token: randomUUID(),
    pid: process.pid,
    // Keep the owner record readable by the Rust and website owner-lock
    // implementations. Older runtime locks used `createdAt`; reclaiming is
    // based on the guarded file mtime, so changing the serialized field is
    // backwards compatible while making new locks cross-process recoverable.
    created_at_ms: Date.now(),
  };

  while (fd === undefined) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      lockIdentity = fstatSync(fd);
      writeFileSync(fd, `${JSON.stringify(owner)}\n`, "utf8");
      fsyncSync(fd);
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {}
        fd = undefined;
        try {
          unlinkLockIfOwned(lockPath, lockIdentity, null);
        } catch {}
      }
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
      try {
        const staleIdentity = lstatSync(lockPath);
        const lockEntry = classifyStateLockEntry(staleIdentity);
        if (lockEntry === "unsafe") {
          throw new Error(`unsafe state lock entry: ${lockPath}`);
        }
        // Windows can briefly return a regular path with nlink=0 while another process's unlink
        // is delete-pending. That is ordinary contention, not a hardlink attack. Waiting here is
        // essential: failing the update would turn a successful worker exit into a lost write.
        // nlink>1 remains fail-closed; values other than the documented 0/1 are also unsafe.
        if (
          lockEntry === "active" &&
          Date.now() - staleIdentity.mtimeMs > staleMs
        ) {
          const staleOwner = readLockOwner(lockPath);
          if (!processIsAlive(staleOwner?.pid)) {
            if (unlinkLockIfOwned(lockPath, staleIdentity, staleOwner?.token)) {
              continue;
            }
          }
        }
      } catch (statError) {
        // Windows can expose a just-deleted lock as EPERM or ENOENT for a few milliseconds.
        // Treat it as contention, but still honor the deadline so a real ACL problem cannot spin.
        if (!["ENOENT", "EPERM", "EACCES"].includes(statError?.code))
          throw statError;
      }
      if (Date.now() >= deadline)
        throw new Error(`state lock timeout: ${lockPath}`);
      wait(10);
    }
  }

  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkLockIfOwned(lockPath, lockIdentity, owner.token);
    } catch {
      /* stale cleanup will recover */
    }
  }
}

/** Write bounded bytes through a durable same-directory atomic replacement. Locking is external. */
export function writeStateFileAtomic(
  path,
  bytes,
  { root, maxBytes = MAX_STATE_FILE_BYTES, mode = 0o600 } = {}
) {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o777) {
    throw new Error(`invalid state file mode: ${mode}`);
  }
  const data = stateFileBuffer(bytes, maxBytes);
  path = resolveStatePath(path, root);
  mkdirSync(dirname(path), { recursive: true });
  path = resolveStatePath(path, root);

  const temporary = openUniqueStateTemp(path, root, mode);
  let temporaryPath = temporary.path;
  try {
    try {
      writeFileSync(temporary.fd, data);
      fsyncSync(temporary.fd);
      const written = fstatSync(temporary.fd);
      if (
        !written.isFile() ||
        written.nlink !== 1 ||
        written.size !== data.length
      ) {
        throw new Error(`unsafe state temporary file: ${temporaryPath}`);
      }
    } finally {
      closeSync(temporary.fd);
    }

    let lastError;
    for (let attempt = 0; attempt < ATOMIC_RENAME_ATTEMPTS; attempt += 1) {
      try {
        renameSync(temporaryPath, path);
        temporaryPath = null;
        fsyncDirectoryBestEffort(dirname(path));
        return;
      } catch (error) {
        lastError = error;
        const retryable = ["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(
          error?.code
        );
        if (!retryable || attempt === ATOMIC_RENAME_ATTEMPTS - 1) break;
        wait(ATOMIC_RENAME_RETRY_MS);
      }
    }

    const replacementError = new Error(
      `atomic state replace failed; existing state was preserved (${path})`,
      { cause: lastError }
    );
    replacementError.code = lastError?.code;
    throw replacementError;
  } finally {
    if (temporaryPath) removeTemporaryFile(temporaryPath);
  }
}

/** Write a bounded JSON document through a durable same-directory atomic replacement. */
export function writeJsonAtomic(
  path,
  value,
  { root, maxBytes = MAX_STATE_FILE_BYTES } = {}
) {
  const data = stateJsonBuffer(value, maxBytes);
  return writeStateFileAtomic(path, data, { root, maxBytes, mode: 0o600 });
}

/** Remove one regular, single-link state file after a final identity check. */
export function removeStateFileGuarded(path, { root, missingOk = true } = {}) {
  try {
    path = resolveStatePath(path, root, { mustExist: true });
  } catch (error) {
    if (missingOk && /file does not exist/.test(String(error?.message || ""))) {
      return false;
    }
    throw error;
  }
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(
      `unsafe state delete: final entry is not a safe file (${path})`
    );
  }
  const noFollow = constants.O_NOFOLLOW || 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || !sameInode(before, opened)) {
      throw new Error(
        `unsafe state delete: file changed before open (${path})`
      );
    }
  } finally {
    closeSync(fd);
  }
  const after = lstatSync(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    !sameInode(before, after)
  ) {
    throw new Error(
      `unsafe state delete: file changed before unlink (${path})`
    );
  }
  unlinkSync(path);
  return true;
}

/**
 * Recursively remove a state subtree without following links or accepting hard-linked files.
 * Callers must hold the owner lock that excludes writers for the logical scope being purged.
 */
export function removeStateTreeGuarded(path, { root, missingOk = true } = {}) {
  try {
    path = resolveStateDirectory(path, root, { mustExist: true });
  } catch (error) {
    if (
      missingOk &&
      /does not exist|path component/i.test(String(error?.message || ""))
    ) {
      return false;
    }
    throw error;
  }

  function removeDirectory(directory) {
    directory = resolveStateDirectory(directory, root, { mustExist: true });
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(
        `unsafe state delete: entry is not a safe directory (${directory})`
      );
    }
    for (const name of readdirSync(directory)) {
      const child = join(directory, name);
      if (name.endsWith(".lock")) {
        throw new Error(
          `unsafe state delete: active or stale lock rejected (${child})`
        );
      }
      const entry = lstatSync(child);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `unsafe state delete: linked entry rejected (${child})`
        );
      }
      if (entry.isDirectory()) removeDirectory(child);
      else if (entry.isFile())
        removeStateFileGuarded(child, { root, missingOk: false });
      else
        throw new Error(
          `unsafe state delete: special entry rejected (${child})`
        );
    }
    rmdirSync(directory);
  }

  removeDirectory(path);
  return true;
}
