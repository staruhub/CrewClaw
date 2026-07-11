import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { findExpert } from "../../packages/registry/src/index";
import {
  containsForbiddenSecret,
  EMPLOYEE_PACKAGE_LIMITS,
  isForbiddenPath,
  isSafePortablePackagePath,
  portablePathComparisonKey,
} from "../../contracts/forbidden-paths";

// pack-employee — builds a downloadable employee package (gzipped tar) from experts/<slug>/, so the
// website's "download employee" is a real artifact, not just a copyable command. Dependency-free:
// tar is 512-byte blocks and zlib is built in. The forbidden-path check is the SHARED
// contracts/forbidden-paths module the validator uses, so no local secrets/state (.env, sessions,
// memories, …) can ever leak into a shipped package, and the two can't drift apart.

// Re-exported under the old name so existing importers/tests keep working.
export { isForbiddenPath as isForbiddenPackagePath } from "../../contracts/forbidden-paths";

export function validateTarEntryName(name: string): void {
  if (!isSafePortablePackagePath(name)) {
    throw new Error(`employee package contains unsafe tar entry name: ${name}`);
  }
  const segments = name.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".."))
    throw new Error(`employee package contains unsafe tar entry name: ${name}`);
  if (Buffer.byteLength(name, "utf8") > 100)
    throw new Error(
      `employee package tar entry name exceeds 100 UTF-8 bytes: ${name}`
    );
}

function safeRelativePath(root: string, absolute: string): string {
  const raw = relative(root, absolute);
  if (!raw || isAbsolute(raw))
    throw new Error(`employee package contains unsafe relative path: ${raw}`);
  const segments = raw.split(sep);
  if (
    segments.some(
      segment =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\")
    )
  ) {
    throw new Error(`employee package contains unsafe relative path: ${raw}`);
  }
  const normalized = segments.join("/");
  validateTarEntryName(normalized);
  return normalized;
}

type PackageWalkState = {
  entries: number;
  files: string[];
  portablePaths: Map<string, string>;
};

function walkFiles(
  dir: string,
  root: string,
  state: PackageWalkState = {
    entries: 0,
    files: [],
    portablePaths: new Map(),
  }
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    state.entries += 1;
    if (state.entries > EMPLOYEE_PACKAGE_LIMITS.maxEntries)
      throw new Error(
        `employee package exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxEntries} entries`
      );
    const abs = join(dir, entry.name);
    const rel = safeRelativePath(root, abs);
    const portableKey = portablePathComparisonKey(rel);
    const collidingPath = state.portablePaths.get(portableKey);
    if (collidingPath && collidingPath !== rel) {
      throw new Error(
        `employee package contains case-folding path collision: ${collidingPath} / ${rel}`
      );
    }
    state.portablePaths.set(portableKey, rel);
    if (rel.split("/").length > EMPLOYEE_PACKAGE_LIMITS.maxDepth)
      throw new Error(
        `employee package path exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxDepth} levels: ${rel}`
      );
    if (isForbiddenPath(rel))
      throw new Error(`employee package contains forbidden path: ${rel}`);
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink())
      throw new Error(`employee package cannot contain symlink: ${rel}`);
    const canonical = realpathSync(abs);
    if (!isInside(root, canonical))
      throw new Error(`employee package path escapes source root: ${rel}`);
    if (stat.isDirectory()) walkFiles(canonical, root, state);
    else if (stat.isFile()) {
      if (stat.nlink !== 1)
        throw new Error(`employee package cannot contain hardlink: ${rel}`);
      state.files.push(rel);
      if (state.files.length > EMPLOYEE_PACKAGE_LIMITS.maxFiles)
        throw new Error(
          `employee package exceeds ${EMPLOYEE_PACKAGE_LIMITS.maxFiles} files`
        );
    }
  }
  return state.files.sort();
}

// One ustar header block (512 bytes) for a file entry.
// Git does not preserve working-tree mtimes, so embedding source mtimes would make otherwise
// identical clones produce different package checksums. Use one canonical epoch for every entry.
const REPRODUCIBLE_TAR_MTIME_SECONDS = 0;

function tarHeader(name: string, size: number): Buffer {
  validateTarEntryName(name);
  const nameBytes = Buffer.from(name, "utf8");
  const block = Buffer.alloc(512);
  nameBytes.copy(block, 0);
  block.write("0000644\0", 100); // mode
  block.write("0000000\0", 108); // uid
  block.write("0000000\0", 116); // gid
  block.write(size.toString(8).padStart(11, "0") + "\0", 124); // size (octal)
  block.write(
    REPRODUCIBLE_TAR_MTIME_SECONDS.toString(8).padStart(11, "0") + "\0",
    136
  ); // mtime (octal)
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

export type EmployeePackageMetadata = Omit<EmployeePackage, "gzip"> & {
  slug: string;
};

export function employeePackageMetadata(
  slug: string,
  pkg: EmployeePackage
): EmployeePackageMetadata {
  return {
    slug,
    filename: pkg.filename,
    version: pkg.version,
    sha256: pkg.sha256,
    files: [...pkg.files],
  };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveEmployeePackageRoot(cwd: string, slug: string, source: string) {
  const workspace = realpathSync(resolve(cwd));
  const expertsRoot = realpathSync(join(workspace, "experts"));
  const requested = resolve(workspace, source);
  if (!isInside(expertsRoot, requested))
    throw new Error(`employee ${slug} local_source escapes experts root`);
  if (lstatSync(requested).isSymbolicLink())
    throw new Error(`employee ${slug} local_source cannot be a symlink`);
  const canonical = realpathSync(requested);
  if (!isInside(expertsRoot, canonical))
    throw new Error(`employee ${slug} local_source escapes experts root`);
  const expected = realpathSync(join(expertsRoot, slug));
  if (!pathsEqual(canonical, expected))
    throw new Error(
      `employee ${slug} local_source must resolve to experts/${slug}`
    );
  return canonical;
}

function readPackageFile(root: string, relativePath: string, maxBytes: number) {
  const path = join(root, relativePath);
  const canonical = realpathSync(path);
  if (!isInside(root, canonical))
    throw new Error(
      `employee package path escapes source root: ${relativePath}`
    );
  const expected = statSync(canonical);
  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino
    )
      throw new Error(
        `employee package file changed while opening: ${relativePath}`
      );
    if (
      before.size > EMPLOYEE_PACKAGE_LIMITS.maxFileBytes ||
      before.size > maxBytes
    )
      throw new Error(
        `employee package file exceeds size limit: ${relativePath}`
      );
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      bytesRead += count;
      if (
        bytesRead > EMPLOYEE_PACKAGE_LIMITS.maxFileBytes ||
        bytesRead > maxBytes
      )
        throw new Error(
          `employee package file exceeds size limit: ${relativePath}`
        );
      chunks.push(chunk.subarray(0, count));
    }
    const content = Buffer.concat(chunks, bytesRead);
    const after = fstatSync(fd);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1 ||
      after.nlink !== before.nlink ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      content.length !== before.size
    )
      throw new Error(
        `employee package file changed while reading: ${relativePath}`
      );
    return content;
  } finally {
    closeSync(fd);
  }
}

// Build the gzipped tar for `slug`. Throws if the expert is unknown or has no local package dir.
export function buildEmployeePackage(
  cwd: string,
  slug: string
): EmployeePackage {
  const expert = findExpert(slug, join(cwd, "registry", "experts.json"));
  if (!expert) throw new Error(`unknown employee: ${slug}`);
  if (!expert.local_source)
    throw new Error(`employee ${slug} has no local package (coming soon)`);
  const root = resolveEmployeePackageRoot(cwd, slug, expert.local_source);
  const rootStat = statSync(root); // throws if missing
  if (!rootStat.isDirectory())
    throw new Error(`employee ${slug} local_source is not a directory`);

  const files = walkFiles(root, root);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (const rel of files) {
    const content = readPackageFile(
      root,
      rel,
      EMPLOYEE_PACKAGE_LIMITS.maxTotalBytes - totalBytes
    );
    totalBytes += content.length;
    if (containsForbiddenSecret(content))
      throw new Error(`employee package contains potential secret: ${rel}`);
    // Tar entry name is prefixed with the slug dir so untarring yields experts-style <slug>/…
    chunks.push(tarHeader(`${slug}/${rel}`, content.length));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  const tar = Buffer.concat(chunks);
  const gzip = gzipSync(tar);
  const sha256 = createHash("sha256").update(gzip).digest("hex");
  const version = String(expert.version ?? "0.0.0");
  return {
    filename: `${slug}-${version}.tar.gz`,
    version,
    gzip,
    sha256,
    files,
  };
}

const productionPackageCache = new Map<string, Promise<EmployeePackage>>();

function sameAsyncFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>
) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1 &&
    right.nlink === 1 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function readPrebuiltFile(
  packageRoot: string,
  fileName: string,
  maxBytes: number
): Promise<Buffer> {
  const path = resolve(packageRoot, fileName);
  if (!isInside(packageRoot, path))
    throw new Error("prebuilt employee package path escapes its root");
  const before = await lstat(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size <= 0 ||
    before.size > maxBytes
  ) {
    throw new Error(`unsafe prebuilt employee package file: ${fileName}`);
  }
  const canonical = await realpath(path);
  if (!pathsEqual(canonical, path) || !isInside(packageRoot, canonical))
    throw new Error(`unsafe prebuilt employee package path: ${fileName}`);

  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  );
  try {
    const opened = await handle.stat();
    if (!sameAsyncFileIdentity(before, opened))
      throw new Error(
        `prebuilt employee package changed before open: ${fileName}`
      );
    const data = await handle.readFile();
    const afterRead = await handle.stat();
    if (
      !sameAsyncFileIdentity(opened, afterRead) ||
      data.length !== afterRead.size
    ) {
      throw new Error(
        `prebuilt employee package changed while reading: ${fileName}`
      );
    }
    const after = await lstat(path);
    if (after.isSymbolicLink() || !sameAsyncFileIdentity(afterRead, after))
      throw new Error(`prebuilt employee package path changed: ${fileName}`);
    return data;
  } finally {
    await handle.close();
  }
}

function validatePrebuiltMetadata(
  slug: string,
  value: unknown
): EmployeePackageMetadata {
  const metadata = value as Partial<EmployeePackageMetadata>;
  const version = String(metadata?.version);
  if (
    metadata?.slug !== slug ||
    typeof metadata.filename !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    metadata.filename !== `${slug}-${version}.tar.gz` ||
    !/^[a-f0-9]{64}$/.test(String(metadata.sha256)) ||
    !Array.isArray(metadata.files) ||
    metadata.files.length > EMPLOYEE_PACKAGE_LIMITS.maxFiles ||
    metadata.files.some(
      file =>
        typeof file !== "string" ||
        !isSafePortablePackagePath(file) ||
        isForbiddenPath(file)
    ) ||
    new Set(metadata.files).size !== metadata.files.length ||
    new Set(metadata.files.map(portablePathComparisonKey)).size !==
      metadata.files.length
  ) {
    throw new Error(`invalid prebuilt employee package metadata: ${slug}`);
  }
  return metadata as EmployeePackageMetadata;
}

export async function loadPrebuiltEmployeePackage(
  cwd: string,
  slug: string
): Promise<EmployeePackage> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`invalid employee slug: ${slug}`);
  const workspace = await realpath(resolve(cwd));
  const requestedRoot = resolve(workspace, "dist", "employee-packages");
  const rootStat = await lstat(requestedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error("unsafe prebuilt employee package root");
  const packageRoot = await realpath(requestedRoot);
  if (
    !pathsEqual(packageRoot, requestedRoot) ||
    !isInside(workspace, packageRoot)
  ) {
    throw new Error("unsafe prebuilt employee package root");
  }
  const metadataBytes = await readPrebuiltFile(
    packageRoot,
    `${slug}.json`,
    256 * 1024
  );
  const metadata = validatePrebuiltMetadata(
    slug,
    JSON.parse(metadataBytes.toString("utf8"))
  );
  const gzip = await readPrebuiltFile(
    packageRoot,
    `${slug}.tar.gz`,
    EMPLOYEE_PACKAGE_LIMITS.maxTotalBytes + 4 * 1024 * 1024
  );
  if (gzip[0] !== 0x1f || gzip[1] !== 0x8b)
    throw new Error(`invalid prebuilt employee package gzip: ${slug}`);
  const actualSha256 = createHash("sha256").update(gzip).digest("hex");
  if (actualSha256 !== metadata.sha256)
    throw new Error(`prebuilt employee package checksum mismatch: ${slug}`);
  return {
    filename: metadata.filename,
    version: metadata.version,
    sha256: metadata.sha256,
    files: metadata.files,
    gzip,
  };
}

/** Production serves build-time artifacts through one per-slug async single-flight cache. */
export function getEmployeePackage(
  cwd: string,
  slug: string,
  { production = process.env.NODE_ENV === "production" } = {}
): EmployeePackage | Promise<EmployeePackage> {
  if (!production) return buildEmployeePackage(cwd, slug);
  const key = `${resolve(cwd)}\0${slug}`;
  let pending = productionPackageCache.get(key);
  if (!pending) {
    pending = loadPrebuiltEmployeePackage(cwd, slug).catch(error => {
      productionPackageCache.delete(key);
      throw error;
    });
    productionPackageCache.set(key, pending);
  }
  return pending;
}
