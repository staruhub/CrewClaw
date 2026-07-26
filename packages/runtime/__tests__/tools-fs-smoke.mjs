import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyWrite,
  computeEdit,
  computeWrite,
  fsToolSchemas,
  listFiles,
  readFileSafe,
} from "../tools-fs.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "crewclaw-tools-fs-"));
const root = join(sandbox, "workspace");
const outside = join(sandbox, "outside");
mkdirSync(root);
mkdirSync(outside);

try {
  const file = join(root, "sample.txt");
  writeFileSync(file, "alpha\nbeta\ngamma\n", "utf8");

  assert.equal(fsToolSchemas.length, 4);
  assert.deepEqual(
    fsToolSchemas.map(tool => tool.function.name),
    ["list_files", "read_file", "edit_file", "write_file"]
  );

  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "docs", "nested"));
  writeFileSync(join(root, "docs", "guide.md"), "guide", "utf8");
  writeFileSync(join(root, "docs", "nested", "deep.md"), "deep", "utf8");
  writeFileSync(join(root, "docs", "nested", "skip.txt"), "skip", "utf8");
  const listed = listFiles("docs", {
    root,
    pattern: "*.md",
    recursive: true,
  });
  assert.equal(listed.ok, true, listed.error);
  assert.deepEqual(listed.entries, ["guide.md", "nested/deep.md"]);
  assert.deepEqual(
    listFiles("docs", { root, pattern: "**.md", recursive: true }).entries,
    ["guide.md"],
    "a doubled star without a following slash must not cross directories"
  );
  assert.deepEqual(
    listFiles("docs", { root, pattern: "**/*.md" }).entries,
    ["guide.md", "nested/deep.md"],
    "only an explicit globstar segment crosses directories"
  );
  assert.equal(listFiles(join(outside), { root }).ok, false);
  assert.equal(listFiles("docs", { root, maxResults: 1 }).truncated, true);

  const read = readFileSafe("sample.txt", { root });
  assert.equal(read.ok, true);
  assert.equal(read.content, "alpha\nbeta\ngamma\n");
  assert.equal(readFileSafe("sample.txt").ok, false, "root is mandatory");
  assert.equal(
    readFileSafe(join(outside, "secret.txt"), { root }).ok,
    false,
    "outside read is denied"
  );

  const edit = computeEdit("sample.txt", "beta", "BETA", { root });
  assert.equal(edit.ok, true);
  assert.equal(edit.oldContent, "alpha\nbeta\ngamma\n");
  assert.equal(edit.newContent, "alpha\nBETA\ngamma\n");
  assert.equal(readFileSync(file, "utf8"), "alpha\nbeta\ngamma\n");

  writeFileSync(file, "same\nsame\n", "utf8");
  const duplicateEdit = computeEdit("sample.txt", "same", "once", { root });
  assert.equal(duplicateEdit.ok, false);
  assert.match(duplicateEdit.error, /unique/i);

  const missingEdit = computeEdit("sample.txt", "missing", "value", { root });
  assert.equal(missingEdit.ok, false);
  assert.match(missingEdit.error, /not found/i);

  const newFile = join(root, "new.txt");
  const newWrite = computeWrite("new.txt", "created\n", { root });
  assert.equal(newWrite.ok, true);
  assert.equal(newWrite.existed, false);
  assert.equal(newWrite.oldContent, "");
  assert.equal(newWrite.newContent, "created\n");
  assert.equal(existsSync(newFile), false);

  const overwrite = computeWrite("sample.txt", "replacement\n", { root });
  assert.equal(overwrite.ok, true);
  assert.equal(overwrite.existed, true);
  assert.equal(overwrite.oldContent, "same\nsame\n");
  assert.equal(readFileSync(file, "utf8"), "same\nsame\n");
  const overwriteApplied = applyWrite("sample.txt", overwrite.newContent, {
    root,
    guard: overwrite.guard,
  });
  assert.equal(overwriteApplied.ok, true, overwriteApplied.error);
  assert.equal(readFileSync(file, "utf8"), "replacement\n");

  const staleWrite = computeWrite("sample.txt", "must-not-win\n", { root });
  assert.equal(staleWrite.ok, true);
  writeFileSync(file, "concurrent-change\n", "utf8");
  const staleResult = applyWrite("sample.txt", staleWrite.newContent, {
    root,
    guard: staleWrite.guard,
  });
  assert.equal(staleResult.ok, false);
  assert.equal(
    readFileSync(file, "utf8"),
    "concurrent-change\n",
    "failed apply preserves original bytes"
  );

  const applied = applyWrite("new.txt", "applied\n", {
    root,
    guard: newWrite.guard,
  });
  assert.equal(applied.ok, true);
  assert.equal(readFileSync(newFile, "utf8"), "applied\n");
  assert.equal(
    applyWrite("unguarded.txt", "nope\n", { root }).ok,
    false,
    "unguarded writes fail closed"
  );

  // Preview-to-apply junction swap: the same lexical path now points outside. Revalidation must
  // reject it before any external file is modified.
  const guardedDir = join(root, "guarded");
  mkdirSync(guardedDir);
  writeFileSync(join(guardedDir, "target.txt"), "inside", "utf8");
  writeFileSync(join(outside, "target.txt"), "outside", "utf8");
  const guardedWrite = computeWrite("guarded/target.txt", "changed", { root });
  assert.equal(guardedWrite.ok, true);
  renameSync(guardedDir, join(root, "guarded-original"));
  symlinkSync(outside, guardedDir, "junction");
  assert.equal(
    listFiles("guarded", { root }).ok,
    false,
    "directory listing rejects a junction that escapes the workspace"
  );
  const raced = applyWrite("guarded/target.txt", "changed", {
    root,
    guard: guardedWrite.guard,
  });
  assert.equal(raced.ok, false);
  assert.match(raced.error, /symbolic|outside|changed/i);
  assert.equal(readFileSync(join(outside, "target.txt"), "utf8"), "outside");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
