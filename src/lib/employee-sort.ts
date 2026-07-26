import type { Employee } from "@/data/employees";

// v0.18 收束3: rating/hire_count were fabricated fields and are gone — every sort key below is a
// real value from the registry / hire.yaml projection.
export const EMPLOYEE_SORT_OPTIONS = [
  { value: "recommended", label: "推荐" },
  { value: "version", label: "版本" },
  { value: "name", label: "名称" },
  { value: "updated_at", label: "更新时间" },
] as const;

export type EmployeeSort = (typeof EMPLOYEE_SORT_OPTIONS)[number]["value"];

export function isEmployeeSort(value: string | null): value is EmployeeSort {
  return EMPLOYEE_SORT_OPTIONS.some(option => option.value === value);
}

type ParsedVersion = {
  /** Numeric release core, e.g. `1.4.0` -> [1, 4, 0]. Always finite. */
  release: number[];
  /** Dot-separated pre-release identifiers, e.g. `-rc.1` -> ["rc", "1"]. */
  prerelease: string[];
};

/**
 * Dependency-free semver-ish parse. Build metadata is dropped (it never affects
 * precedence), the pre-release tag is split off before the release core is read,
 * and every release segment is coerced to a finite number — `Number("0-rc1")`
 * used to poison the comparator with NaN, which is undefined behaviour for
 * Array.prototype.sort.
 */
function parseVersion(version: string): ParsedVersion {
  const withoutBuild = version.split("+")[0] ?? "";
  const tagIndex = withoutBuild.indexOf("-");
  const core = tagIndex === -1 ? withoutBuild : withoutBuild.slice(0, tagIndex);
  const tag = tagIndex === -1 ? "" : withoutBuild.slice(tagIndex + 1);

  return {
    release: core.split(".").map(segment => {
      const parsed = Number.parseInt(segment, 10);
      // Non-numeric (or absurdly long) segments read as 0 rather than NaN.
      return Number.isFinite(parsed) ? parsed : 0;
    }),
    prerelease: tag === "" ? [] : tag.split("."),
  };
}

/** Ascending semver identifier order: numeric ranks below alphanumeric. */
function compareIdentifierAsc(left: string, right: string) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    const leftValue = Number(left);
    const rightValue = Number(right);
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  }

  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Ascending pre-release order: a release outranks all of its pre-releases. */
function comparePrereleaseAsc(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftId = left[index];
    const rightId = right[index];
    // A longer identifier list outranks its own prefix: rc.1 > rc.
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;

    const diff = compareIdentifierAsc(leftId, rightId);
    if (diff !== 0) return diff;
  }

  return 0;
}

/**
 * Newest version first. Total and never NaN, so the `|| name` tie-break below
 * only runs on a genuine tie: `1.4.0-rc1` now ranks under `1.4.0` instead of
 * silently degrading to name order.
 */
function compareVersionDesc(a: Employee, b: Employee) {
  const left = parseVersion(a.version);
  const right = parseVersion(b.version);

  const segments = Math.max(left.release.length, right.release.length);
  for (let index = 0; index < segments; index += 1) {
    const leftSegment = left.release[index] ?? 0;
    const rightSegment = right.release[index] ?? 0;
    if (leftSegment !== rightSegment)
      return leftSegment < rightSegment ? 1 : -1;
  }

  // Arguments swapped: ascending pre-release order read backwards is descending.
  return comparePrereleaseAsc(right.prerelease, left.prerelease);
}

export function sortEmployees(employees: Employee[], sort: EmployeeSort) {
  return [...employees].sort((a, b) => {
    if (sort === "version") {
      return compareVersionDesc(a, b) || a.name.localeCompare(b.name);
    }

    if (sort === "name") {
      return a.name.localeCompare(b.name);
    }

    if (sort === "updated_at") {
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }

    return (
      Number(b.verified) - Number(a.verified) ||
      compareVersionDesc(a, b) ||
      a.name.localeCompare(b.name)
    );
  });
}
