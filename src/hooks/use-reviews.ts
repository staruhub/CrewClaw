import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import type {
  AcceptedTaskProjection,
  VerifiedEmployeeReview,
} from "@contracts/local-review";
import { track } from "@/hooks/use-analytics";
import {
  fetchLocalEmployeePerformance,
  submitLocalVerifiedReview,
} from "@/lib/local-api";

const REVIEWS_STORAGE_KEY = "crewclaw.reviews.v1";
const REVIEWS_CHANGED_EVENT = "crewclaw:reviews-changed";
const localApiAvailable =
  import.meta.env.DEV || import.meta.env.VITE_CREWCLAW_LOCAL_API === "1";
const LOCAL_REVIEWS_UNAVAILABLE =
  "Local accepted-task reviews are available only from a local CrewClaw workspace.";

export type LegacyEmployeeNote = {
  id: string;
  employee_id: string;
  rating: number;
  text: string;
  created_at: string;
};

let lastRaw: string | null = null;
let lastSnapshot: LegacyEmployeeNote[] = [];

function isLegacyNote(value: unknown): value is LegacyEmployeeNote {
  if (!value || typeof value !== "object") return false;
  const review = value as Record<string, unknown>;
  return (
    typeof review.id === "string" &&
    typeof review.employee_id === "string" &&
    typeof review.rating === "number" &&
    review.rating >= 1 &&
    review.rating <= 5 &&
    typeof review.text === "string" &&
    typeof review.created_at === "string"
  );
}

function readLegacySnapshot(): LegacyEmployeeNote[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(REVIEWS_STORAGE_KEY) ?? "[]";
  if (raw === lastRaw) return lastSnapshot;
  try {
    const parsed = JSON.parse(raw);
    lastSnapshot = Array.isArray(parsed) ? parsed.filter(isLegacyNote) : [];
  } catch {
    lastSnapshot = [];
  }
  lastRaw = raw;
  return lastSnapshot;
}

function subscribeLegacyNotes(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === REVIEWS_STORAGE_KEY) callback();
  };
  window.addEventListener(REVIEWS_CHANGED_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(REVIEWS_CHANGED_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEmployeeReviews(employeeId: string, _fallbackRating = 0) {
  const legacy = useSyncExternalStore(
    subscribeLegacyNotes,
    readLegacySnapshot,
    () => []
  );
  const [reviews, setReviews] = useState<VerifiedEmployeeReview[]>([]);
  const [acceptedTasks, setAcceptedTasks] = useState<AcceptedTaskProjection[]>(
    []
  );
  const [loading, setLoading] = useState(localApiAvailable);
  const [loadMessage, setLoadMessage] = useState<string | null>(
    localApiAvailable ? null : LOCAL_REVIEWS_UNAVAILABLE
  );
  const [loadedFor, setLoadedFor] = useState<string | null>(
    localApiAvailable ? null : employeeId
  );

  const refresh = useCallback(async () => {
    if (!localApiAvailable) {
      setReviews([]);
      setAcceptedTasks([]);
      setLoadMessage(LOCAL_REVIEWS_UNAVAILABLE);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const performance = await fetchLocalEmployeePerformance(employeeId);
      setReviews(performance.verified_reviews);
      setAcceptedTasks(performance.accepted_tasks);
      setLoadedFor(employeeId);
      setLoadMessage(null);
    } catch (error) {
      setReviews([]);
      setAcceptedTasks([]);
      setLoadedFor(employeeId);
      setLoadMessage(
        error instanceof Error
          ? error.message
          : "Verified reviews are unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!localApiAvailable) return;
    let cancelled = false;
    void fetchLocalEmployeePerformance(employeeId)
      .then(performance => {
        if (cancelled) return;
        setReviews(performance.verified_reviews);
        setAcceptedTasks(performance.accepted_tasks);
        setLoadedFor(employeeId);
        setLoadMessage(null);
      })
      .catch(error => {
        if (cancelled) return;
        setReviews([]);
        setAcceptedTasks([]);
        setLoadedFor(employeeId);
        setLoadMessage(
          error instanceof Error
            ? error.message
            : "Verified reviews are unavailable."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const currentReviews = useMemo(
    () => (loadedFor === employeeId ? reviews : []),
    [employeeId, loadedFor, reviews]
  );
  const currentAcceptedTasks = useMemo(
    () => (loadedFor === employeeId ? acceptedTasks : []),
    [acceptedTasks, employeeId, loadedFor]
  );
  const currentLoading =
    localApiAvailable && loadedFor !== employeeId ? true : loading;
  const currentLoadMessage =
    loadedFor === employeeId
      ? loadMessage
      : localApiAvailable
        ? null
        : loadMessage;

  const employeeLegacyNotes = useMemo(
    () =>
      legacy
        .filter(note => note.employee_id === employeeId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [employeeId, legacy]
  );
  const averageRating = useMemo(() => {
    if (currentReviews.length === 0) return 0;
    return (
      currentReviews.reduce((sum, review) => sum + review.rating, 0) /
      currentReviews.length
    );
  }, [currentReviews]);
  const reviewableTasks = useMemo(
    () => currentAcceptedTasks.filter(task => !task.reviewed),
    [currentAcceptedTasks]
  );

  const addReview = useCallback(
    async (taskRunId: string, rating: number, text: string) => {
      if (!localApiAvailable) {
        return { ok: false, message: LOCAL_REVIEWS_UNAVAILABLE };
      }
      const trimmed = text.trim();
      if (!taskRunId) {
        return { ok: false, message: "Choose an accepted task to review." };
      }
      if (!trimmed) {
        return { ok: false, message: "Describe what this employee delivered." };
      }
      try {
        const response = await submitLocalVerifiedReview(employeeId, {
          task_run_id: taskRunId,
          rating,
          text: trimmed,
        });
        setReviews(response.verified_reviews);
        setAcceptedTasks(response.accepted_tasks);
        setLoadedFor(employeeId);
        track("employee_review_submitted", {
          employee_id: employeeId,
          task_run_id: taskRunId,
          rating,
          verified: true,
        });
        return {
          ok: true,
          message: "Verified review linked to the accepted TaskRun receipt.",
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Verified review was not saved.",
        };
      }
    },
    [employeeId]
  );

  return {
    reviews: currentReviews,
    legacyNotes: employeeLegacyNotes,
    averageRating,
    reviewCount: currentReviews.length,
    acceptedTasks: currentAcceptedTasks,
    reviewableTasks,
    localApiAvailable,
    loading: currentLoading,
    loadMessage: currentLoadMessage,
    addReview,
    refresh,
  };
}
