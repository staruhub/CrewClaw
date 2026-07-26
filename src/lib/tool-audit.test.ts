import { describe, expect, it } from "vitest";
import type { ToolInvocation } from "../data/task-runs";
import {
  elapsedMsForToolInvocation,
  formatToolElapsed,
  resolveToolElapsed,
} from "./tool-audit";

const NO_DURATION = "—"; // em dash placeholder rendered in the audit table
const INVALID_WINDOW = "invalid window"; // signal for ended_at < started_at

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    tool_name: "web.search",
    input_summary: "seed 2.1 pricing",
    permission_level: "readonly",
    decision: "allow",
    status: "success",
    ...overrides,
  };
}

describe("resolveToolElapsed", () => {
  it("labels a timestamp-derived duration as measured", () => {
    expect(
      resolveToolElapsed(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.250Z",
          elapsed_ms: 999_999,
        })
      )
    ).toEqual({ source: "measured", elapsedMs: 250 });
  });

  it("labels the elapsed_ms compatibility fallback as claimed", () => {
    expect(resolveToolElapsed(invocation({ elapsed_ms: 42 }))).toEqual({
      source: "claimed",
      elapsedMs: 42,
    });
    // A genuine 0 is a claimed value, not a missing one.
    expect(resolveToolElapsed(invocation({ elapsed_ms: 0 }))).toEqual({
      source: "claimed",
      elapsedMs: 0,
    });
  });

  it("flags an impossible window instead of degrading to the claim", () => {
    const skewed = {
      started_at: "2026-07-25T10:00:10.000Z",
      ended_at: "2026-07-25T10:00:00.000Z",
    };

    expect(resolveToolElapsed(invocation(skewed))).toEqual({
      source: "invalid_window",
    });
    // Even a plausible elapsed_ms must not launder a tampered/skewed record.
    expect(
      resolveToolElapsed(invocation({ ...skewed, elapsed_ms: 5 }))
    ).toEqual({ source: "invalid_window" });
    // A single millisecond of skew is already impossible.
    expect(
      resolveToolElapsed(
        invocation({
          started_at: "2026-07-25T10:00:00.001Z",
          ended_at: "2026-07-25T10:00:00.000Z",
        })
      )
    ).toEqual({ source: "invalid_window" });
  });

  it("treats an unparsable window as claimed fallback, not as invalid", () => {
    // Only a window that parses and runs backwards is an integrity signal;
    // unparsable or half-missing timestamps degrade to the compatibility
    // field, whose value is then labelled as claimed.
    expect(
      resolveToolElapsed(
        invocation({
          started_at: "not-a-date",
          ended_at: "also-not-a-date",
          elapsed_ms: 42,
        })
      )
    ).toEqual({ source: "claimed", elapsedMs: 42 });
    expect(
      resolveToolElapsed(
        invocation({ started_at: "2026-07-25T10:00:00.000Z", elapsed_ms: 42 })
      )
    ).toEqual({ source: "claimed", elapsedMs: 42 });
  });

  it("reports unknown when no source is usable", () => {
    expect(resolveToolElapsed(invocation())).toEqual({ source: "unknown" });
    expect(resolveToolElapsed(invocation({ elapsed_ms: -1 }))).toEqual({
      source: "unknown",
    });
    expect(resolveToolElapsed(invocation({ elapsed_ms: Number.NaN }))).toEqual({
      source: "unknown",
    });
  });
});

describe("elapsedMsForToolInvocation", () => {
  it("measures the window between the runtime audit timestamps", () => {
    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.250Z",
        })
      )
    ).toBe(250);

    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:01:30.061Z",
        })
      )
    ).toBe(90_061);

    // Millisecond resolution is preserved.
    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.001Z",
        })
      )
    ).toBe(1);
  });

  it("compares instants, not wall-clock text, across UTC offsets", () => {
    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T18:00:00.000+08:00",
          ended_at: "2026-07-25T10:00:30.000Z",
        })
      )
    ).toBe(30_000);
  });

  it("keeps a zero-length measurement distinct from a missing one", () => {
    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.000Z",
        })
      )
    ).toBe(0);
    // A genuine 0 from the compatibility field survives the missing-field
    // guard instead of being conflated with an absent value.
    expect(elapsedMsForToolInvocation(invocation({ elapsed_ms: 0 }))).toBe(0);
  });

  it("prefers the audit timestamps over a conflicting persisted elapsed_ms", () => {
    expect(
      elapsedMsForToolInvocation(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.250Z",
          elapsed_ms: 999_999,
        })
      )
    ).toBe(250);
  });

  it("falls back to elapsed_ms when the audit window is incomplete or unparsable", () => {
    const fallbacks: Partial<ToolInvocation>[] = [
      { started_at: "2026-07-25T10:00:00.000Z" },
      { ended_at: "2026-07-25T10:00:00.250Z" },
      { started_at: "", ended_at: "2026-07-25T10:00:00.250Z" },
      { started_at: "2026-07-25T10:00:00.000Z", ended_at: "" },
      { started_at: "not-a-date", ended_at: "also-not-a-date" },
      { started_at: "2026-07-25T10:00:00.000Z", ended_at: "not-a-date" },
      { started_at: "2026-13-45T99:00:00.000Z", ended_at: "2026-07-25" },
    ];

    for (const overrides of fallbacks) {
      expect(
        elapsedMsForToolInvocation(
          invocation({ ...overrides, elapsed_ms: 42 })
        ),
        JSON.stringify(overrides)
      ).toBe(42);
      expect(
        elapsedMsForToolInvocation(invocation(overrides)),
        JSON.stringify(overrides)
      ).toBeUndefined();
    }
  });

  it("refuses to launder an impossible window into the claimed duration", () => {
    // An ended-before-started row (clock skew or a tampered audit record)
    // no longer degrades to the self-reported elapsed_ms: there is no
    // trustworthy duration in such a record.
    const skewed = {
      started_at: "2026-07-25T10:00:10.000Z",
      ended_at: "2026-07-25T10:00:00.000Z",
    };

    expect(
      elapsedMsForToolInvocation(invocation({ ...skewed, elapsed_ms: 5 }))
    ).toBeUndefined();
    expect(elapsedMsForToolInvocation(invocation(skewed))).toBeUndefined();
  });

  it("returns undefined when neither source is usable", () => {
    expect(elapsedMsForToolInvocation(invocation())).toBeUndefined();

    for (const elapsed_ms of [
      -1,
      -0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(
        elapsedMsForToolInvocation(invocation({ elapsed_ms })),
        String(elapsed_ms)
      ).toBeUndefined();
    }
  });

  it("does not filter by decision or status: a blocked call still reports timing", () => {
    expect(
      elapsedMsForToolInvocation(
        invocation({
          decision: "deny",
          status: "blocked",
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.012Z",
        })
      )
    ).toBe(12);
  });
});

describe("formatToolElapsed", () => {
  it("renders measured durations bare: ms below one second, then seconds", () => {
    expect(
      formatToolElapsed(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:00:00.250Z",
        })
      )
    ).toBe("250 ms");
    expect(
      formatToolElapsed(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:01:30.061Z",
        })
      )
    ).toBe("90.1 s");
    // Thousands grouping for long-running measured windows.
    expect(
      formatToolElapsed(
        invocation({
          started_at: "2026-07-25T10:00:00.000Z",
          ended_at: "2026-07-25T10:16:40.000Z",
        })
      )
    ).toBe("1,000 s");
  });

  it("annotates claimed durations so they cannot pass for measured ones", () => {
    expect(formatToolElapsed(invocation({ elapsed_ms: 0 }))).toBe(
      "0 ms (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1 }))).toBe(
      "1 ms (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 999 }))).toBe(
      "999 ms (claimed)"
    );
    // The annotation also covers records whose window is missing one side or
    // unparsable — the number shown there is still only a claim.
    expect(
      formatToolElapsed(
        invocation({ started_at: "2026-07-25T10:00:00.000Z", elapsed_ms: 42 })
      )
    ).toBe("42 ms (claimed)");
    expect(
      formatToolElapsed(
        invocation({
          started_at: "not-a-date",
          ended_at: "also-not-a-date",
          elapsed_ms: 1_500,
        })
      )
    ).toBe("1.5 s (claimed)");
  });

  it("keeps the second-boundary and grouping rules for claimed values", () => {
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_000 }))).toBe(
      "1 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_049 }))).toBe(
      "1 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_050 }))).toBe(
      "1.1 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_500 }))).toBe(
      "1.5 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 60_000 }))).toBe(
      "60 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_000_000 }))).toBe(
      "1,000 s (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 3_600_000 }))).toBe(
      "3,600 s (claimed)"
    );
  });

  it("formats fractional milliseconds raw below one second and rounded above it", () => {
    expect(formatToolElapsed(invocation({ elapsed_ms: 12.5 }))).toBe(
      "12.5 ms (claimed)"
    );
    expect(formatToolElapsed(invocation({ elapsed_ms: 1_250.4 }))).toBe(
      "1.3 s (claimed)"
    );
  });

  it("signals an impossible window instead of borrowing the claim", () => {
    const skewed = {
      started_at: "2026-07-25T10:00:10.000Z",
      ended_at: "2026-07-25T10:00:00.000Z",
    };

    expect(formatToolElapsed(invocation(skewed))).toBe(INVALID_WINDOW);
    // The claimed elapsed_ms of a suspect record is not rendered at all.
    expect(formatToolElapsed(invocation({ ...skewed, elapsed_ms: 5 }))).toBe(
      INVALID_WINDOW
    );
    // The signal is distinct from the "no data" placeholder.
    expect(INVALID_WINDOW).not.toBe(NO_DURATION);
  });

  it("renders the placeholder when no duration can be established", () => {
    expect(formatToolElapsed(invocation())).toBe(NO_DURATION);
    expect(formatToolElapsed(invocation({ elapsed_ms: -1 }))).toBe(NO_DURATION);
    expect(formatToolElapsed(invocation({ elapsed_ms: Number.NaN }))).toBe(
      NO_DURATION
    );
  });
});
