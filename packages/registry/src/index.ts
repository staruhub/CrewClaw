import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const expertStatusSchema = z.enum(["available", "coming-soon"]);

const expertSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  display_name: z.string().min(1),
  status: expertStatusSchema,
  certification: z.enum(["C0", "C1", "C2", "C3"]),
  category: z.string().min(1),
  description: z.string().min(1),
  repo: z.string().nullable(),
  local_source: z.string().nullable(),
  version: z.string().nullable(),
  pricing: z.string().min(1),
  tags: z.array(z.string()),
  requires: z.object({
    hermes: z.string().min(1),
    env: z.array(z.string()),
  }),
  install_command: z.string().nullable(),
  local_install_command: z.string().nullable(),
  first_task: z.string().min(1),
});

const registrySchema = z.object({
  version: z.string().min(1),
  updated_at: z.string().min(1),
  experts: z.array(expertSchema),
});

export type Expert = z.infer<typeof expertSchema>;
export type ExpertRegistry = z.infer<typeof registrySchema>;
export type ExpertStatus = z.infer<typeof expertStatusSchema>;

export function registryPath(cwd = process.cwd()) {
  return resolve(cwd, "registry", "experts.json");
}

export function loadRegistry(path = registryPath()): ExpertRegistry {
  const raw = readFileSync(path, "utf8");
  return registrySchema.parse(JSON.parse(raw));
}

export function getExperts(path?: string): Expert[] {
  return loadRegistry(path).experts;
}

export function getAvailableExperts(path?: string): Expert[] {
  return getExperts(path).filter((expert) => expert.status === "available");
}

export function findExpert(name: string, path?: string): Expert | undefined {
  return getExperts(path).find((expert) => expert.name === name);
}
