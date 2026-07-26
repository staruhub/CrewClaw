import { describe, expect, it, vi } from "vitest";
import { loadSettledRecords } from "./performance-load";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("loadSettledRecords", () => {
  it("keys every successful record by its id in request order", async () => {
    const result = await loadSettledRecords(
      ["ai-adoption-whale", "code-review-shrimp", "product-prd-crab"],
      async id => ({ id, tasks: id.length })
    );

    expect(result.records).toEqual({
      "ai-adoption-whale": { id: "ai-adoption-whale", tasks: 17 },
      "code-review-shrimp": { id: "code-review-shrimp", tasks: 18 },
      "product-prd-crab": { id: "product-prd-crab", tasks: 16 },
    });
    expect(Object.keys(result.records)).toEqual([
      "ai-adoption-whale",
      "code-review-shrimp",
      "product-prd-crab",
    ]);
    expect(result.failedIds).toEqual([]);
  });

  it("returns an honest empty result and never calls the loader for no ids", async () => {
    const loader = vi.fn(async () => ({ tasks: 0 }));

    const result = await loadSettledRecords([], loader);

    expect(result).toEqual({ records: {}, failedIds: [] });
    expect(loader).not.toHaveBeenCalled();
  });

  it("isolates failures: partial data survives and failed ids stay in input order", async () => {
    const result = await loadSettledRecords(["a", "b", "c", "d"], async id => {
      if (id === "b" || id === "d") throw new Error(`offline: ${id}`);
      return id.toUpperCase();
    });

    expect(result.records).toEqual({ a: "A", c: "C" });
    expect(result.failedIds).toEqual(["b", "d"]);
  });

  it("reports every id when every load fails", async () => {
    const result = await loadSettledRecords(["a", "b"], async () => {
      throw new Error("all down");
    });

    expect(result.records).toEqual({});
    expect(result.failedIds).toEqual(["a", "b"]);
  });

  it("treats a synchronously thrown loader error as a failed id, not a crash", async () => {
    const result = await loadSettledRecords(["a", "b"], id => {
      if (id === "a") throw new TypeError("bad id");
      return Promise.resolve(1);
    });

    expect(result.records).toEqual({ b: 1 });
    expect(result.failedIds).toEqual(["a"]);
  });

  it("handles non-Error rejection values", async () => {
    const result = await loadSettledRecords(["a", "b", "c"], id => {
      if (id === "a") return Promise.reject("string reason");
      if (id === "b") return Promise.reject(undefined);
      return Promise.resolve(3);
    });

    expect(result.records).toEqual({ c: 3 });
    expect(result.failedIds).toEqual(["a", "b"]);
  });

  it("starts all loads concurrently and still keys results by id when they settle out of order", async () => {
    const started: string[] = [];
    const gates = new Map<string, Deferred<number>>();
    const pending = loadSettledRecords(["a", "b", "c"], id => {
      started.push(id);
      const gate = deferred<number>();
      gates.set(id, gate);
      return gate.promise;
    });

    // Every loader was invoked before any of them settled: this is fan-out,
    // not a sequential waterfall.
    expect(started).toEqual(["a", "b", "c"]);

    gates.get("c")!.resolve(3);
    gates.get("a")!.resolve(1);
    gates.get("b")!.reject(new Error("slowest one failed"));

    const result = await pending;
    expect(result.records).toEqual({ a: 1, c: 3 });
    expect(Object.keys(result.records)).toEqual(["a", "c"]);
    expect(result.failedIds).toEqual(["b"]);
  });

  it("keeps falsy and undefined loader results as present keys", async () => {
    const result = await loadSettledRecords<number | null | undefined>(
      ["zero", "null", "undefined"],
      async id => {
        if (id === "zero") return 0;
        if (id === "null") return null;
        return undefined;
      }
    );

    expect(Object.keys(result.records)).toEqual(["zero", "null", "undefined"]);
    expect(result.records.zero).toBe(0);
    expect(result.records.null).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(result.records, "undefined")
    ).toBe(true);
    expect(result.records.undefined).toBeUndefined();
    expect(result.failedIds).toEqual([]);
  });

  it("collapses duplicate ids to a single load instead of last-write-wins", async () => {
    const seen: string[] = [];
    let attempt = 0;
    const result = await loadSettledRecords(["a", "a", "b", "a"], async id => {
      seen.push(id);
      attempt += 1;
      return attempt;
    });

    // The loader runs once per unique id, in first-occurrence order, so an
    // earlier result can never be silently overwritten by a duplicate.
    expect(seen).toEqual(["a", "b"]);
    expect(result.records).toEqual({ a: 1, b: 2 });
    expect(Object.keys(result.records)).toEqual(["a", "b"]);
    expect(result.failedIds).toEqual([]);
  });

  it("keeps records and failedIds disjoint when a duplicated id fails", async () => {
    const result = await loadSettledRecords(
      ["a", "b", "a", "c", "b"],
      async id => {
        if (id === "b") throw new Error("offline: b");
        return id.toUpperCase();
      }
    );

    expect(result.records).toEqual({ a: "A", c: "C" });
    // The failed id is reported once, not once per duplicate occurrence.
    expect(result.failedIds).toEqual(["b"]);
    // Postcondition consumers rely on (src/pages/Performance.tsx): an id is
    // either a records key or a failed id, never both.
    const overlap = Object.keys(result.records).filter(id =>
      result.failedIds.includes(id)
    );
    expect(overlap).toEqual([]);
  });

  it("reports an id that only ever fails exactly once despite duplicates", async () => {
    let attempts = 0;
    const result = await loadSettledRecords(["a", "a"], async () => {
      attempts += 1;
      throw new Error("always down");
    });

    expect(attempts).toBe(1);
    expect(result.records).toEqual({});
    expect(result.failedIds).toEqual(["a"]);
  });

  it("stores prototype-shaped ids as own data properties without polluting Object.prototype", async () => {
    const result = await loadSettledRecords(
      ["__proto__", "constructor", "toString", "safe"],
      async id => `loaded:${id}`
    );

    expect(
      Object.getOwnPropertyDescriptor(result.records, "__proto__")
    ).toEqual({
      value: "loaded:__proto__",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    // A naive `records[id] = value` accumulator would swallow "__proto__"
    // instead of storing it as an own key.
    expect(Object.getPrototypeOf(result.records)).toBe(Object.prototype);
    expect(Object.keys(result.records)).toEqual([
      "__proto__",
      "constructor",
      "toString",
      "safe",
    ]);
    for (const id of ["constructor", "toString", "safe"]) {
      expect(
        Object.getOwnPropertyDescriptor(result.records, id)?.value,
        id
      ).toBe(`loaded:${id}`);
    }
    expect(result.failedIds).toEqual([]);
  });

  it("accepts a readonly id list without mutating it", async () => {
    const ids = Object.freeze(["a", "b"]);

    const result = await loadSettledRecords(ids, async id => id);

    expect(ids).toEqual(["a", "b"]);
    expect(result.records).toEqual({ a: "a", b: "b" });
  });
});
