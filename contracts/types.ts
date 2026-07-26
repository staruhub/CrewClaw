import { z } from "zod";

import { EmployeeManifestSchema } from "./manifest";
export { WorkspaceEmployeeSchema, WorkspaceEmployeeStatusSchema } from "./team";
export type { WorkspaceEmployee, WorkspaceEmployeeStatus } from "./team";
export * from "./certification";
export * from "./employee-proofpack";
export * from "./offboarding";

const NonEmptyStringSchema = z.string().min(1);
const StringArraySchema = z.array(NonEmptyStringSchema);
const DateTimeSchema = z.iso.datetime();

export const EmployeeStatusSchema = z.enum([
  "draft",
  "review",
  "published",
  "disabled",
]);
export const HealthStatusSchema = z.enum(["healthy", "warning", "broken"]);

export const AgentEmployeeSchema = z
  .object({
    employee_id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    role: NonEmptyStringSchema,
    creator_id: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    status: EmployeeStatusSchema,
    verified: z.boolean(),
    categories: StringArraySchema,
    tags: StringArraySchema,
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();

export const EmployeePackageSchema = z
  .object({
    package_id: NonEmptyStringSchema,
    employee_id: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
    manifest: EmployeeManifestSchema,
    package_url: NonEmptyStringSchema,
    checksum: NonEmptyStringSchema,
    release_notes: NonEmptyStringSchema,
  })
  .strict();

export const DoctorReportSchema = z
  .object({
    report_id: NonEmptyStringSchema,
    workspace_employee_id: NonEmptyStringSchema,
    health_status: HealthStatusSchema,
    issues: StringArraySchema,
    suggestions: StringArraySchema,
    checked_at: DateTimeSchema,
  })
  .strict();

export type AgentEmployee = z.infer<typeof AgentEmployeeSchema>;
export type EmployeePackage = z.infer<typeof EmployeePackageSchema>;
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export * from "./errors";
