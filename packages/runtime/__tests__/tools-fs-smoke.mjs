import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyWrite,
  computeEdit,
  computeWrite,
  fsToolSchemas,
  readFileSafe,
} from "../tools-fs.mjs";

const root = mkdtempSync(join(tmpdir(), "crewclaw-tools-fs-"));
const file = join(root, "sample.txt");
writeFileSync(file, "alpha\nbeta\ngamma\n", "utf8");

assert.equal(fsToolSchemas.length, 3);
assert.deepEqual(
  fsToolSchemas.map((tool) => tool.function.name),
  ["read_file", "edit_file", "write_file"],
);

const read = readFileSafe(file);
assert.equal(read.ok, true);
assert.equal(read.content, "alpha\nbeta\ngamma\n");

const edit = computeEdit(file, "beta", "BETA");
assert.equal(edit.ok, true);
assert.equal(edit.oldContent, "alpha\nbeta\ngamma\n");
assert.equal(edit.newContent, "alpha\nBETA\ngamma\n");
assert.equal(readFileSync(file, "utf8"), "alpha\nbeta\ngamma\n");

writeFileSync(file, "same\nsame\n", "utf8");
const duplicateEdit = computeEdit(file, "same", "once");
assert.equal(duplicateEdit.ok, false);
assert.match(duplicateEdit.error, /unique/i);

const missingEdit = computeEdit(file, "missing", "value");
assert.equal(missingEdit.ok, false);
assert.match(missingEdit.error, /not found/i);

const newFile = join(root, "new.txt");
const newWrite = computeWrite(newFile, "created\n");
assert.equal(newWrite.ok, true);
assert.equal(newWrite.existed, false);
assert.equal(newWrite.oldContent, "");
assert.equal(newWrite.newContent, "created\n");
assert.equal(existsSync(newFile), false);

const overwrite = computeWrite(file, "replacement\n");
assert.equal(overwrite.ok, true);
assert.equal(overwrite.existed, true);
assert.equal(overwrite.oldContent, "same\nsame\n");
assert.equal(overwrite.newContent, "replacement\n");
assert.equal(readFileSync(file, "utf8"), "same\nsame\n");

const applied = applyWrite(newFile, "applied\n");
assert.equal(applied.ok, true);
assert.equal(readFileSync(newFile, "utf8"), "applied\n");
