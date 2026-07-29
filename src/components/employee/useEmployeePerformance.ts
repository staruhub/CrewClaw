import type { LocalEmployeePerformance } from "@contracts/local-performance";
import { useEffect, useState } from "react";
import { fetchLocalEmployeePerformance } from "@/lib/local-api";

type EmployeePerformanceState = {
  employeeId: string;
  error: string | null;
  loading: boolean;
  performance: LocalEmployeePerformance | null;
};

const cache = new Map<string, LocalEmployeePerformance | null>();

export function useEmployeePerformance(employeeId: string) {
  const [state, setState] = useState<EmployeePerformanceState>(() => ({
    employeeId,
    error: null,
    loading: !cache.has(employeeId),
    performance: cache.get(employeeId) ?? null,
  }));

  useEffect(() => {
    let cancelled = false;

    if (cache.has(employeeId)) {
      queueMicrotask(() => {
        if (!cancelled) {
          setState({
            employeeId,
            error: null,
            loading: false,
            performance: cache.get(employeeId) ?? null,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    void fetchLocalEmployeePerformance(employeeId)
      .then(performance => {
        cache.set(employeeId, performance);
        if (!cancelled) {
          setState({
            employeeId,
            error: null,
            loading: false,
            performance,
          });
        }
      })
      .catch(error => {
        cache.set(employeeId, null);
        if (!cancelled) {
          setState({
            employeeId,
            error:
              error instanceof Error
                ? error.message
                : "Local performance data is unavailable.",
            loading: false,
            performance: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  return state.employeeId === employeeId
    ? state
    : { employeeId, error: null, loading: true, performance: null };
}
