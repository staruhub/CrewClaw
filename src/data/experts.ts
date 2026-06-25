import registry from "../../registry/experts.json";

export type WebExpert = (typeof registry.experts)[number];

export const experts = registry.experts;

export const availableExperts = experts.filter((expert) => expert.status === "available");

export const localCrewClawCommand =
  import.meta.env.VITE_CREWCLAW_ROOT_COMMAND ?? "pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw";

export function getInstallCommand(expert: WebExpert) {
  if (import.meta.env.DEV && expert.status === "available") return localCrewClawCommand;
  return expert.install_command;
}

export function findInstallCommand(name: string) {
  const expert = experts.find((entry) => entry.name === name);
  return expert ? getInstallCommand(expert) : null;
}
