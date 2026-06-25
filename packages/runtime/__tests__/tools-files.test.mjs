import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { readAnyFile } from "../tools-files.mjs";

function portableTempPath(name) {
  return path.join(os.tmpdir(), name).replace(/\\/g, "/");
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await test("xlsx round-trip extracts workbook text", async () => {
  const filePath = portableTempPath(`crewclaw-tools-files-${process.pid}.xlsx`);
  try {
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

    const result = await readAnyFile(filePath);

    assert.equal(result.ok, true);
    assert.equal(result.kind, "xlsx");
    assert.match(result.text, /Candidates/);
    assert.match(result.text, /Lin Mei/);
    assert.match(result.text, /---/);
  } finally {
    await rm(filePath, { force: true });
  }
});

await test("text file preserves Chinese content", async () => {
  const filePath = portableTempPath(`crewclaw-tools-files-${process.pid}.md`);
  const content = "候选人记录：中文内容可以被正确读取。";
  try {
    await writeFile(filePath, content, "utf8");

    const result = await readAnyFile(filePath);

    assert.equal(result.ok, true);
    assert.equal(result.kind, "text");
    assert.match(result.text, /候选人记录/);
    assert.match(result.text, /中文内容可以被正确读取/);
  } finally {
    await rm(filePath, { force: true });
  }
});

await test("missing path returns a not found error", async () => {
  const result = await readAnyFile("/no/such/file_xyz.md");

  assert.equal(result.ok, false);
  assert.match(result.error, /not found|找不到/);
});

await test("directory path is rejected", async () => {
  const result = await readAnyFile(os.tmpdir());

  assert.equal(result.ok, false);
});
