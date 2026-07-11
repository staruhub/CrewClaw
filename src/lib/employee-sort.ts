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

function compareVersionDesc(a: Employee, b: Employee) {
  const left = a.version.split(".").map(Number);
  const right = b.version.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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
