import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { resolvePathInsideRoot } from "./tool-gateway.mjs";

const MAX_SKILL_FILES = 128;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_SKILL_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_DEPTH = 16;
const SAFE_AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PROFILE_FILE_LIMITS = Object.freeze({
  "SOUL.md": 1024 * 1024,
  "config.yaml": 512 * 1024,
  "hire.yaml": 512 * 1024,
  "avatar.txt": 128 * 1024,
  "crewclaw.employee.yaml": 1024 * 1024,
  "mcp.json": 512 * 1024,
});

function unsafeProfile(reason, path) {
  const error = new Error(`unsafe employee profile: ${reason} (${path})`);
  error.code = "unsafe_employee_profile";
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
  if (!checked.ok) throw unsafeProfile(checked.error, rawPath);
  return checked;
}

async function checkedDirectory(rawPath, root, label) {
  const checked = checkedPath(rawPath, root);
  const stat = await lstat(checked.path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafeProfile(`${label} must be a real directory`, checked.path);
  }
  return { path: checked.path, stat };
}

async function readRegularFile(
  root,
  rawPath,
  { label, maxBytes, required = true, allowEmpty = true }
) {
  let checked = checkedPath(rawPath, root, { mustExist: false });
  if (!checked.exists) {
    if (!required) return null;
    throw unsafeProfile(`${label} is required`, rawPath);
  }

  let path = checked.path;
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw unsafeProfile(`${label} must be a single-link regular file`, path);
  }
  if (
    before.size > maxBytes ||
    before.size < 0 ||
    (!allowEmpty && before.size === 0)
  ) {
    const minimum = allowEmpty ? 0 : 1;
    throw unsafeProfile(
      `${label} size must be within ${minimum}..${maxBytes} bytes`,
      path
    );
  }

  const noFollow = constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw unsafeProfile(
      `${label} could not be opened safely: ${error?.message || error}`,
      path
    );
  }

  let data;
  let afterRead;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameIdentity(before, opened)
    ) {
      throw unsafeProfile(`${label} changed before it was opened`, path);
    }
    data = await handle.readFile();
    afterRead = await handle.stat();
    if (!sameIdentity(opened, afterRead)) {
      throw unsafeProfile(`${label} changed while it was read`, path);
    }
    if (data.length !== afterRead.size || data.length > maxBytes) {
      throw unsafeProfile(`${label} exceeded its size limit while read`, path);
    }
  } finally {
    await handle.close();
  }

  checked = checkedPath(path, root);
  path = checked.path;
  const after = await lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    !sameIdentity(afterRead, after)
  ) {
    throw unsafeProfile(`${label} path changed while it was read`, path);
  }
  return {
    path,
    relativePath: relative(root, path).replaceAll("\\", "/"),
    data,
    text: data.toString("utf8"),
    bytes: data.length,
  };
}

/**
 * Read one behavior-bearing file from an already selected profile. File names are closed so a
 * caller cannot turn this helper into an arbitrary install-root reader.
 */
export async function readProfileFile(
  profileDir,
  fileName,
  { required = false, profilesRoot = dirname(resolve(profileDir)) } = {}
) {
  const maxBytes = PROFILE_FILE_LIMITS[fileName];
  if (!maxBytes) {
    throw unsafeProfile(
      `unsupported profile file ${String(fileName)}`,
      profileDir
    );
  }
  const profile = await checkedDirectory(
    profileDir,
    profilesRoot,
    "profile root"
  );
  return readRegularFile(profile.path, join(profile.path, fileName), {
    label: fileName,
    maxBytes,
    required,
    allowEmpty: fileName !== "SOUL.md",
  });
}

/**
 * Locate and load a profile under the immutable agents/ or experts/ collections. All files are
 * opened through no-follow descriptors before YAML parsing or prompt construction.
 */
export async function loadProfileSources(installRoot, agentId) {
  if (typeof agentId !== "string" || !SAFE_AGENT_ID.test(agentId)) {
    throw unsafeProfile(`invalid employee id ${String(agentId)}`, installRoot);
  }
  const install = await checkedDirectory(
    installRoot,
    installRoot,
    "install root"
  );

  for (const collectionName of ["agents", "experts"]) {
    const rawCollection = join(install.path, collectionName);
    const maybeCollection = checkedPath(rawCollection, install.path, {
      mustExist: false,
    });
    if (!maybeCollection.exists) continue;
    const collection = await checkedDirectory(
      rawCollection,
      install.path,
      `${collectionName} collection`
    );
    const candidate = checkedPath(
      join(collection.path, agentId),
      collection.path,
      {
        mustExist: false,
      }
    );
    if (!candidate.exists) continue;
    const profile = await checkedDirectory(
      candidate.path,
      collection.path,
      "profile root"
    );
    const soul = await readProfileFile(profile.path, "SOUL.md", {
      required: false,
      profilesRoot: collection.path,
    });
    if (!soul) continue;
    const [config, hire, avatar, employeeSpec, mcp, skillFiles] =
      await Promise.all([
        readProfileFile(profile.path, "config.yaml", {
          profilesRoot: collection.path,
        }),
        readProfileFile(profile.path, "hire.yaml", {
          profilesRoot: collection.path,
        }),
        readProfileFile(profile.path, "avatar.txt", {
          profilesRoot: collection.path,
        }),
        readProfileFile(profile.path, "crewclaw.employee.yaml", {
          profilesRoot: collection.path,
        }),
        readProfileFile(profile.path, "mcp.json", {
          profilesRoot: collection.path,
        }),
        collectSkillFiles(profile.path, { profilesRoot: collection.path }),
      ]);
    return {
      profileDir: profile.path,
      collectionRoot: collection.path,
      soul,
      config,
      hire,
      avatar,
      employeeSpec,
      mcp,
      skillFiles,
    };
  }
  return null;
}

/**
 * Load immutable employee skills without allowing a package entry to escape its profile. Every
 * directory is containment-checked and links are rejected; SKILL.md is read through a no-follow
 * descriptor whose identity is checked before and after the read.
 */
export async function collectSkillFiles(
  profileDir,
  { profilesRoot = dirname(resolve(profileDir)) } = {}
) {
  const profile = await checkedDirectory(
    profileDir,
    profilesRoot,
    "profile root"
  );
  const skillsPath = join(profile.path, "skills");
  const maybeSkills = checkedPath(skillsPath, profile.path, {
    mustExist: false,
  });
  if (!maybeSkills.exists) return [];
  const skillsRoot = await checkedDirectory(
    skillsPath,
    profile.path,
    "skills root"
  );
  const found = [];
  let totalBytes = 0;

  async function walk(rawDirectory, depth) {
    if (depth > MAX_SKILL_DEPTH) {
      throw unsafeProfile(
        `skill directory depth exceeds ${MAX_SKILL_DEPTH}`,
        rawDirectory
      );
    }
    const directory = await checkedDirectory(
      rawDirectory,
      skillsRoot.path,
      "skill path"
    );
    const entries = (
      await readdir(directory.path, { withFileTypes: true })
    ).sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const full = join(directory.path, entry.name);
      if (entry.isSymbolicLink()) {
        throw unsafeProfile(
          "symbolic links and junctions are not allowed",
          full
        );
      }
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.name === "SKILL.md") {
        if (found.length >= MAX_SKILL_FILES) {
          throw unsafeProfile(
            `skill file count exceeds ${MAX_SKILL_FILES}`,
            skillsRoot.path
          );
        }
        const skill = await readRegularFile(skillsRoot.path, full, {
          label: "SKILL.md",
          maxBytes: MAX_SKILL_FILE_BYTES,
          allowEmpty: false,
        });
        totalBytes += skill.bytes;
        if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
          throw unsafeProfile(
            `total skill bytes exceed ${MAX_SKILL_TOTAL_BYTES}`,
            skillsRoot.path
          );
        }
        found.push({
          ...skill,
          relativePath: relative(profile.path, skill.path).replaceAll(
            "\\",
            "/"
          ),
        });
      }
    }
  }

  await walk(skillsRoot.path, 0);
  return found;
}

export async function collectSkills(profileDir, options) {
  return (await collectSkillFiles(profileDir, options)).map(
    skill => skill.text
  );
}
