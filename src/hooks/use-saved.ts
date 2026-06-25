import { useCallback, useSyncExternalStore } from "react";
import { track } from "@/hooks/use-analytics";

const SAVED_STORAGE_KEY = "crewclaw.saved.v1";
const SAVED_CHANGED_EVENT = "crewclaw:saved-changed";

let lastRaw: string | null = null;
let lastSnapshot: string[] = [];

function readSavedSnapshot(): string[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(SAVED_STORAGE_KEY) ?? "[]";
  if (raw === lastRaw) return lastSnapshot;

  try {
    const parsed = JSON.parse(raw);
    lastSnapshot = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    lastSnapshot = [];
  }

  lastRaw = raw;
  return lastSnapshot;
}

function writeSavedSnapshot(ids: string[]) {
  if (typeof window === "undefined") return;

  const uniqueIds = [...new Set(ids)];
  lastSnapshot = uniqueIds;
  lastRaw = JSON.stringify(uniqueIds);
  window.localStorage.setItem(SAVED_STORAGE_KEY, lastRaw);
  window.dispatchEvent(new Event(SAVED_CHANGED_EVENT));
}

function subscribeSaved(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_STORAGE_KEY) callback();
  };

  window.addEventListener(SAVED_CHANGED_EVENT, callback);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(SAVED_CHANGED_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSavedEmployees() {
  const savedIds = useSyncExternalStore(subscribeSaved, readSavedSnapshot, () => []);

  const isSaved = useCallback((employeeId: string) => savedIds.includes(employeeId), [savedIds]);

  const toggleSaved = useCallback(
    (employeeId: string, employeeName?: string) => {
      const nextSaved = isSaved(employeeId)
        ? savedIds.filter((id) => id !== employeeId)
        : [...savedIds, employeeId];

      writeSavedSnapshot(nextSaved);
      track(isSaved(employeeId) ? "employee_unsaved" : "employee_saved", {
        employee_id: employeeId,
        employee_name: employeeName,
      });
    },
    [isSaved, savedIds],
  );

  return {
    savedIds,
    isSaved,
    toggleSaved,
  };
}
