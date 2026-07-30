import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { fileTypeFromFile } from "file-type";

const releaseVideo = resolve("public/crewclaw-demo.zh-CN.mp4");
const poster = resolve("docs/assets/crewclaw-demo-cover.jpg");
const readmePath = resolve("README.md");
const playbackUrl = "https://crewhire.fly.dev/crewclaw-demo.zh-CN.mp4";
const approvedSha256 =
  "2f52f92590b9f380a63c315cd2f0ef658cf3ae9c44df9b0c179c4b145b75e2d1";

function readMovieDuration(buffer) {
  const marker = buffer.indexOf(Buffer.from("mvhd"));
  assert.notEqual(marker, -1, "MP4 movie header (mvhd) is missing");

  const version = buffer[marker + 4];
  if (version === 0) {
    const timescale = buffer.readUInt32BE(marker + 16);
    const duration = buffer.readUInt32BE(marker + 20);
    return duration / timescale;
  }
  if (version === 1) {
    const timescale = buffer.readUInt32BE(marker + 28);
    const duration = Number(buffer.readBigUInt64BE(marker + 32));
    return duration / timescale;
  }

  throw new Error(`Unsupported MP4 movie-header version: ${version}`);
}

const [video, readme, videoType, posterType] = await Promise.all([
  readFile(releaseVideo),
  readFile(readmePath, "utf8"),
  fileTypeFromFile(releaseVideo),
  fileTypeFromFile(poster),
]);

assert.equal(videoType?.mime, "video/mp4", "Release demo must be an MP4 file");
assert.equal(
  posterType?.mime,
  "image/jpeg",
  "Release demo poster must be a JPEG file"
);

const sha256 = createHash("sha256").update(video).digest("hex");
assert.equal(
  sha256,
  approvedSha256,
  "Release demo differs from the approved pixel-art master"
);

const duration = readMovieDuration(video);
assert.ok(
  duration >= 179 && duration <= 181,
  `Release demo duration must remain about 180 seconds; received ${duration.toFixed(3)}`
);

const playbackLinkCount = readme.split(playbackUrl).length - 1;
assert.ok(
  playbackLinkCount >= 3,
  "README must expose the stable production playback URL in both language sections"
);

console.log(
  `Pixel-art demo verified (${duration.toFixed(3)}s, ${videoType.ext}, ${sha256.slice(0, 12)}…)`
);
