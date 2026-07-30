import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

import { readAnyFile, resolveLocalPath } from "../tools-files.mjs";

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const sandbox = mkdtempSync(path.join(os.tmpdir(), "crewclaw-tools-files-"));
const root = path.join(sandbox, "workspace");
const outside = path.join(sandbox, "outside");
mkdirSync(root);
mkdirSync(outside);

try {
  await test("xlsx round-trip extracts workbook text", async () => {
    const filePath = path.join(root, "candidates.xlsx");
    const workbook = new ExcelJS.Workbook();
    const candidates = workbook.addWorksheet("Candidates");
    candidates.addRow(["Name", "Role", "Score"]);
    candidates.addRow(["Lin Mei", "Engineer", 96]);
    candidates.addRow(["Zhang Wei", "Designer", 91]);

    const interviews = workbook.addWorksheet("Interviews");
    interviews.addRow(["Candidate", "Stage", "Decision"]);
    interviews.addRow(["Lin Mei", "Final", "Hire"]);
    interviews.addRow(["Zhang Wei", "Portfolio", "Review"]);
    await workbook.xlsx.writeFile(filePath);

    const result = await readAnyFile("candidates.xlsx", { root });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "xlsx");
    assert.match(result.text, /Candidates/);
    assert.match(result.text, /Lin Mei/);
    assert.match(result.text, /---/);
  });

  await test("text file preserves Chinese content", async () => {
    const content = "候选人记录：中文内容可以被正确读取。";
    writeFileSync(path.join(root, "notes.md"), content, "utf8");
    const result = await readAnyFile("notes.md", { root });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "text");
    assert.match(result.text, /候选人记录/);
    assert.match(result.text, /中文内容可以被正确读取/);
  });

  await test("root is mandatory and outside paths are rejected", async () => {
    writeFileSync(path.join(outside, "secret.md"), "secret", "utf8");
    assert.equal((await readAnyFile("notes.md")).ok, false);
    assert.match((await readAnyFile("notes.md")).error, /root/i);
    assert.equal(
      (await readAnyFile(path.join(outside, "secret.md"), { root })).ok,
      false
    );
    assert.equal(resolveLocalPath("../outside/secret.md", { root }).ok, false);
  });

  await test("symlink and junction escapes are rejected", async () => {
    const link = path.join(root, "escape-link");
    symlinkSync(outside, link, "junction");
    const result = await readAnyFile("escape-link/secret.md", { root });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found|symbolic|outside/i);
  });

  await test("missing path returns a not found error", async () => {
    const result = await readAnyFile("no/such/file_xyz.md", { root });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found|找不到/);
  });

  await test("directory path is rejected", async () => {
    const result = await readAnyFile(".", { root });
    assert.equal(result.ok, false);
  });

  await test("oversized files are rejected before extraction", async () => {
    const filePath = path.join(root, "oversized.md");
    writeFileSync(filePath, "");
    truncateSync(filePath, 16 * 1024 * 1024 + 1);
    const result = await readAnyFile("oversized.md", { root });
    assert.equal(result.ok, false);
    assert.match(result.error, /exceeds read limit/);
  });
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
