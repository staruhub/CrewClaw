import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { resolvePathInsideRoot } from "./tool-gateway.mjs";

const MAX_READ_BYTES = 200 * 1024;

export const fsToolSchemas = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a local file's text — including Office docs (.docx/.pptx/.xlsx) and .pdf, which are auto-extracted to text. Accepts Windows paths (C:\\\\...), POSIX, or Git-Bash (/c/...) paths. Use this (NOT bash) to read any local file the user mentions or attaches.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path to read inside the configured workspace root; may be relative or absolute.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Make a small exact text replacement in an existing workspace file. Use edit_file for focused edits; old_string must match exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path to edit inside the configured workspace root; may be relative or absolute.",
          },
          old_string: {
            type: "string",
            description:
              "Exact text to replace. It must appear exactly once in the file.",
          },
          new_string: {
            type: "string",
            description: "Replacement text.",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or fully overwrite a workspace file. Use write_file for new files or large rewrites; use edit_file for small targeted changes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path to write inside the configured workspace root; may be relative or absolute.",
          },
          content: {
            type: "string",
            description: "Complete file content to write.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

function errorResult(error) {
  return { ok: false, error: error?.message ?? String(error) };
}

const O_NOFOLLOW = constants.O_NOFOLLOW || 0;

function resolveTarget(filePath, root, { mustExist = false } = {}) {
  const resolved = resolvePathInsideRoot(filePath, root, {
    mustExist,
    rejectSymlinks: true,
  });
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved;
}

function identityOf(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeMs: String(info.mtimeMs),
  };
}

function sameIdentity(left, right) {
  return (
    !!left &&
    !!right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function samePath(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    relative(left, right) === "" &&
    relative(right, left) === ""
  );
}

function readTextFileResolved(resolved) {
  const before = lstatSync(resolved);
  if (before.isSymbolicLink())
    throw new Error(
      "symbolic links are not allowed in workspace file operations"
    );
  if (!before.isFile()) throw new Error(`not a file: ${resolved}`);
  let fd;
  try {
    fd = openSync(resolved, constants.O_RDONLY | O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!sameIdentity(identityOf(before), identityOf(info)))
      throw new Error("file changed during validation");
    if (!info.isFile()) throw new Error(`not a file: ${resolved}`);
    if (info.size > MAX_READ_BYTES) {
      throw new Error(
        `file is too large to read (${info.size} bytes > ${MAX_READ_BYTES} bytes): ${resolved}`
      );
    }
    return { content: readFileSync(fd, "utf8"), identity: identityOf(info) };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function validateOpenedIdentity(path, expected) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || !sameIdentity(identityOf(info), expected)) {
      throw new Error("write target changed after preview");
    }
    return info;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeTempSibling(targetPath, content, mode) {
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.crewclaw-${process.pid}-${randomUUID()}.tmp`
  );
  let fd;
  try {
    fd = openSync(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
      mode
    );
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    return tempPath;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(tempPath);
    } catch {
      /* best-effort cleanup */
    }
    throw error;
  }
}

export function readFileSafe(filePath, { root } = {}) {
  try {
    const target = resolveTarget(filePath, root, { mustExist: true });
    const read = readTextFileResolved(target.path);
    return { ok: true, content: read.content, path: target.path };
  } catch (error) {
    return errorResult(error);
  }
}

export function computeEdit(filePath, oldString, newString, { root } = {}) {
  try {
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new Error("old_string must be a non-empty string");
    }
    if (typeof newString !== "string") {
      throw new Error("new_string must be a string");
    }

    const target = resolveTarget(filePath, root, { mustExist: true });
    const read = readTextFileResolved(target.path);
    const oldContent = read.content;
    const first = oldContent.indexOf(oldString);
    if (first === -1) {
      throw new Error("old_string not found in file");
    }
    const second = oldContent.indexOf(oldString, first + oldString.length);
    if (second !== -1) {
      throw new Error(
        "old_string must be unique in file; found multiple matches"
      );
    }

    return {
      ok: true,
      oldContent,
      newContent:
        oldContent.slice(0, first) +
        newString +
        oldContent.slice(first + oldString.length),
      guard: {
        rootPath: target.rootPath,
        targetPath: target.path,
        existed: true,
        identity: read.identity,
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export function computeWrite(filePath, content, { root } = {}) {
  try {
    if (typeof content !== "string") {
      throw new Error("content must be a string");
    }

    const target = resolveTarget(filePath, root);
    const existed = target.exists;
    let oldContent = "";
    let identity = null;
    if (existed) {
      const read = readTextFileResolved(target.path);
      oldContent = read.content;
      identity = read.identity;
    }

    return {
      ok: true,
      oldContent,
      newContent: content,
      existed,
      guard: {
        rootPath: target.rootPath,
        targetPath: target.path,
        existed,
        identity,
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export function applyWrite(filePath, content, { root, guard } = {}) {
  let tempPath;
  try {
    if (typeof content !== "string") {
      throw new Error("content must be a string");
    }
    if (!guard || typeof guard !== "object")
      throw new Error(
        "write guard is required; call computeWrite/computeEdit first"
      );
    const target = resolveTarget(filePath, root);
    if (
      !samePath(target.rootPath, guard.rootPath) ||
      !samePath(target.path, guard.targetPath)
    ) {
      throw new Error("write target changed after preview");
    }

    let mode = 0o666;
    if (guard.existed) {
      if (!target.exists)
        throw new Error("write target disappeared after preview");
      mode = validateOpenedIdentity(target.path, guard.identity).mode & 0o777;
    } else {
      if (target.exists) throw new Error("write target appeared after preview");
      mkdirSync(dirname(target.path), { recursive: true });
    }

    // The original file remains untouched until a complete, fsynced sibling is ready.
    const preTemp = resolveTarget(filePath, root);
    if (
      !samePath(preTemp.path, guard.targetPath) ||
      preTemp.exists !== guard.existed
    ) {
      throw new Error("write target changed after preview");
    }
    if (guard.existed) validateOpenedIdentity(preTemp.path, guard.identity);
    tempPath = writeTempSibling(target.path, content, mode);

    // Final compare immediately before publication. POSIX rename replaces atomically; on Windows,
    // a failed replace is surfaced and the original is preserved—there is no truncate fallback.
    const finalTarget = resolveTarget(filePath, root);
    if (
      !samePath(finalTarget.path, guard.targetPath) ||
      finalTarget.exists !== guard.existed
    ) {
      throw new Error("write target changed after preview");
    }
    if (guard.existed) {
      validateOpenedIdentity(finalTarget.path, guard.identity);
      renameSync(tempPath, finalTarget.path);
      tempPath = undefined;
    } else {
      // Hard-link publication provides atomic no-replace semantics for a newly-created target.
      linkSync(tempPath, finalTarget.path);
      unlinkSync(tempPath);
      tempPath = undefined;
    }
    return { ok: true, path: target.path };
  } catch (error) {
    return errorResult(error);
  } finally {
    if (tempPath) {
      try {
        unlinkSync(tempPath);
      } catch {
        /* preserve original error */
      }
    }
  }
}
