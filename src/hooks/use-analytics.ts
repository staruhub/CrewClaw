import { useCallback } from "react";

export const ANALYTICS_STORAGE_KEY = "crewclaw.analytics.events.v1";

export const ANALYTICS_EVENTS = [
  "marketplace_viewed",
  "employee_searched",
  "employee_card_clicked",
  "employee_detail_viewed",
  "hire_clicked",
  "permission_viewed",
  "hire_confirmed",
  "hire_handoff_prepared",
  "hire_local_api_succeeded",
  "hire_local_api_failed",
  "hire_succeeded",
  "hire_failed",
  "team_viewed",
  "doctor_started",
  "doctor_completed",
  "fire_clicked",
  "fire_confirmed",
  "employee_submitted",
  "employee_published",
  "employee_saved",
  "employee_unsaved",
  "employee_sort_changed",
  "employee_review_submitted",
  "demo_task_copied",
  "task_run_viewed",
  "package_downloaded",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<
  string,
  boolean | number | string | null | string[] | undefined
>;

export type AnalyticsEvent = {
  id: string;
  event: AnalyticsEventName;
  props: AnalyticsProps;
  timestamp: string;
};

function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return (
    typeof value === "string" &&
    ANALYTICS_EVENTS.includes(value as AnalyticsEventName)
  );
}

function createEventId(event: AnalyticsEventName) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `${event}:${Date.now()}:${random}`;
}

export function readAnalyticsEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is AnalyticsEvent =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        isAnalyticsEventName(item.event) &&
        typeof item.timestamp === "string" &&
        item.props &&
        typeof item.props === "object"
    );
  } catch {
    return [];
  }
}

export function writeAnalyticsEvents(events: AnalyticsEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(events));
}

export function track(event: AnalyticsEventName, props: AnalyticsProps = {}) {
  if (typeof window === "undefined") return;

  const nextEvent: AnalyticsEvent = {
    id: createEventId(event),
    event,
    props,
    timestamp: new Date().toISOString(),
  };

  const events = readAnalyticsEvents();
  writeAnalyticsEvents([...events, nextEvent].slice(-1000));
  console.debug("[CrewClaw analytics]", event, props);
}

export function useAnalytics() {
  // react-hooks requires an inline function expression here (a bare reference defeats the
  // compiler's dependency analysis); behavior is identical — a stable wrapper around track.
  return useCallback(
    (event: AnalyticsEventName, props: AnalyticsProps = {}) =>
      track(event, props),
    []
  );
}
