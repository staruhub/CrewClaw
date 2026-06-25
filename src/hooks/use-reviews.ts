import { useCallback, useMemo, useSyncExternalStore } from "react";
import { track } from "@/hooks/use-analytics";

const REVIEWS_STORAGE_KEY = "crewclaw.reviews.v1";
const REVIEWS_CHANGED_EVENT = "crewclaw:reviews-changed";

export type EmployeeReview = {
  id: string;
  employee_id: string;
  rating: number;
  text: string;
  created_at: string;
};

let lastRaw: string | null = null;
let lastSnapshot: EmployeeReview[] = [];

function isReview(value: unknown): value is EmployeeReview {
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

function readReviewSnapshot(): EmployeeReview[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(REVIEWS_STORAGE_KEY) ?? "[]";
  if (raw === lastRaw) return lastSnapshot;

  try {
    const parsed = JSON.parse(raw);
    lastSnapshot = Array.isArray(parsed) ? parsed.filter(isReview) : [];
  } catch {
    lastSnapshot = [];
  }

  lastRaw = raw;
  return lastSnapshot;
}

function writeReviewSnapshot(reviews: EmployeeReview[]) {
  if (typeof window === "undefined") return;

  lastSnapshot = reviews;
  lastRaw = JSON.stringify(reviews);
  window.localStorage.setItem(REVIEWS_STORAGE_KEY, lastRaw);
  window.dispatchEvent(new Event(REVIEWS_CHANGED_EVENT));
}

function subscribeReviews(callback: () => void) {
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

function createReviewId(employeeId: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `review:${employeeId}:${Date.now()}:${random}`;
}

export function useEmployeeReviews(employeeId: string, fallbackRating: number) {
  const reviews = useSyncExternalStore(subscribeReviews, readReviewSnapshot, () => []);
  const employeeReviews = useMemo(
    () =>
      reviews
        .filter((review) => review.employee_id === employeeId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [employeeId, reviews],
  );

  const averageRating = useMemo(() => {
    if (employeeReviews.length === 0) return fallbackRating;

    const total = employeeReviews.reduce((sum, review) => sum + review.rating, 0);
    return total / employeeReviews.length;
  }, [employeeReviews, fallbackRating]);

  const addReview = useCallback(
    (rating: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return {
          ok: false,
          message: "Tell future teammates what this employee did well.",
        };
      }

      const review: EmployeeReview = {
        id: createReviewId(employeeId),
        employee_id: employeeId,
        rating,
        text: trimmed,
        created_at: new Date().toISOString(),
      };

      writeReviewSnapshot([...reviews, review]);
      track("employee_review_submitted", {
        employee_id: employeeId,
        rating,
      });

      return {
        ok: true,
        message: "Review added to this employee resume.",
      };
    },
    [employeeId, reviews],
  );

  return {
    reviews: employeeReviews,
    averageRating,
    reviewCount: employeeReviews.length,
    addReview,
  };
}
