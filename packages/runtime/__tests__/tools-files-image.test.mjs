import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectFilePaths,
  isImagePath,
  readImageDataUrl,
} from "../tools-files.mjs";
import { REPO_ROOT } from "./test-paths.mjs";

function writePngFixture(path) {
  const bytes = Buffer.alloc(1024, 0);
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]).copy(bytes);
  writeFileSync(path, bytes);
}

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name);
    throw error;
  }
}

await test("isImagePath returns true for supported image extensions", () => {
  for (const value of ["a/b/c.png", "x.JPG", "y.webp", "/p/q.jpeg"]) {
    assert.equal(isImagePath(value), true);
  }
});

await test("isImagePath returns false for non-image paths", () => {
  for (const value of ["z.txt", "d.pptx", "noext", ""]) {
    assert.equal(isImagePath(value), false);
  }
});

await test("readImageDataUrl reads a real png file as a data URL", async () => {
  const prefix = "data:image/png;base64,";
  const fixture = mkdtempSync(join(tmpdir(), "crewclaw-image-fixture-"));
  const imagePath = join(fixture, "creation-atelier.png");
  writePngFixture(imagePath);

  const result = await readImageDataUrl(imagePath, { root: fixture });

  assert.equal(result.ok, true);
  assert.equal(result.dataUrl.startsWith(prefix), true);
  assert.equal(result.bytes > 0, true);
  assert.equal(result.bytes < 4.5 * 1024 * 1024, true);
  assert.equal(result.dataUrl.length - prefix.length > 1000, true);
  rmSync(fixture, { recursive: true, force: true });
});

await test("readImageDataUrl rejects unsupported types", async () => {
  const result = await readImageDataUrl("foo.txt", { root: REPO_ROOT });

  assert.equal(result.ok, false);
  assert.match(result.error, /不支持|类型/);
});

await test("image path replaced by an outside junction after detection is rejected", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "crewclaw-image-race-"));
  const workspace = join(fixture, "workspace");
  const imageDir = join(workspace, "images");
  const outsideDir = join(fixture, "outside");
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writePngFixture(join(imageDir, "race.png"));
  writePngFixture(join(outsideDir, "race.png"));
  const [detected] = detectFilePaths(join(imageDir, "race.png"), {
    root: workspace,
  });
  assert.ok(detected, "safe image is detected before replacement");
  rmSync(imageDir, { recursive: true, force: true });
  symlinkSync(
    outsideDir,
    imageDir,
    process.platform === "win32" ? "junction" : "dir"
  );

  const result = await readImageDataUrl(detected, { root: workspace });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found|symbolic|workspace/i);
  rmSync(fixture, { recursive: true, force: true });
});
