import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve } from "node:path";

import { resolvePathInsideRoot } from "./tool-gateway.mjs";
import yaml from "./yaml.mjs";

export const EVAL_SUBJECT_CONTRACT_VERSION = "crewclaw.eval-subject/v2";

const SAFE_AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROFILE_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_SKILL_FILES = 128;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_FILES = 512;
const MAX_WALK_DEPTH = 32;

function unsafeSubject(reason, path) {
  const error = new Error(`unsafe eval subject: ${reason} (${path})`);
  error.code = "unsafe_eval_subject";
  error.path = path;
  return error;
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function checkedPath(rawPath, root, { mustExist = true } = {}) {
  const checked = resolvePathInsideRoot(rawPath, root, {
    mustExist,
    rejectSymlinks: true,
  });
  if (!checked.ok) throw unsafeSubject(checked.error, rawPath);
  return checked;
}

function checkedDirectory(rawPath, root, label) {
  const checked = checkedPath(rawPath, root);
  const stat = lstatSync(checked.path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafeSubject(`${label} must be a real directory`, checked.path);
  }
  return checked.path;
}

function readSubjectFile(
  root,
  rawPath,
  { label, maxBytes, required = true, allowEmpty = true }
) {
  let checked = checkedPath(rawPath, root, { mustExist: false });
  if (!checked.exists) {
    if (!required) return null;
    throw unsafeSubject(`${label} is required`, rawPath);
  }
  let path = checked.path;
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw unsafeSubject(`${label} must be a single-link regular file`, path);
  }
  if (
    before.size > maxBytes ||
    before.size < 0 ||
    (!allowEmpty && before.size === 0)
  ) {
    throw unsafeSubject(`${label} has an invalid size`, path);
  }

  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
    );
  } catch (error) {
    throw unsafeSubject(
      `${label} could not be opened safely: ${error?.message || error}`,
      path
    );
  }
  let data;
  let afterRead;
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameIdentity(before, opened)
    ) {
      throw unsafeSubject(`${label} changed before it was opened`, path);
    }
    data = readFileSync(descriptor);
    afterRead = fstatSync(descriptor);
    if (!sameIdentity(opened, afterRead)) {
      throw unsafeSubject(`${label} changed while it was read`, path);
    }
    if (data.length !== afterRead.size || data.length > maxBytes) {
      throw unsafeSubject(`${label} exceeded its size limit while read`, path);
    }
  } finally {
    closeSync(descriptor);
  }

  checked = checkedPath(path, root);
  path = checked.path;
  const after = lstatSync(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    !sameIdentity(afterRead, after)
  ) {
    throw unsafeSubject(`${label} path changed while it was read`, path);
  }
  return { path, data };
}

function listFiles(
  rawDirectory,
  root,
  { include, skipDirectory = () => false, label, depth = 0 } = {}
) {
  if (depth > MAX_WALK_DEPTH) {
    throw unsafeSubject(
      `${label} tree exceeds depth ${MAX_WALK_DEPTH}`,
      rawDirectory
    );
  }
  const directory = checkedDirectory(rawDirectory, root, label);
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name, "en")
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw unsafeSubject("symbolic links and junctions are not allowed", path);
    }
    if (entry.isDirectory()) {
      if (!skipDirectory(entry.name)) {
        files.push(
          ...listFiles(path, root, {
            include,
            skipDirectory,
            label,
            depth: depth + 1,
          })
        );
      }
    } else if (include(path, entry.name)) {
      files.push(path);
    }
    if (files.length > MAX_SOURCE_FILES) {
      throw unsafeSubject(`${label} tree has too many files`, directory);
    }
  }
  return files;
}

function findBehaviorProfile(repoRoot, slug) {
  for (const collectionName of ["agents", "experts"]) {
    const rawCollection = join(repoRoot, collectionName);
    const collectionEntry = checkedPath(rawCollection, repoRoot, {
      mustExist: false,
    });
    if (!collectionEntry.exists) continue;
    const collection = checkedDirectory(
      rawCollection,
      repoRoot,
      `${collectionName} collection`
    );
    const rawProfile = join(collection, slug);
    const profileEntry = checkedPath(rawProfile, collection, {
      mustExist: false,
    });
    if (!profileEntry.exists) continue;
    const profile = checkedDirectory(rawProfile, collection, "profile root");
    const soul = readSubjectFile(profile, join(profile, "SOUL.md"), {
      label: "SOUL.md",
      maxBytes: MAX_PROFILE_FILE_BYTES,
      required: false,
      allowEmpty: false,
    });
    if (soul) return { profile, soul };
  }
  throw new Error(
    `no runnable profile for "${slug}" (no SOUL.md in agents/ or experts/)`
  );
}

function profileEntries(repoRoot, slug) {
  const { profile, soul } = findBehaviorProfile(repoRoot, slug);
  const entries = [{ name: "profile/SOUL.md", data: soul.data }];
  let profileModel = null;
  for (const fileName of ["config.yaml", "hire.yaml"]) {
    const file = readSubjectFile(profile, join(profile, fileName), {
      label: fileName,
      maxBytes: MAX_PROFILE_FILE_BYTES,
      required: false,
    });
    entries.push({
      name: `profile/${fileName}`,
      data: file?.data ?? null,
    });
    if (fileName === "config.yaml" && file) {
      let config;
      try {
        config = yaml.load(file.data.toString("utf8")) || {};
      } catch (error) {
        throw unsafeSubject(
          `config.yaml could not be parsed: ${error?.message || error}`,
          file.path
        );
      }
      if (typeof config?.model === "string") profileModel = config.model;
    }
  }

  const rawSkills = join(profile, "skills");
  const skillsEntry = checkedPath(rawSkills, profile, { mustExist: false });
  if (skillsEntry.exists) {
    const skillsRoot = checkedDirectory(rawSkills, profile, "skills root");
    const skillPaths = listFiles(skillsRoot, skillsRoot, {
      include: (_path, name) => name === "SKILL.md",
      label: "skills",
    });
    if (skillPaths.length > MAX_SKILL_FILES) {
      throw unsafeSubject("skill tree has too many SKILL.md files", skillsRoot);
    }
    for (const path of skillPaths) {
      const skill = readSubjectFile(skillsRoot, path, {
        label: "SKILL.md",
        maxBytes: MAX_SKILL_FILE_BYTES,
        allowEmpty: false,
      });
      entries.push({
        name: `profile/skills/${relative(skillsRoot, path).replaceAll("\\", "/")}`,
        data: skill.data,
      });
    }
  }
  return { entries, profileModel };
}

function implementationEntries(repoRoot) {
  const entries = [];
  const runtimeRoot = checkedDirectory(
    join(repoRoot, "packages", "runtime"),
    repoRoot,
    "runtime source root"
  );
  const runtimePaths = listFiles(runtimeRoot, runtimeRoot, {
    include: path => extname(path) === ".mjs",
    skipDirectory: name => name === "__tests__",
    label: "runtime source",
  });
  if (!runtimePaths.some(path => relative(runtimeRoot, path) === "run.mjs")) {
    throw unsafeSubject("runtime source is missing run.mjs", runtimeRoot);
  }
  if (
    !runtimePaths.some(
      path => relative(runtimeRoot, path) === "eval-runner.mjs"
    )
  ) {
    throw unsafeSubject(
      "runtime source is missing eval-runner.mjs",
      runtimeRoot
    );
  }
  for (const path of runtimePaths) {
    const source = readSubjectFile(runtimeRoot, path, {
      label: "runtime source",
      maxBytes: MAX_SOURCE_FILE_BYTES,
      allowEmpty: false,
    });
    entries.push({
      name: `runtime/${relative(runtimeRoot, path).replaceAll("\\", "/")}`,
      data: source.data,
    });
  }

  const contractsRoot = checkedDirectory(
    join(repoRoot, "contracts"),
    repoRoot,
    "contract source root"
  );
  const contractPaths = listFiles(contractsRoot, contractsRoot, {
    include: path => [".ts", ".json"].includes(extname(path)),
    skipDirectory: name => name === "__tests__" || name === "scripts",
    label: "contract source",
  });
  for (const requiredContract of [
    "employee-spec.ts",
    "schema/employee.spec.schema.json",
  ]) {
    if (
      !contractPaths.some(
        path =>
          relative(contractsRoot, path).replaceAll("\\", "/") ===
          requiredContract
      )
    ) {
      throw unsafeSubject(
        `contract source is missing ${requiredContract}`,
        contractsRoot
      );
    }
  }
  for (const path of contractPaths) {
    const source = readSubjectFile(contractsRoot, path, {
      label: "contract source",
      maxBytes: MAX_SOURCE_FILE_BYTES,
      allowEmpty: false,
    });
    entries.push({
      name: `contracts/${relative(contractsRoot, path).replaceAll("\\", "/")}`,
      data: source.data,
    });
  }
  return entries;
}

function dependencyEntries(repoRoot) {
  return ["package.json", "pnpm-lock.yaml"].map(fileName => {
    const file = readSubjectFile(repoRoot, join(repoRoot, fileName), {
      label: fileName,
      maxBytes: MAX_SOURCE_FILE_BYTES,
      allowEmpty: false,
    });
    return { name: `dependencies/${fileName}`, data: file.data };
  });
}

function currentRuntimeIdentity() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    node_abi: String(process.versions.modules ?? "unknown"),
  };
}

function runtimeIdentityEntries(identity) {
  return Object.entries(identity).map(([name, value]) => ({
    name: `runtime-identity/${name}`,
    data: Buffer.from(value, "utf8"),
  }));
}

function addHashEntry(hash, name, data) {
  const nameBytes = Buffer.from(name, "utf8");
  if (data === null) {
    hash.update(`absent:${nameBytes.length}:`);
    hash.update(nameBytes);
    hash.update(";");
    return;
  }
  hash.update(`file:${nameBytes.length}:`);
  hash.update(nameBytes);
  hash.update(`:${data.length}:`);
  hash.update(data);
  hash.update(";");
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) addHashEntry(hash, entry.name, entry.data);
  return hash.digest("hex");
}

/**
 * Snapshot everything that can change an eval's subject or interpretation. The hash binds the
 * profile prompt/config/manifest, employee spec, all skills, production runtime/evaluator source,
 * committed contracts, dependency manifests, and the Node/platform identity that executes them.
 * Every file byte is read through a no-follow, identity-checked descriptor.
 */
export function snapshotEvalSubject(root, slug) {
  if (typeof slug !== "string" || !SAFE_AGENT_ID.test(slug)) {
    throw new Error(`invalid employee slug: ${String(slug)}`);
  }
  const repoRoot = checkedDirectory(
    resolve(root),
    resolve(root),
    "repository root"
  );
  const specProfile = checkedDirectory(
    join(repoRoot, "experts", slug),
    checkedDirectory(join(repoRoot, "experts"), repoRoot, "experts collection"),
    "employee spec profile"
  );
  const spec = readSubjectFile(
    specProfile,
    join(specProfile, "crewclaw.employee.yaml"),
    {
      label: "crewclaw.employee.yaml",
      maxBytes: MAX_PROFILE_FILE_BYTES,
      allowEmpty: false,
    }
  );
  const behaviorProfile = profileEntries(repoRoot, slug);
  const dependencies = dependencyEntries(repoRoot);
  const runtimeIdentity = currentRuntimeIdentity();
  const entries = [
    {
      name: "contract/version",
      data: Buffer.from(EVAL_SUBJECT_CONTRACT_VERSION),
    },
    { name: "profile/crewclaw.employee.yaml", data: spec.data },
    ...behaviorProfile.entries,
    ...implementationEntries(repoRoot),
    ...dependencies,
    ...runtimeIdentityEntries(runtimeIdentity),
  ];
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return {
    contractVersion: EVAL_SUBJECT_CONTRACT_VERSION,
    subjectHash: hashEntries(entries),
    dependencyHash: hashEntries(dependencies),
    runtimeIdentity,
    profileModel: behaviorProfile.profileModel,
    specSource: spec.data.toString("utf8"),
    inputNames: entries.map(entry => entry.name),
  };
}
