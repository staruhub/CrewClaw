// forbidden-paths.ts — the single source of truth for what must NEVER ship inside an employee
// package or exist in a valid expert distribution: local secrets and machine state. Both the
// validator (packages/validator) and the download packer (api/lib/pack-employee) import this, so
// the security boundary can't drift between "what we reject on validation" and "what we exclude
// from a downloadable tarball".

export const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
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

/** True if any path segment is a forbidden name, or the basename is a state.db* file. */
export function isForbiddenPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  return parts.some((p) => FORBIDDEN_NAMES.has(p)) || /^state\.db(?:-.+)?$/.test(parts.at(-1) ?? "");
}
