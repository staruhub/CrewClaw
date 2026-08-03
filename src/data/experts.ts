import registry from "../../registry/experts.json";
import { CREWCLAW_SOURCE_URL } from "@/lib/product-links";

export type WebExpert = (typeof registry.experts)[number];

export const experts = registry.experts;

export const availableExperts = experts.filter(
  expert => expert.status === "available"
);

export { CREWCLAW_SOURCE_URL };
export const isLocalDevelopment = import.meta.env.DEV;

// vite.config.ts injects VITE_CREWCLAW_ROOT_COMMAND from the serving machine's real repo root,
// so this ?? fallback is only reached in an unconfigured build — keep it a portable, repo-root-
// relative command, never a machine-specific absolute path.
export const localCrewClawCommand =
  import.meta.env.VITE_CREWCLAW_ROOT_COMMAND ?? "pnpm --silent run crewclaw";

export function getInstallCommand(expert: WebExpert) {
  if (isLocalDevelopment && expert.status === "available")
    return localCrewClawCommand;
  // The registry records the intended future package command, but @chaogeek/hermes is not
  // published. Production must never present that unverified command as executable distribution.
  return null;
}

export function findInstallCommand(name: string) {
  const expert = experts.find(entry => entry.name === name);
  return expert ? getInstallCommand(expert) : null;
}
