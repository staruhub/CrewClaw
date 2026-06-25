import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

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
            description: "File path to read, relative to the current working directory or absolute.",
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
        "Make a small exact text replacement in an existing file. Use edit_file for focused edits; old_string must match exactly once. Paths are relative to the current working directory unless absolute.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to edit, relative to the current working directory or absolute.",
          },
          old_string: {
            type: "string",
            description: "Exact text to replace. It must appear exactly once in the file.",
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
        "Create or fully overwrite a file. Use write_file for new files or large rewrites; use edit_file for small targeted changes. Paths are relative to the current working directory unless absolute.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to write, relative to the current working directory or absolute.",
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

function resolvePath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new Error("path must be a non-empty string");
  }
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

function errorResult(error) {
  return { ok: false, error: error?.message ?? String(error) };
}

function readTextFile(filePath) {
  const resolved = resolvePath(filePath);
  const info = statSync(resolved);
  if (!info.isFile()) throw new Error(`not a file: ${filePath}`);
  if (info.size > MAX_READ_BYTES) {
    throw new Error(`file is too large to read (${info.size} bytes > ${MAX_READ_BYTES} bytes): ${filePath}`);
  }
  return readFileSync(resolved, "utf8");
}

export function readFileSafe(filePath) {
  try {
    return { ok: true, content: readTextFile(filePath) };
  } catch (error) {
    return errorResult(error);
  }
}

export function computeEdit(filePath, oldString, newString) {
  try {
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new Error("old_string must be a non-empty string");
    }
    if (typeof newString !== "string") {
      throw new Error("new_string must be a string");
    }

    const oldContent = readTextFile(filePath);
    const first = oldContent.indexOf(oldString);
    if (first === -1) {
      throw new Error("old_string not found in file");
    }
    const second = oldContent.indexOf(oldString, first + oldString.length);
    if (second !== -1) {
      throw new Error("old_string must be unique in file; found multiple matches");
    }

    return {
      ok: true,
      oldContent,
      newContent: oldContent.slice(0, first) + newString + oldContent.slice(first + oldString.length),
    };
  } catch (error) {
    return errorResult(error);
  }
}

export function computeWrite(filePath, content) {
  try {
    if (typeof content !== "string") {
      throw new Error("content must be a string");
    }

    const resolved = resolvePath(filePath);
    const existed = existsSync(resolved);
    let oldContent = "";
    if (existed) {
      oldContent = readTextFile(resolved);
    }

    return { ok: true, oldContent, newContent: content, existed };
  } catch (error) {
    return errorResult(error);
  }
}

export function applyWrite(filePath, content) {
  try {
    if (typeof content !== "string") {
      throw new Error("content must be a string");
    }
    const resolved = resolvePath(filePath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, "utf8");
    return { ok: true };
  } catch (error) {
    return errorResult(error);
  }
}
