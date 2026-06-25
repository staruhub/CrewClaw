import { describe, expect, it } from "vitest";

import { EmployeeManifestSchema } from "../manifest";
import {
  AgentEmployeeSchema,
  DoctorReportSchema,
  EmployeePackageSchema,
  WorkspaceEmployeeSchema,
} from "../types";
import type {
  AgentEmployee,
  DoctorReport,
  EmployeePackage,
  WorkspaceEmployee,
} from "../types";
import type { EmployeeManifest } from "../manifest";

const validManifest: EmployeeManifest = {
  apiVersion: "crewclaw/v1",
  kind: "Employee",
  metadata: {
    id: "macao-networking-agent",
    name: "Macao Networking Agent",
    mascot: "crab",
    version: "0.1.0",
    certification: "C2",
    published_by: "ClawHub",
    creator: "CrewClaw Labs",
  },
  identity: {
    title: "Conference Networking Specialist",
    description: "Helps teams discover Macao events, leads, and outreach angles.",
    reports_to: "pong",
    location: "Macao",
  },
  soul: "Fact-first, permission-aware, and concise.",
  skills: ["icebreaker", "lead-matcher"],
  tools: ["browser", "calendar"],
  permissions: ["browser:read", "calendar:read"],
  requires: {
    hermes: ">=0.12.0",
    runtime: "openclaw",
    env: ["OPENAI_API_KEY"],
  },
  examples: {
    inputs: ["Find Macao fintech events this month."],
    outputs: ["A ranked event list with networking suggestions."],
  },
  limitations: ["Does not guarantee that contacts are reachable."],
  sla: {
    response_time: "24h",
    availability: "conference-hours",
    escalation: "human-in-the-loop",
  },
  lifecycle: {
    hireable: true,
    fireable: true,
    trial_period: "7d",
  },
  pricing: "Free",
  categories: ["Local Expert", "Sales"],
  tags: ["Macao", "Networking"],
  demo_tasks: ["Find Macao AI startup institutions."],
  changelog: ["Initial release."],
  support_url: "https://crewclaw.example/support",
  safety_notes: ["Never sends outreach automatically."],
};

describe("EmployeeManifestSchema", () => {
  it("accepts a complete crewclaw/v1 Employee manifest", () => {
    expect(EmployeeManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  it("rejects missing required manifest fields", () => {
    const { metadata: _metadata, ...missingMetadata } = validManifest;

    expect(() => EmployeeManifestSchema.parse(missingMetadata)).toThrow();
  });

  it("rejects manifest enum-like constants outside the contract", () => {
    expect(() =>
      EmployeeManifestSchema.parse({
        ...validManifest,
        kind: "Plugin",
      }),
    ).toThrow();
  });
});

describe("CrewClaw contract model schemas", () => {
  const agentEmployee: AgentEmployee = {
    employee_id: "macao-networking-agent",
    name: "Macao Networking Agent",
    role: "Conference Networking Specialist",
    creator_id: "crewclaw-labs",
    description: "Helps teams discover Macao events, leads, and outreach angles.",
    status: "published",
    verified: true,
    categories: ["Local Expert"],
    tags: ["Macao"],
    rating: 4.8,
    hire_count: 1200,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
  };

  const employeePackage: EmployeePackage = {
    package_id: "pkg-macao-networking-agent-0.1.0",
    employee_id: "macao-networking-agent",
    version: "0.1.0",
    manifest: validManifest,
    package_url: "https://crewclaw.example/packages/macao-networking-agent-0.1.0.tgz",
    checksum: "sha256:abc123",
    release_notes: "Initial release.",
  };

  const workspaceEmployee: WorkspaceEmployee = {
    workspace_employee_id: "we_macao_001",
    workspace_id: "ws_demo",
    employee_id: "macao-networking-agent",
    version: "0.1.0",
    status: "active",
    hired_by: "user_001",
    hired_at: "2026-06-22T00:00:00.000Z",
    fired_at: null,
    permissions_granted: ["browser:read", "calendar:read"],
  };

  const doctorReport: DoctorReport = {
    report_id: "report_001",
    workspace_employee_id: "we_macao_001",
    health_status: "healthy",
    issues: [],
    suggestions: [],
    checked_at: "2026-06-22T00:00:00.000Z",
  };

  it("accepts valid AgentEmployee, EmployeePackage, WorkspaceEmployee, and DoctorReport payloads", () => {
    expect(AgentEmployeeSchema.parse(agentEmployee)).toEqual(agentEmployee);
    expect(EmployeePackageSchema.parse(employeePackage)).toEqual(employeePackage);
    expect(WorkspaceEmployeeSchema.parse(workspaceEmployee)).toEqual(workspaceEmployee);
    expect(DoctorReportSchema.parse(doctorReport)).toEqual(doctorReport);
  });

  it("rejects entity status values outside the contract enums", () => {
    expect(() => AgentEmployeeSchema.parse({ ...agentEmployee, status: "available" })).toThrow();
    expect(() => WorkspaceEmployeeSchema.parse({ ...workspaceEmployee, status: "paused" })).toThrow();
    expect(() => DoctorReportSchema.parse({ ...doctorReport, health_status: "ok" })).toThrow();
  });

  it("rejects missing required model fields", () => {
    const { employee_id: _employeeId, ...missingEmployeeId } = agentEmployee;

    expect(() => AgentEmployeeSchema.parse(missingEmployeeId)).toThrow();
  });
});
