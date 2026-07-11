// forbidden-paths.ts — the single source of truth for what must NEVER ship inside an employee
// package or exist in a valid expert distribution: local secrets and machine state. Both the
// validator (packages/validator) and the download packer (api/lib/pack-employee) import this, so
// the security boundary can't drift between "what we reject on validation" and "what we exclude
// from a downloadable tarball".

export const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
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

export const EMPLOYEE_PACKAGE_LIMITS = Object.freeze({
  maxEntries: 4_096,
  maxFiles: 1_024,
  maxDepth: 24,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

export const FORBIDDEN_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /\bsk_live_[A-Za-z0-9]{20,}\b/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\btvly-[A-Za-z0-9_-]{16,}\b/i,
  /AWS_SECRET_ACCESS_KEY\s*[:=]\s*[A-Za-z0-9/+=]{40}\b/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----/i,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/i,
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/i,
];

const SENSITIVE_ASSIGNMENT =
  /["']?([A-Za-z][A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret(?:[_-]?access[_-]?key)?|password|passwd|database[_-]?url|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,#\]\r\n]+))/gi;

const WINDOWS_RESERVED_COMPONENT =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

function isSecretEnvFile(name: string): boolean {
  const lower = name.toLowerCase();
  if ([".env.example", ".env.sample", ".env.template"].includes(lower))
    return false;
  return lower === ".env" || lower === ".envrc" || lower.startsWith(".env.");
}

function isCredentialFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /^credentials(?:[._-].*)?\.json$/.test(lower) ||
    /^service-account(?:[._-].*)?\.json$/.test(lower) ||
    /^(?:auth|credentials?|secrets?|tokens?)(?:[._-].*)?\.(?:json|ya?ml|toml|ini|cfg|conf)$/.test(
      lower
    ) ||
    /^(?:credentials?|secrets?|tokens?|kubeconfig)$/.test(lower) ||
    /\.(?:key|pem|p12|pfx)$/.test(lower)
  );
}

/** True if any path segment is forbidden, an environment-secret file, or state.db* state. */
export function isForbiddenPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/).map(part => part.toLowerCase());
  return (
    parts.some(
      p => FORBIDDEN_NAMES.has(p) || isSecretEnvFile(p) || isCredentialFile(p)
    ) || /^state\.db(?:-.+)?$/i.test(parts.at(-1) ?? "")
  );
}

/** Portable package paths are relative POSIX paths with no traversal or platform ambiguity. */
export function isSafePortablePackagePath(relPath: string): boolean {
  const hasControlCharacter = [...relPath].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    !relPath ||
    relPath.startsWith("/") ||
    /^[a-z]:\//i.test(relPath) ||
    relPath.includes("\\") ||
    hasControlCharacter
  ) {
    return false;
  }
  const segments = relPath.split("/");
  return segments.every(
    segment =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/[<>:"|?*]/.test(segment) &&
      !WINDOWS_RESERVED_COMPONENT.test(segment)
  );
}

/** Windows and default macOS filesystems compare package paths case-insensitively. */
export function portablePathComparisonKey(relPath: string): string {
  return relPath.normalize("NFC").toLowerCase();
}

function isPlaceholderSecretValue(value: string, key: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (
    /^\$\{[A-Z0-9_]+(?::-[^}]*)?\}$/i.test(normalized) ||
    /^\$[A-Z0-9_]+$/i.test(normalized) ||
    /^%[A-Z0-9_]+%$/i.test(normalized) ||
    /^(?:process\.env\.|env:|secret:\/\/|vault:\/\/)/i.test(normalized) ||
    /^(?:<[^>]+>|\{\{[^}]+\}\})$/.test(normalized) ||
    /^(?:example|sample|placeholder|changeme|replace[-_ ]?me|your[-_ ])/i.test(
      normalized
    ) ||
    normalized.toLowerCase() === key.toLowerCase()
  ) {
    return true;
  }
  return normalized.length < 8;
}

function containsSensitiveAssignment(content: string): boolean {
  SENSITIVE_ASSIGNMENT.lastIndex = 0;
  for (const match of content.matchAll(SENSITIVE_ASSIGNMENT)) {
    const key = match[1] || "";
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!isPlaceholderSecretValue(value, key)) return true;
  }
  return false;
}

function decodedSecretCandidates(content: string | Uint8Array): string[] {
  if (typeof content === "string") return [content];
  const bytes = new Uint8Array(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const candidates = new Set<string>();
  for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
    try {
      candidates.add(new TextDecoder(encoding).decode(bytes));
    } catch {
      // Older runtimes may not expose every decoder; the remaining candidates still get scanned.
    }
  }
  return [...candidates];
}

/** True when file content contains a credential shape that must never be distributed. */
export function containsForbiddenSecret(content: string | Uint8Array): boolean {
  return decodedSecretCandidates(content).some(
    candidate =>
      FORBIDDEN_SECRET_PATTERNS.some(pattern => pattern.test(candidate)) ||
      containsSensitiveAssignment(candidate)
  );
}
