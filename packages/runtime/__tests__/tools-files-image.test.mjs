import assert from "node:assert/strict";
import { isImagePath, readImageDataUrl } from "../tools-files.mjs";

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
  const gitBashImagePath = "/c/Users/12117/Playground/crewclaw/crewhire/decks/arkclaw-design-security/scratch/assets/creation-atelier.png";
  const imagePath = process.platform === "win32"
    ? "C:/Users/12117/Playground/crewclaw/crewhire/decks/arkclaw-design-security/scratch/assets/creation-atelier.png"
    : gitBashImagePath;

  const result = await readImageDataUrl(imagePath);

  assert.equal(result.ok, true);
  assert.equal(result.dataUrl.startsWith(prefix), true);
  assert.equal(result.bytes > 0, true);
  assert.equal(result.bytes < 4.5 * 1024 * 1024, true);
  assert.equal(result.dataUrl.length - prefix.length > 1000, true);
});

await test("readImageDataUrl rejects unsupported types", async () => {
  const result = await readImageDataUrl("foo.txt");

  assert.equal(result.ok, false);
  assert.match(result.error, /不支持|类型/);
});
