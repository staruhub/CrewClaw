import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const LIMITS = Object.freeze({
  maxEntries: 4_096,
  maxFiles: 1_024,
  maxDepth: 24,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
});

const FORBIDDEN_NAMES = new Set([
  ".omx",
  ".claude",
  ".crewclaw",
  ".direnv",
  ".git",
  ".sessions",
  ".ssh",
  ".npmrc",
  ".netrc",
  ".env",
  "auth.json",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "memory",
  "memories",
  "sessions",
  "logs",
  "workspace",
  "workspaces",
  "plan",
  "plans",
  "home",
  "local",
  "scratch",
]);

const WINDOWS_RESERVED =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fail(message) {
  throw new Error(`employee package rejected: ${message}`);
}

function isSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isForbiddenPath(path) {
  const parts = path.split("/").map(part => part.toLowerCase());
  return parts.some(part => {
    if (FORBIDDEN_NAMES.has(part)) return true;
    if (
      part === ".envrc" ||
      (part.startsWith(".env.") &&
        ![".env.example", ".env.sample", ".env.template"].includes(part))
    )
      return true;
    if (/^state\.db(?:-.+)?$/i.test(part)) return true;
    if (
      /^(?:credentials?|secrets?|tokens?|auth|service-account)(?:[._-].*)?\.(?:json|ya?ml|toml|ini|cfg|conf)$/i.test(
        part
      )
    )
      return true;
    return /\.(?:key|pem|p12|pfx)$/i.test(part);
  });
}

function validatePortablePath(name) {
  if (
    !name ||
    name.startsWith("/") ||
    /^[a-z]:\//i.test(name) ||
    name.includes("\\")
  ) {
    fail(`unsafe entry path: ${name || "(empty)"}`);
  }
  if (
    [...name].some(character => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    fail(`control character in entry path: ${name}`);
  const parts = name.split("/");
  if (parts.length > LIMITS.maxDepth + 1)
    fail(`entry path is too deep: ${name}`);
  for (const part of parts) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      part.endsWith(".") ||
      part.endsWith(" ") ||
      /[<>:"|?*]/.test(part) ||
      WINDOWS_RESERVED.test(part)
    ) {
      fail(`non-portable entry path: ${name}`);
    }
  }
  return parts;
}

function parseOctal(header, start, length, label) {
  const value = header
    .subarray(start, start + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();
  if (!value || !/^[0-7]+$/.test(value)) fail(`invalid ${label}`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid ${label}`);
  return parsed;
}

function tarName(header) {
  const bytes = header.subarray(0, 100);
  const end = bytes.indexOf(0);
  const raw = end < 0 ? bytes : bytes.subarray(0, end);
  const value = raw.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(raw))
    fail("entry name is not valid UTF-8");
  return value;
}

function validateHeaderChecksum(header) {
  const expected = parseOctal(header, 148, 8, "tar header checksum");
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) fail("tar header checksum mismatch");
}

function readArchive(path, expectedSha256) {
  const requested = resolve(path);
  const beforePath = lstatSync(requested);
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.nlink !== 1
  ) {
    fail("archive must be a single-link regular file");
  }
  if (beforePath.size <= 0 || beforePath.size > LIMITS.maxArchiveBytes)
    fail("archive size is outside limits");
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const fd = openSync(requested, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== beforePath.dev ||
      opened.ino !== beforePath.ino ||
      opened.size !== beforePath.size
    ) {
      fail("archive changed while opening");
    }
    const gzip = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size
    )
      fail("archive changed while reading");
    const sha256 = createHash("sha256").update(gzip).digest("hex");
    if (expectedSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(expectedSha256))
        fail("--sha256 must be 64 lowercase hexadecimal characters");
      if (sha256 !== expectedSha256)
        fail(
          `checksum mismatch (expected ${expectedSha256}, received ${sha256})`
        );
    }
    let tar;
    try {
      tar = gunzipSync(gzip, {
        maxOutputLength: LIMITS.maxTotalBytes + LIMITS.maxEntries * 1024,
      });
    } catch (error) {
      fail(
        `invalid or oversized gzip: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { tar, sha256 };
  } finally {
    closeSync(fd);
  }
}

function parseTar(tar) {
  const files = new Map();
  const pathKeys = new Set();
  let slug = null;
  let entries = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let offset = 0;
  let zeroBlocks = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks !== 0) fail("non-zero tar header after end marker");
    entries += 1;
    if (entries > LIMITS.maxEntries) fail("too many archive entries");
    validateHeaderChecksum(header);
    const magic = header.subarray(257, 263).toString("ascii");
    if (magic !== "ustar\0") fail("only canonical ustar packages are accepted");
    const type = header[156];
    if (![0, 48, 53].includes(type))
      fail("links and special tar entries are not accepted");
    const isDirectory = type === 53;
    let name = tarName(header);
    if (isDirectory && name.endsWith("/")) name = name.slice(0, -1);
    const parts = validatePortablePath(name);
    if (!isSlug(parts[0])) fail(`invalid top-level employee slug: ${parts[0]}`);
    slug ??= parts[0];
    if (parts[0] !== slug) fail("archive contains more than one employee root");
    if (parts.length === 1 && !isDirectory)
      fail("files must be nested under the employee root");
    const relativeName = parts.slice(1).join("/");
    if (relativeName && isForbiddenPath(relativeName))
      fail(`forbidden entry path: ${name}`);
    const comparisonKey = name.normalize("NFC").toLowerCase();
    if (pathKeys.has(comparisonKey))
      fail(`case-folding path collision: ${name}`);
    pathKeys.add(comparisonKey);

    const size = parseOctal(header, 124, 12, "entry size");
    if (isDirectory && size !== 0) fail(`directory entry has content: ${name}`);
    if (!isDirectory) {
      fileCount += 1;
      totalBytes += size;
      if (fileCount > LIMITS.maxFiles) fail("too many files");
      if (size > LIMITS.maxFileBytes) fail(`file exceeds size limit: ${name}`);
      if (totalBytes > LIMITS.maxTotalBytes)
        fail("expanded package exceeds size limit");
      if (offset + size > tar.length) fail(`truncated file entry: ${name}`);
      files.set(relativeName, Buffer.from(tar.subarray(offset, offset + size)));
    }
    offset += Math.ceil(size / 512) * 512;
    if (offset > tar.length) fail(`truncated padding for entry: ${name}`);
  }
  if (zeroBlocks < 2 || !slug)
    fail("tar end marker or employee root is missing");
  if ([...tar.subarray(offset)].some(byte => byte !== 0))
    fail("non-zero data follows tar end marker");
  for (const required of ["hire.yaml", "crewclaw.employee.yaml"]) {
    if (!files.has(required)) fail(`required manifest is missing: ${required}`);
  }
  return { slug, files };
}

function manifestMetadata(content) {
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content))
    fail("hire.yaml is not valid UTF-8");
  let section = "";
  const metadata = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const separator = trimmed.indexOf(":");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    value = value.replace(
      /^(?:"(.*)"|'(.*)')$/,
      (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? ""
    );
    if (indent === 0) {
      section = key;
      if (key === "apiVersion") metadata.apiVersion = value;
      if (key === "kind") metadata.kind = value;
    } else if (
      indent === 2 &&
      section === "metadata" &&
      ["id", "name", "version"].includes(key)
    ) {
      metadata[key] = value;
    }
  }
  if (
    metadata.apiVersion !== "crewclaw/v1" ||
    metadata.kind !== "Employee" ||
    !isSlug(metadata.id) ||
    !metadata.name ||
    !metadata.version
  ) {
    fail("hire.yaml identity contract is incomplete or invalid");
  }
  return metadata;
}

function readRegistry(root, slug, metadata) {
  const registryPath = join(root, "registry", "experts.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const expert = Array.isArray(registry.experts)
    ? registry.experts.find(item => item?.name === slug)
    : null;
  if (
    !expert ||
    expert.status !== "available" ||
    expert.local_source !== `experts/${slug}`
  )
    fail(`employee is not an available registry entry: ${slug}`);
  if (metadata.id !== slug)
    fail(`manifest id ${metadata.id} does not match archive root ${slug}`);
  if (String(expert.version ?? "") !== metadata.version)
    fail(
      `manifest version ${metadata.version} does not match registry version ${expert.version ?? "missing"}`
    );
}

function collectExisting(root, directory = root, files = new Map()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      fail(`existing employee source contains a link: ${path}`);
    if (stat.isDirectory()) collectExisting(root, path, files);
    else if (stat.isFile() && stat.nlink === 1)
      files.set(relative(root, path).split(sep).join("/"), readFileSync(path));
    else
      fail(`existing employee source contains an unsupported entry: ${path}`);
  }
  return files;
}

function sameFiles(left, right) {
  if (left.size !== right.size) return false;
  for (const [name, content] of left) {
    const other = right.get(name);
    if (!other || !content.equals(other)) return false;
  }
  return true;
}

function installFiles(root, slug, files) {
  const expertsRoot = join(root, "experts");
  mkdirSync(expertsRoot, { recursive: true });
  const expertsStat = lstatSync(expertsRoot);
  if (expertsStat.isSymbolicLink() || !expertsStat.isDirectory())
    fail("experts root is not a real directory");
  const destination = join(expertsRoot, slug);
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail(`existing source is unsafe: experts/${slug}`);
    if (!sameFiles(collectExisting(destination), files)) {
      fail(
        `experts/${slug} already exists with different content; refusing to overwrite it`
      );
    }
    return false;
  }

  const stagingRoot = join(root, ".crewclaw", "package-imports");
  mkdirSync(stagingRoot, { recursive: true });
  const temp = mkdtempSync(join(stagingRoot, "import-"));
  const stagedEmployee = join(temp, slug);
  try {
    mkdirSync(stagedEmployee, { recursive: false, mode: 0o700 });
    for (const [name, content] of files) {
      const path = join(stagedEmployee, ...name.split("/"));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
    }
    renameSync(stagedEmployee, destination);
    return true;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  const [rootArg, archiveArg, expectedArg] = process.argv.slice(2);
  if (!rootArg || !archiveArg)
    fail("usage: import-employee-package.mjs <root> <archive> [sha256]");
  const root = realpathSync(resolve(rootArg));
  const expectedSha256 =
    expectedArg && expectedArg !== "-" ? expectedArg : undefined;
  const { tar, sha256 } = readArchive(
    isAbsolute(archiveArg) ? archiveArg : resolve(root, archiveArg),
    expectedSha256
  );
  const parsed = parseTar(tar);
  const metadata = manifestMetadata(parsed.files.get("hire.yaml"));
  readRegistry(root, parsed.slug, metadata);
  const installed = installFiles(root, parsed.slug, parsed.files);
  process.stdout.write(
    `${JSON.stringify({ slug: parsed.slug, version: metadata.version, sha256, installed })}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
