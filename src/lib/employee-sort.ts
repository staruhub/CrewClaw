import type { Employee } from "@/data/employees";

export const EMPLOYEE_SORT_OPTIONS = [
  { value: "recommended", label: "推荐" },
  { value: "rating", label: "评分" },
  { value: "hire_count", label: "雇佣数" },
  { value: "updated_at", label: "更新时间" },
] as const;

export type EmployeeSort = (typeof EMPLOYEE_SORT_OPTIONS)[number]["value"];

export function isEmployeeSort(value: string | null): value is EmployeeSort {
  return EMPLOYEE_SORT_OPTIONS.some((option) => option.value === value);
}

export function sortEmployees(employees: Employee[], sort: EmployeeSort) {
  return [...employees].sort((a, b) => {
    if (sort === "rating") {
      return b.rating - a.rating || b.hire_count - a.hire_count;
    }

    if (sort === "hire_count") {
      return b.hire_count - a.hire_count || b.rating - a.rating;
    }

    if (sort === "updated_at") {
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }

    return Number(b.verified) - Number(a.verified) || b.rating - a.rating || b.hire_count - a.hire_count;
  });
}
