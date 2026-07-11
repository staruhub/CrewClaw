import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSkills, loadProfileSources } from "../profile-skills.mjs";

function tempProfile(prefix) {
  const profile = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(profile, "skills"), { recursive: true });
  return profile;
}

async function loadsSkillsInDeterministicOrder() {
  const profile = tempProfile("crew-profile-skills-");
  try {
    mkdirSync(join(profile, "skills", "z-last"));
    mkdirSync(join(profile, "skills", "a-first"));
    writeFileSync(join(profile, "skills", "z-last", "SKILL.md"), "z skill");
    writeFileSync(join(profile, "skills", "a-first", "SKILL.md"), "a skill");
    assert.deepEqual(await collectSkills(profile), ["a skill", "z skill"]);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

async function rejectsDirectoryLinks() {
  const profile = tempProfile("crew-profile-link-");
  const outside = mkdtempSync(join(tmpdir(), "crew-profile-outside-"));
  try {
    writeFileSync(join(outside, "SKILL.md"), "outside secret");
    symlinkSync(
      outside,
      join(profile, "skills", "escaped"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await assert.rejects(
      collectSkills(profile),
      /symbolic links and junctions are not allowed/
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

async function rejectsHardLinkedSkillFiles() {
  const profile = tempProfile("crew-profile-hardlink-");
  const outside = mkdtempSync(join(tmpdir(), "crew-profile-hardlink-source-"));
  try {
    const source = join(outside, "source.md");
    const skillDir = join(profile, "skills", "linked");
    mkdirSync(skillDir);
    writeFileSync(source, "hard-linked secret");
    linkSync(source, join(skillDir, "SKILL.md"));
    await assert.rejects(collectSkills(profile), /single-link regular file/);
  } finally {
    rmSync(profile, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

async function safelyLoadsAllProfileInputs() {
  const install = mkdtempSync(join(tmpdir(), "crew-profile-install-"));
  try {
    const profile = join(install, "experts", "safe-profile");
    mkdirSync(join(profile, "skills", "write"), { recursive: true });
    writeFileSync(join(profile, "SOUL.md"), "# Safe soul\n");
    writeFileSync(join(profile, "config.yaml"), "temperature: 0.2\n");
    writeFileSync(join(profile, "hire.yaml"), "metadata:\n  name: Safe\n");
    writeFileSync(join(profile, "avatar.txt"), "<o>\n");
    writeFileSync(join(profile, "skills", "write", "SKILL.md"), "# Write\n");

    const loaded = await loadProfileSources(install, "safe-profile");
    assert.equal(loaded.soul.text, "# Safe soul\n");
    assert.equal(loaded.config.text, "temperature: 0.2\n");
    assert.equal(loaded.hire.text, "metadata:\n  name: Safe\n");
    assert.equal(loaded.avatar.text, "<o>\n");
    assert.deepEqual(
      loaded.skillFiles.map(file => file.relativePath),
      ["skills/write/SKILL.md"]
    );
  } finally {
    rmSync(install, { recursive: true, force: true });
  }
}

async function rejectsLinkedProfileRootAndSoul() {
  const install = mkdtempSync(join(tmpdir(), "crew-profile-root-link-"));
  const outside = mkdtempSync(join(tmpdir(), "crew-profile-root-outside-"));
  try {
    mkdirSync(join(install, "experts"), { recursive: true });
    writeFileSync(join(outside, "SOUL.md"), "outside soul");
    symlinkSync(
      outside,
      join(install, "experts", "linked-root"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await assert.rejects(
      loadProfileSources(install, "linked-root"),
      /symbolic links are not allowed/
    );

    // Windows requires an elevated token for file symlinks; the profile-root junction above
    // exercises the same canonical containment rule there. POSIX can additionally cover the
    // final-file O_NOFOLLOW branch directly.
    if (process.platform !== "win32") {
      const profile = join(install, "experts", "linked-soul");
      mkdirSync(profile);
      symlinkSync(join(outside, "SOUL.md"), join(profile, "SOUL.md"), "file");
      await assert.rejects(
        loadProfileSources(install, "linked-soul"),
        /symbolic links are not allowed/
      );
    }
  } finally {
    rmSync(install, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

async function rejectsHardLinkedProfileFiles() {
  for (const fileName of [
    "SOUL.md",
    "config.yaml",
    "hire.yaml",
    "avatar.txt",
  ]) {
    const install = mkdtempSync(join(tmpdir(), "crew-profile-file-link-"));
    const outside = mkdtempSync(join(tmpdir(), "crew-profile-file-outside-"));
    try {
      const profile = join(install, "experts", "hard-profile");
      mkdirSync(profile, { recursive: true });
      if (fileName !== "SOUL.md") {
        writeFileSync(join(profile, "SOUL.md"), "regular soul");
      }
      const source = join(outside, fileName);
      writeFileSync(source, "hard-linked profile input");
      linkSync(source, join(profile, fileName));
      await assert.rejects(
        loadProfileSources(install, "hard-profile"),
        new RegExp(`${fileName.replace(".", "\\.")} must be a single-link`),
        `${fileName} hardlink must be rejected`
      );
    } finally {
      rmSync(install, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
}

await loadsSkillsInDeterministicOrder();
await rejectsDirectoryLinks();
await rejectsHardLinkedSkillFiles();
await safelyLoadsAllProfileInputs();
await rejectsLinkedProfileRootAndSoul();
await rejectsHardLinkedProfileFiles();
console.log("profile-skills.test.mjs passed");
