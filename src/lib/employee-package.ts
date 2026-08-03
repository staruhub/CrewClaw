export type EmployeePackageMetadata = {
  slug: string;
  filename: string;
  version: string;
  sha256: string;
  files: string[];
};

const SHA256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The server always names packages `<slug>-<version>.tar.gz` (api/lib/pack-employee.ts),
// so a legitimate filename is a bare lowercase basename. Callers paste this value into a
// source command (`pnpm run crewclaw -- hire --from "<filename>"`), so anything a shell or a path resolver
// could reinterpret — separators, `..`, quotes, spaces, metacharacters, a leading dot or
// dash — must never reach them.
const PACKAGE_FILENAME = /^[a-z0-9][a-z0-9._-]*\.tar\.gz$/;

export function employeePackageUrl(slug: string): string {
  if (!SLUG.test(slug)) throw new Error("Invalid employee slug");
  return `/api/employees/${encodeURIComponent(slug)}/package`;
}

export async function fetchEmployeePackageMetadata(
  slug: string,
  signal?: AbortSignal
): Promise<EmployeePackageMetadata> {
  const response = await fetch(`${employeePackageUrl(slug)}?meta=1`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Package metadata request failed (${response.status})`);
  }
  const value: unknown = await response.json();
  // Arrays are truthy and typeof "object", but they are not the metadata
  // object contract, so the response-shape gate rejects them here.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Package metadata response is invalid");
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.slug !== "string" ||
    source.slug !== slug ||
    typeof source.filename !== "string" ||
    !PACKAGE_FILENAME.test(source.filename) ||
    typeof source.version !== "string" ||
    typeof source.sha256 !== "string" ||
    !SHA256.test(source.sha256) ||
    !Array.isArray(source.files) ||
    !source.files.every(file => typeof file === "string")
  ) {
    throw new Error("Package metadata identity is invalid");
  }
  return {
    slug: source.slug,
    filename: source.filename,
    version: source.version,
    sha256: source.sha256,
    files: source.files as string[],
  };
}
