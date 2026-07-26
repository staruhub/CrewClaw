import { describe, expect, it } from "vitest";
import { loadSettledRecords } from "../../src/lib/performance-load";

describe("loadSettledRecords", () => {
  it("preserves successful employee records when one request fails", async () => {
    const result = await loadSettledRecords(["whale", "shrimp", "crab"], id => {
      if (id === "shrimp") return Promise.reject(new Error("offline"));
      return Promise.resolve({ id, tasks: id === "whale" ? 3 : 2 });
    });

    expect(result.records).toEqual({
      whale: { id: "whale", tasks: 3 },
      crab: { id: "crab", tasks: 2 },
    });
    expect(result.failedIds).toEqual(["shrimp"]);
  });

  it("returns an honest empty result for an empty team", async () => {
    const result = await loadSettledRecords([], async () => ({ tasks: 0 }));
    expect(result).toEqual({ records: {}, failedIds: [] });
  });
});
