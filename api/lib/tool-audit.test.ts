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

  it("uses elapsed_ms only when timestamps are absent or invalid", () => {
    expect(
      formatToolElapsed(
        invocation({
          started_at: "not-a-date",
          ended_at: "2026-07-13T00:00:00.000Z",
          elapsed_ms: 1_194,
        })
      )
    ).toBe("1.2 s");
    expect(
      formatToolElapsed(
        invocation({
          started_at: "2026-07-13T00:00:01.000Z",
          ended_at: "2026-07-13T00:00:00.000Z",
        })
      )
    ).toBe("—");
  });
});
