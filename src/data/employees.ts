// Thin adapter over the generated dataset. The employee facts live in registry/experts.json and
// each expert package's hire.yaml / crewclaw.employee.yaml — regenerate with `pnpm run
// web:employees` (drift-guarded by contracts/__tests__/web-employees.test.ts). Never hand-edit
// employee data here or in employees.generated.json.
import type { AgentEmployee } from "@contracts/types";

import generated from "./employees.generated.json";

export type EmployeeExamples = {
  inputs: string[];
  outputs: string[];
};

export type EmployeeLifecycle = {
  hireable: boolean;
  fireable: boolean;
  trial_period: string;
};

export type EmployeeIdentity = {
  title: string;
  description: string;
  reports_to?: string;
  location?: string;
};

export type Employee = AgentEmployee & {
  mascot?: string;
  version: string;
  certification: string;
  pricing: string;
  repo: string | null;
  local_source: string | null;
  install_command: string | null;
  first_task: string;
  identity: EmployeeIdentity;
  skills: string[];
  tools: string[];
  permissions: string[];
  examples: EmployeeExamples;
  limitations: string[];
  lifecycle: EmployeeLifecycle;
  demo_tasks: string[];
  changelog: string[];
  safety_notes: string[];
};

// JSON widens literals (status: string), so a cast is needed; the generator Zod-validates every
// package and the drift guard keeps disk in sync with the sources.
export const employees = generated.employees as unknown as Employee[];

export const availableEmployees = employees;

export function getEmployee(id: string) {
  return employees.find((employee) => employee.employee_id === id);
}

export function searchEmployees(keyword: string) {
  const query = keyword.trim().toLowerCase();

  if (!query) return employees;

  return employees.filter((employee) => {
    const searchable = [
      employee.name,
      employee.role,
      employee.description,
      employee.pricing,
      ...employee.categories,
      ...employee.tags,
      ...employee.skills,
      ...employee.tools,
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  });
}

export function byCategory(): Record<string, Employee[]>;
export function byCategory(category: string): Employee[];
export function byCategory(category?: string) {
  if (category) {
    const normalized = category.toLowerCase();
    return employees.filter((employee) =>
      employee.categories.some((item) => item.toLowerCase() === normalized),
    );
  }

  return employees.reduce<Record<string, Employee[]>>((groups, employee) => {
    for (const item of employee.categories) {
      groups[item] = groups[item] ?? [];
      groups[item].push(employee);
    }

    return groups;
  }, {});
}
