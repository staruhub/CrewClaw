import { describe, expect, it } from "vitest";
import {
  elapsedMsForToolInvocation,
  formatToolElapsed,
} from "@/lib/tool-audit";
import type { ToolInvocation } from "@/data/task-runs";

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    tool_name: "web_fetch",
    input_summary: "https://example.test",
    permission_level: "L0",
    decision: "allow",
    status: "success",
    ...overrides,
  };
}

describe("tool audit elapsed display", () => {
  it("derives elapsed time from runtime audit timestamps before legacy elapsed_ms", () => {
    const tool = invocation({
      started_at: "2026-07-13T00:00:00.100Z",
      ended_at: "2026-07-13T00:00:00.942Z",
      elapsed_ms: 7,
    });

    expect(elapsedMsForToolInvocation(tool)).toBe(842);
    expect(formatToolElapsed(tool)).toBe("842 ms");
  });

  it("falls back to elapsed_ms when timestamps are unusable, but marks it as claimed", () => {
    // An unparsable timestamp leaves no measurable window, so the self-reported value is
    // all we have — it must render, but must not look like a measured duration.
    expect(
      formatToolElapsed(
        invocation({
          started_at: "not-a-date",
          ended_at: "2026-07-13T00:00:00.000Z",
          elapsed_ms: 1_194,
        })
      )
    ).toBe("1.2 s (claimed)");
  });

  it("refuses to launder an impossible audit window into a duration", () => {
    // ended_at < started_at means the record is skewed or rewritten. Neither the window
    // nor a co-located elapsed_ms may be presented as timing the table can trust.
    const backwards = {
      started_at: "2026-07-13T00:00:01.000Z",
      ended_at: "2026-07-13T00:00:00.000Z",
    };
    expect(formatToolElapsed(invocation(backwards))).toBe("invalid window");
    expect(
      formatToolElapsed(invocation({ ...backwards, elapsed_ms: 1_194 }))
    ).toBe("invalid window");
    expect(
      elapsedMsForToolInvocation(
        invocation({ ...backwards, elapsed_ms: 1_194 })
      )
    ).toBeUndefined();
  });
});
