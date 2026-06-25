import registry from "../../registry/experts.json";
import type { AgentEmployee } from "@contracts/types";

type RegistryExpert = (typeof registry.experts)[number];

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

const registryByName = new Map<string, RegistryExpert>(
  registry.experts.map((expert) => [expert.name, expert]),
);

function registryEntry(name: string) {
  const entry = registryByName.get(name);

  if (!entry) {
    throw new Error(`Missing registry entry for ${name}`);
  }

  return entry;
}

function createEmployee(
  name: string,
  fields: Omit<
    Employee,
    | "employee_id"
    | "name"
    | "role"
    | "creator_id"
    | "description"
    | "status"
    | "verified"
    | "categories"
    | "tags"
    | "created_at"
    | "updated_at"
    | "version"
    | "certification"
    | "pricing"
    | "repo"
    | "local_source"
    | "install_command"
    | "first_task"
  > &
    Partial<
      Pick<
        Employee,
        "description" | "categories" | "tags" | "version" | "pricing" | "first_task"
      >
    >,
): Employee {
  const entry = registryEntry(name);
  const timestamp = registry.updated_at;

  return {
    employee_id: entry.name,
    name: entry.display_name,
    role: fields.identity.title,
    creator_id: "chaogeek",
    description: fields.description ?? fields.identity.description,
    status: "published",
    verified: entry.certification === "C2",
    categories: fields.categories ?? [entry.category],
    tags: fields.tags ?? entry.tags,
    rating: fields.rating,
    hire_count: fields.hire_count,
    created_at: timestamp,
    updated_at: timestamp,
    version: fields.version ?? entry.version ?? "0.1.0",
    certification: entry.certification,
    pricing: fields.pricing ?? entry.pricing,
    repo: entry.repo,
    local_source: entry.local_source,
    install_command: entry.install_command,
    first_task: fields.first_task ?? entry.first_task,
    mascot: fields.mascot,
    identity: fields.identity,
    skills: fields.skills,
    tools: fields.tools,
    permissions: fields.permissions,
    examples: fields.examples,
    limitations: fields.limitations,
    lifecycle: fields.lifecycle,
    demo_tasks: fields.demo_tasks,
    changelog: fields.changelog,
    safety_notes: fields.safety_notes,
  };
}

export const employees: Employee[] = [
  createEmployee("code-review-shrimp", {
    mascot: "shrimp",
    rating: 4.9,
    hire_count: 860,
    identity: {
      title: "Code Review Specialist",
      description:
        "Reviews pull requests, local diffs, and security-sensitive engineering changes with merge-readiness judgment.",
      reports_to: "engineering-lead",
      location: "remote",
    },
    skills: [
      "pull-request-review",
      "security-risk-scan",
      "merge-readiness-summary",
      "review-comment-style",
    ],
    tools: ["terminal", "read_file", "skills"],
    permissions: [
      "repository:read",
      "diff:read",
      "terminal:read-only",
      "github_token:optional",
    ],
    examples: {
      inputs: [
        "Review this branch against main and separate blocking defects from suggestions.",
        "Check this pull request for auth, validation, logging, and secrets issues.",
      ],
      outputs: [
        "A prioritized review with blockers, risks, suggested fixes, and merge conditions.",
        "A concise security-focused summary with file-level findings and residual risk.",
      ],
    },
    limitations: [
      "Does not replace the final human merge decision.",
      "Does not make unauthorized repository changes.",
      "Does not run deployments or destructive commands.",
    ],
    lifecycle: {
      hireable: true,
      fireable: true,
      trial_period: "7d",
    },
    demo_tasks: [
      "Review the current branch against main and list blockers, suggestions, and merge conditions.",
    ],
    changelog: ["0.1.0: Initial ChaoGeek Certified review profile."],
    safety_notes: [
      "Treats repository writes, secrets, and deployment actions as out of scope unless the user explicitly authorizes them.",
    ],
  }),
  createEmployee("product-prd-crab", {
    mascot: "crab",
    rating: 4.8,
    hire_count: 720,
    identity: {
      title: "Product PRD Reviewer",
      description:
        "Reviews PRDs, clarifies requirements, maps edge cases, and turns plans into testable acceptance criteria.",
      reports_to: "product-lead",
      location: "remote",
    },
    skills: [
      "prd-review-framework",
      "edge-case-mapper",
      "acceptance-criteria-writer",
      "metrics-and-events-planner",
    ],
    tools: ["terminal", "read_file", "skills"],
    permissions: ["documents:read", "requirements:read", "terminal:read-only"],
    examples: {
      inputs: [
        "Review this PRD for unclear user goals, missing boundaries, and weak acceptance criteria.",
        "Turn this product scope into measurable events and launch metrics.",
      ],
      outputs: [
        "A structured PRD critique covering user goals, edge cases, acceptance criteria, and metrics.",
        "A metrics plan with event names, trigger points, and validation questions.",
      ],
    },
    limitations: [
      "Does not replace user research.",
      "Does not make final business decisions.",
      "Does not invent market data.",
    ],
    lifecycle: {
      hireable: true,
      fireable: true,
      trial_period: "7d",
    },
    demo_tasks: [
      "Review this PRD and identify unclear user goals, missing edge cases, and testable acceptance criteria.",
    ],
    changelog: ["0.1.0: Initial ChaoGeek Certified product profile."],
    safety_notes: [
      "Calls out assumptions explicitly instead of filling product or market gaps with unsupported claims.",
    ],
  }),
  createEmployee("macao-networking-agent", {
    mascot: "crab",
    rating: 4.8,
    hire_count: 1200,
    identity: {
      title: "Macao Networking Specialist",
      description:
        "Helps founders, BD teams, investors, and event organizers discover Macao events, map local leads, research organizations, and draft human-reviewed outreach.",
      reports_to: "pong",
      location: "Macao",
    },
    skills: ["icebreaker", "lead-matcher", "follow-up-writer", "dinner-recommender"],
    tools: ["browser", "skills"],
    permissions: [
      "public_web:read",
      "contacts:read:disabled_by_default",
      "crm:write:disabled",
      "outbound_messages:human_confirmation_required",
    ],
    examples: {
      inputs: [
        "Find Macao events this month where I can meet fintech professionals.",
        "Research Macao AI startup organizations and suggest warm entry points.",
        "Draft a message to a Macao-based investor after a brief conference chat.",
      ],
      outputs: [
        "A sourced event list with fit rationale and practical attendance advice.",
        "A lead map covering organizations, people to research, and suggested angles.",
        "Three concise outreach drafts that the user reviews and sends manually.",
      ],
    },
    limitations: [
      "Does not guarantee that a contact exists, is current, or can be reached.",
      "Does not access private contacts, CRM records, or calendars unless the user explicitly enables those tools.",
      "Does not send messages or update CRM records; it drafts and recommends only.",
      "Marks missing facts as placeholders instead of inventing personal details.",
    ],
    lifecycle: {
      hireable: true,
      fireable: true,
      trial_period: "7d",
    },
    categories: ["local-expert", "sales", "research"],
    tags: ["macao", "networking", "sales", "research"],
    pricing: "free-preview",
    demo_tasks: [
      "Help me find Macao events this month for meeting fintech professionals, with event list, recommendation rationale, and attendance advice.",
      "Organize Macao AI startup-related institutions with background and possible entry points.",
    ],
    changelog: ["0.1.0: Initial ChaoGeek Certified MVP profile."],
    safety_notes: [
      "Use public sources for research unless the user explicitly provides private context.",
      "Human confirmation is required before any outbound message is sent.",
    ],
  }),
];

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
