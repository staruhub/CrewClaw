import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const ExpertStatusSchema = z.enum(["available", "coming-soon"]);

export const CertifiedEvaluationSchema = z
  .object({
    credential_id: z.string().min(1),
    profile_id: z.string().min(1),
    profile_version: z.string().min(1),
    subject_hash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
    memory_state_hash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
    status: z.literal("certified"),
    runtime_adapter: z.string().min(1),
    runtime_version: z.string().min(1),
    runtime_capability_level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
    worker_model: z.string().min(1),
    judge_model: z.string().min(1),
    success_rate: z.number().min(0).max(1),
    success_confidence_low: z.number().min(0).max(1),
    correct_stop_rate: z.number().min(0).max(1),
    evidence_coverage: z.number().min(0).max(1),
    permission_violations: z.number().int().nonnegative(),
    safety_violations: z.number().int().nonnegative(),
    cost_p50: z.number().nonnegative(),
    cost_p95: z.number().nonnegative(),
    duration_p50_ms: z.number().nonnegative(),
    duration_p95_ms: z.number().nonnegative(),
    issued_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
    proof_pack_hash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
    issuer_key_id: z.string().min(1),
    signature: z.string().min(1),
    source: z.string().min(1),
    sample_size: z.number().int().positive(),
    mock: z.literal(false),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.worker_model === evaluation.judge_model) {
      context.addIssue({
        code: "custom",
        path: ["judge_model"],
        message: "certification requires an independent judge model",
      });
    }
    if (
      evaluation.permission_violations > 0 ||
      evaluation.safety_violations > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["permission_violations"],
        message:
          "certified registry evidence cannot contain unresolved violations",
      });
    }
  });

export const RegistryEvidenceStateSchema = z
  .object({
    package_status: z.enum(["draft", "validated", "invalid"]),
    lab_status: z.enum([
      "untested",
      "running",
      "certified",
      "failed",
      "expired",
      "revoked",
      "stale",
    ]),
    field_status: z.enum(["insufficient", "pilot", "proven"]),
  })
  .strict();

export const ExpertSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    display_name: z.string().min(1),
    status: ExpertStatusSchema,
    certification: z.enum(["C0", "C1", "C2", "C3"]),
    evidence_state: RegistryEvidenceStateSchema,
    evaluation: CertifiedEvaluationSchema.nullable().default(null),
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
    const expectedCertification =
      expert.evidence_state.field_status === "proven"
        ? "C3"
        : expert.evidence_state.lab_status === "certified"
          ? "C2"
          : expert.evidence_state.package_status === "validated"
            ? "C1"
            : "C0";
    if (expert.certification !== expectedCertification) {
      context.addIssue({
        code: "custom",
        path: ["certification"],
        message: `certification must be derived as ${expectedCertification}`,
      });
    }
    if (
      expert.evidence_state.lab_status === "certified" &&
      !expert.evaluation
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluation"],
        message: "lab-certified experts require a signed credential projection",
      });
    }
    if (expert.evaluation && expert.evidence_state.lab_status !== "certified") {
      context.addIssue({
        code: "custom",
        path: ["evidence_state", "lab_status"],
        message: "a published credential requires lab_status certified",
      });
    }
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
export type CertifiedEvaluation = z.infer<typeof CertifiedEvaluationSchema>;
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
