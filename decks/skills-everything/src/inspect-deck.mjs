import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const workspace = process.cwd();
const pptx = path.join(workspace, "output/output.pptx");
const previewDir = path.join(workspace, "scratch/previews");

async function listZip(file) {
  const { stdout } = await run("unzip", ["-l", file], { maxBuffer: 4_000_000 });
  return stdout.split("\n");
}

async function main() {
  const lines = await listZip(pptx);
  const slideFiles = new Set();
  let mediaCount = 0;
  const zeroByteMedia = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/);
    if (!match) continue;
    const size = Number(match[1]);
    const file = match[2].trim();
    if (/ppt\/slides\/slide\d+\.xml$/.test(file)) slideFiles.add(file);
    if (/ppt\/media\//.test(file)) {
      mediaCount += 1;
      if (size === 0) zeroByteMedia.push(file);
    }
  }
  const previews = (await fs.readdir(previewDir)).filter((name) => /^slide-\d+\.png$/.test(name)).sort();
  const previewSizes = await Promise.all(previews.map(async (name) => [name, (await fs.stat(path.join(previewDir, name))).size]));
  const report = {
    workspace,
    pptx,
    checks: {
      pptx_package: {
        slide_count: slideFiles.size,
        media_count: mediaCount,
        zero_byte_media: zeroByteMedia,
        warnings: [],
        failures: [],
      },
      png_previews: {
        preview_count: previews.length,
        zero_byte_previews: previewSizes.filter(([, size]) => size === 0).map(([name]) => name),
      },
      output_hygiene: {
        output_dir: path.join(workspace, "output"),
        expected_files: ["output.pptx"],
      },
    },
    failures: [],
    warnings: [],
  };
  if (slideFiles.size !== 16) report.failures.push(`expected 16 slides, found ${slideFiles.size}`);
  if (previews.length !== slideFiles.size) report.failures.push(`preview count ${previews.length} does not match slide count ${slideFiles.size}`);
  if (zeroByteMedia.length) report.failures.push("zero-byte media found");
  if (report.checks.png_previews.zero_byte_previews.length) report.failures.push("zero-byte previews found");
  await fs.writeFile(path.join(workspace, "scratch/quality-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
