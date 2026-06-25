import { useCallback, useEffect, useState } from "react";

const ROLE_STORAGE_KEY = "crewclaw.roles.v1";

export type RoleAssignments = Record<string, string>;

function readStoredRoles(): RoleAssignments {
  if (typeof window === "undefined") return {};

  const raw = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.entries(parsed).reduce<RoleAssignments>((roles, [employeeId, role]) => {
      if (typeof employeeId === "string" && typeof role === "string") {
        const trimmedRole = role.trim();
        if (trimmedRole) roles[employeeId] = trimmedRole;
      }

      return roles;
    }, {});
  } catch {
    return {};
  }
}

function writeStoredRoles(roles: RoleAssignments) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(roles));
}

export function useRoles() {
  const [roles, setRoles] = useState<RoleAssignments>(() => readStoredRoles());

  useEffect(() => {
    writeStoredRoles(roles);
  }, [roles]);

  const getRole = useCallback((employeeId: string) => roles[employeeId] ?? "", [roles]);

  const assignRole = useCallback((employeeId: string, role: string) => {
    const trimmedRole = role.trim();

    setRoles((currentRoles) => {
      if (!trimmedRole) {
        const { [employeeId]: _removedRole, ...remainingRoles } = currentRoles;
        return remainingRoles;
      }

      return {
        ...currentRoles,
        [employeeId]: trimmedRole,
      };
    });
  }, []);

  return {
    assignRole,
    getRole,
    roles,
  };
}
