import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";
import { findExpert } from "../../packages/registry/src/index";

// pack-employee — builds a downloadable employee package (gzipped tar) from experts/<slug>/, so the
// website's "download employee" is a real artifact, not just a copyable command. Dependency-free:
// tar is 512-byte blocks and zlib is built in. Reuses the validator's forbidden-path rules so no
// local secrets/state (.env, sessions, memories, …) can ever leak into a shipped package.

// Kept identical to packages/validator/src/index.ts's forbidden set — the security boundary.
const FORBIDDEN_NAMES = new Set([
  ".env",
  "auth.json",
  "memories",
  "sessions",
  "logs",
  "workspace",
  "plans",
  "home",
  "local",
]);

export function isForbiddenPackagePath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  return parts.some((p) => FORBIDDEN_NAMES.has(p)) || /^state\.db(?:-.+)?$/.test(parts.at(-1) ?? "");
}

function walkFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (isForbiddenPackagePath(rel)) continue;
    if (entry.isDirectory()) out.push(...walkFiles(abs, root));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

// One ustar header block (512 bytes) for a file entry.
function tarHeader(name: string, size: number, mtime: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, "utf8");
  block.write("0000644\0", 100); // mode
  block.write("0000000\0", 108); // uid
  block.write("0000000\0", 116); // gid
  block.write(size.toString(8).padStart(11, "0") + "\0", 124); // size (octal)
  block.write(Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0", 136); // mtime (octal)
  block.write("        ", 148); // checksum placeholder (8 spaces)
  block.write("0", 156); // typeflag: normal file
  block.write("ustar\0", 257);
  block.write("00", 263); // version
  // checksum = sum of all header bytes (with checksum field as spaces)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return block;
}

export type EmployeePackage = {
  filename: string;
  version: string;
  gzip: Buffer;
  sha256: string;
  files: string[];
};

// Build the gzipped tar for `slug`. Throws if the expert is unknown or has no local package dir.
export function buildEmployeePackage(cwd: string, slug: string): EmployeePackage {
  const expert = findExpert(slug, join(cwd, "registry", "experts.json"));
  if (!expert) throw new Error(`unknown employee: ${slug}`);
  if (!expert.local_source) throw new Error(`employee ${slug} has no local package (coming soon)`);
  const root = resolve(cwd, expert.local_source);
  const rootStat = statSync(root); // throws if missing
  if (!rootStat.isDirectory()) throw new Error(`employee ${slug} local_source is not a directory`);

  const files = walkFiles(root, root);
  const chunks: Buffer[] = [];
  for (const rel of files) {
    const abs = join(root, rel);
    const content = readFileSync(abs);
    const st = statSync(abs);
    // Tar entry name is prefixed with the slug dir so untarring yields experts-style <slug>/…
    chunks.push(tarHeader(`${slug}/${rel}`, content.length, st.mtimeMs));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  const tar = Buffer.concat(chunks);
  const gzip = gzipSync(tar);
  const sha256 = createHash("sha256").update(gzip).digest("hex");
  const version = String(expert.version ?? "0.0.0");
  return { filename: `${slug}-${version}.tar.gz`, version, gzip, sha256, files };
}
