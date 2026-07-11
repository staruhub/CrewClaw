import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const ExpertStatusSchema = z.enum(["available", "coming-soon"]);

export const ExpertSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    display_name: z.string().min(1),
    status: ExpertStatusSchema,
    certification: z.enum(["C0", "C1", "C2", "C3"]),
    category: z.string().min(1),
    description: z.string().min(1),
    repo: z.string().nullable(),
    local_source: z.string().nullable(),
    version: z.string().nullable(),
    pricing: z.string().min(1),
    tags: z.array(z.string()),
    requires: z.object({
      hermes: z.string().min(1),
      env: z.array(z.string()),
    }),
    install_command: z.string().nullable(),
    local_install_command: z.string().nullable(),
    first_task: z.string().min(1),
  })
  .superRefine((expert, context) => {
    const expected = `experts/${expert.name}`;
    if (expert.status === "available" && expert.local_source !== expected) {
      context.addIssue({
        code: "custom",
        path: ["local_source"],
        message: `available expert local_source must equal ${expected}`,
      });
    }
    if (expert.status === "coming-soon" && expert.local_source !== null) {
      context.addIssue({
        code: "custom",
        path: ["local_source"],
        message: "coming-soon expert local_source must be null",
      });
    }
  });

export const RegistrySchema = z.object({
  version: z.string().min(1),
  updated_at: z.string().min(1),
  experts: z.array(ExpertSchema),
});

export type Expert = z.infer<typeof ExpertSchema>;
export type ExpertRegistry = z.infer<typeof RegistrySchema>;
export type ExpertStatus = z.infer<typeof ExpertStatusSchema>;

export function registryPath(cwd = process.cwd()) {
  return resolve(cwd, "registry", "experts.json");
}

export function loadRegistry(path = registryPath()): ExpertRegistry {
  const raw = readFileSync(path, "utf8");
  return RegistrySchema.parse(JSON.parse(raw));
}

function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertLinkFreeTree(source: string): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const entryPath = resolve(source, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Expert source must not contain links: ${entryPath}`);
    }

    const canonicalEntry = realpathSync(entryPath);
    if (
      !pathIsWithin(source, canonicalEntry) ||
      !pathsEqual(canonicalEntry, entryPath)
    ) {
      throw new Error(`Expert source escapes its package root: ${entryPath}`);
    }
    if (stat.isDirectory()) {
      assertLinkFreeTree(canonicalEntry);
    } else if (!stat.isFile()) {
      throw new Error(
        `Expert source contains an unsupported file: ${entryPath}`
      );
    } else if (stat.nlink !== 1) {
      throw new Error(`Expert source must not contain hardlinks: ${entryPath}`);
    }
  }
}

/**
 * Resolve an available expert package from its schema-bound local_source. The returned path is
 * canonical and every package entry has been checked to reject symlinks and Windows junctions.
 */
export function resolveExpertSource(root: string, expert: Expert): string {
  const parsed = ExpertSchema.parse(expert);
  if (parsed.status !== "available" || parsed.local_source === null) {
    throw new Error(`${parsed.name} has no available local source`);
  }

  const canonicalRoot = realpathSync(root);
  const expectedRelative = `experts/${parsed.name}`;
  if (parsed.local_source !== expectedRelative) {
    throw new Error(
      `${parsed.name} local_source must equal ${expectedRelative}`
    );
  }

  let current = root;
  for (const component of ["experts", parsed.name]) {
    current = resolve(current, component);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Expert source must not use links: ${current}`);
    }
  }

  const canonicalSource = realpathSync(resolve(root, expectedRelative));
  const canonicalExpected = resolve(canonicalRoot, "experts", parsed.name);
  if (
    !pathIsWithin(canonicalRoot, canonicalSource) ||
    !pathsEqual(canonicalSource, canonicalExpected)
  ) {
    throw new Error(
      `Expert source escapes the repository root: ${canonicalSource}`
    );
  }
  if (!lstatSync(canonicalSource).isDirectory()) {
    throw new Error(`Expert source is not a directory: ${canonicalSource}`);
  }

  assertLinkFreeTree(canonicalSource);
  return canonicalSource;
}

export function resolveExpertSourceFile(
  root: string,
  expert: Expert,
  fileName: string
): string {
  if (basename(fileName) !== fileName || isAbsolute(fileName)) {
    throw new Error(`Expert package filename must be a basename: ${fileName}`);
  }
  const source = resolveExpertSource(root, expert);
  const requested = resolve(source, fileName);
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw new Error(
      `Expert package file must be a regular single-link file: ${requested}`
    );
  }
  const canonicalFile = realpathSync(requested);
  if (
    !pathIsWithin(source, canonicalFile) ||
    !pathsEqual(canonicalFile, requested)
  ) {
    throw new Error(`Expert package file escapes its source: ${requested}`);
  }
  return canonicalFile;
}

export function getExperts(path?: string): Expert[] {
  return loadRegistry(path).experts;
}

export function getAvailableExperts(path?: string): Expert[] {
  return getExperts(path).filter(expert => expert.status === "available");
}

export function findExpert(name: string, path?: string): Expert | undefined {
  return getExperts(path).find(expert => expert.name === name);
}
