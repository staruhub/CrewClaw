import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export const MAX_LOCAL_STATE_BYTES = 8 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 15;

type FileIdentity = {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  nlink: bigint;
};

type OwnerLockRecord = {
  token: string;
  pid: number;
  created_at_ms: number;
};

function invalidState(message: string) {
  return Object.assign(new Error(message), { code: "INVALID_LOCAL_STATE" });
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isContention(error: unknown) {
  return ["EEXIST", "EACCES", "EPERM"].includes(
    (error as NodeJS.ErrnoException)?.code ?? ""
  );
}

function assertSafeRelativePath(value: string) {
  if (!value || isAbsolute(value))
    throw invalidState("state path must be relative");
  const parts = value.replaceAll("\\", "/").split("/");
  if (parts.some(part => !part || part === "." || part === "..")) {
    throw invalidState("state path contains an unsafe component");
  }
  return parts;
}

function isInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function safeDirectory(path: string, create: boolean) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw invalidState(
        "state path contains a link or non-directory component"
      );
    }
    return true;
  } catch (error) {
    if (!isMissing(error) || !create) {
      if (isMissing(error)) return false;
      throw error;
    }
    await mkdir(path, { mode: 0o700 });
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw invalidState("new state directory is unsafe");
    }
    return true;
  }
}

async function resolveStatePath(
  rootInput: string,
  stateRelative: string,
  createParents: boolean
) {
  const parts = assertSafeRelativePath(stateRelative);
  const canonicalRoot = await realpath(resolve(rootInput));
  const stateRoot = join(canonicalRoot, ".crewclaw");
  if (!(await safeDirectory(stateRoot, createParents))) return null;

  let parent = stateRoot;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    if (!(await safeDirectory(parent, createParents))) return null;
    const canonicalParent = await realpath(parent);
    if (!isInside(canonicalRoot, canonicalParent)) {
      throw invalidState("state directory escapes the workspace root");
    }
    parent = canonicalParent;
  }

  const target = join(parent, parts.at(-1)!);
  if (!isInside(canonicalRoot, target)) {
    throw invalidState("state target escapes the workspace root");
  }
  return target;
}

function identity(metadata: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  nlink: bigint;
}): FileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
    nlink: metadata.nlink,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink
  );
}

async function validateRegularFile(path: string, maxBytes: number) {
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidState("state target must be a regular file");
  }
  if (metadata.nlink !== 1n)
    throw invalidState("hard-linked state is rejected");
  if (metadata.size > BigInt(maxBytes)) {
    throw invalidState(`state file exceeds ${maxBytes} bytes`);
  }
  return identity(metadata);
}

export async function readStateFile(
  root: string,
  stateRelative: string,
  maxBytes = MAX_LOCAL_STATE_BYTES
) {
  if (maxBytes > MAX_LOCAL_STATE_BYTES) {
    throw invalidState("requested read exceeds the global state limit");
  }
  const path = await resolveStatePath(root, stateRelative, false);
  if (!path) return null;
  let before: FileIdentity;
  try {
    before = await validateRegularFile(path, maxBytes);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const openedBefore = identity(await handle.stat({ bigint: true }));
    if (!sameIdentity(before, openedBefore)) {
      throw invalidState("state pathname changed before reading");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes)
      throw invalidState("state file grew while reading");
    const openedAfter = identity(await handle.stat({ bigint: true }));
    const pathnameAfter = await validateRegularFile(path, maxBytes);
    if (
      !sameIdentity(openedBefore, openedAfter) ||
      !sameIdentity(openedBefore, pathnameAfter) ||
      BigInt(bytes.byteLength) !== openedAfter.size
    ) {
      throw invalidState("state file changed while reading");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function listStateFiles(
  root: string,
  stateDirectory: string,
  maxFiles = 4_096
) {
  const sentinel = await resolveStatePath(
    root,
    `${stateDirectory}/.__crewclaw_list_sentinel__`,
    false
  );
  if (!sentinel) return [];
  const directory = dirname(sentinel);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > maxFiles)
    throw invalidState("state directory has too many entries");
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw invalidState("state directory contains a link");
    if (entry.isFile()) files.push(`${stateDirectory}/${entry.name}`);
  }
  return files.sort();
}

async function validateExistingTarget(path: string) {
  try {
    await validateRegularFile(path, MAX_LOCAL_STATE_BYTES);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function writeStateFileAtomic(
  root: string,
  stateRelative: string,
  bytes: Uint8Array
) {
  if (bytes.byteLength > MAX_LOCAL_STATE_BYTES) {
    throw invalidState("state output exceeds the 8 MiB limit");
  }
  const target = await resolveStatePath(root, stateRelative, true);
  if (!target) throw invalidState("state parent is unavailable");
  await validateExistingTarget(target);

  const temp = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const tempIdentity = identity(await handle.stat({ bigint: true }));
    if (
      tempIdentity.size !== BigInt(bytes.byteLength) ||
      tempIdentity.nlink !== 1n
    ) {
      throw invalidState("temporary state file failed validation");
    }
    const revalidated = await resolveStatePath(root, stateRelative, true);
    if (revalidated !== target)
      throw invalidState("state parent changed before write");
    await validateExistingTarget(target);
    await handle.close();
    await rename(temp, target);
    const replacement = await validateRegularFile(
      target,
      MAX_LOCAL_STATE_BYTES
    );
    if (
      replacement.dev !== tempIdentity.dev ||
      replacement.ino !== tempIdentity.ino ||
      replacement.size !== tempIdentity.size
    ) {
      throw invalidState("atomic state replacement failed validation");
    }
    try {
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // Directory fsync is not available on every Windows filesystem.
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

function parseLock(bytes: Uint8Array): OwnerLockRecord | null {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof value.token !== "string" ||
      !Number.isInteger(value.pid) ||
      !Number.isFinite(value.created_at_ms)
    ) {
      return null;
    }
    return value as OwnerLockRecord;
  } catch {
    return null;
  }
}

function lockRelativePath(stateRelative: string) {
  const parts = assertSafeRelativePath(stateRelative);
  const file = parts.pop()!;
  return [...parts, `.${file}.lock`].join("/");
}

async function removeLockIfOwned(
  root: string,
  lockRelative: string,
  expected: OwnerLockRecord,
  expectedIdentity: FileIdentity
) {
  const path = await resolveStatePath(root, lockRelative, false);
  if (!path) return;
  let currentIdentity: FileIdentity;
  try {
    currentIdentity = await validateRegularFile(path, 16 * 1024);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (
    currentIdentity.dev !== expectedIdentity.dev ||
    currentIdentity.ino !== expectedIdentity.ino
  ) {
    return;
  }
  const bytes = await readStateFile(root, lockRelative, 16 * 1024);
  const current = bytes && parseLock(bytes);
  if (current?.token !== expected.token) return;
  await unlink(path);
}

async function acquireOwnerLock(root: string, stateRelative: string) {
  const lockRelative = lockRelativePath(stateRelative);
  const lockPath = await resolveStatePath(root, lockRelative, true);
  if (!lockPath) throw invalidState("lock parent is unavailable");
  const started = Date.now();

  while (true) {
    const record: OwnerLockRecord = {
      token: randomUUID().replaceAll("-", ""),
      pid: process.pid,
      created_at_ms: Date.now(),
    };
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
        const ownedIdentity = identity(await handle.stat({ bigint: true }));
        return async () => {
          await removeLockIfOwned(root, lockRelative, record, ownedIdentity);
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!isContention(error)) throw error;
      const bytes = await readStateFile(root, lockRelative, 16 * 1024).catch(
        () => null
      );
      const existing = bytes && parseLock(bytes);
      if (
        existing &&
        Date.now() - existing.created_at_ms >= LOCK_STALE_MS &&
        !processIsAlive(existing.pid)
      ) {
        const currentPath = await resolveStatePath(root, lockRelative, false);
        if (currentPath) {
          const currentIdentity = await validateRegularFile(
            currentPath,
            16 * 1024
          );
          await removeLockIfOwned(
            root,
            lockRelative,
            existing,
            currentIdentity
          );
          continue;
        }
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw Object.assign(
          new Error("timed out waiting for workspace owner lock"),
          {
            code: "LOCAL_STATE_LOCK_TIMEOUT",
          }
        );
      }
      await new Promise(resolveWait => setTimeout(resolveWait, LOCK_POLL_MS));
    }
  }
}

export async function withStateOwnerLock<T>(
  root: string,
  stateRelative: string,
  operation: () => Promise<T>
) {
  const release = await acquireOwnerLock(root, stateRelative);
  try {
    return await operation();
  } finally {
    await release();
  }
}
