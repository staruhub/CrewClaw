import { describe, expect, it } from "vitest";
import type { Employee } from "@/data/employees";
import {
  EMPLOYEE_SORT_OPTIONS,
  isEmployeeSort,
  sortEmployees,
} from "./employee-sort";

// sortEmployees only reads these four fields. Restating the whole registry projection per fixture
// would bury the ordering behaviour under noise, so fixtures carry the sort keys and nothing else.
type SortKeys = Pick<Employee, "name" | "version" | "verified" | "updated_at">;

function employee(name: string, keys: Partial<SortKeys> = {}): Employee {
  const fixture: SortKeys = {
    name,
    version: "1.0.0",
    verified: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...keys,
  };

  return fixture as unknown as Employee;
}

const order = (list: Employee[]) => list.map(entry => entry.name);

describe("isEmployeeSort", () => {
  it("accepts every advertised option and rejects anything else", () => {
    for (const option of EMPLOYEE_SORT_OPTIONS) {
      expect(isEmployeeSort(option.value), option.value).toBe(true);
    }

    for (const rejected of [
      null,
      "",
      "rating",
      "hire_count",
      "Name",
      "name ",
      "recommended,version",
      "updated",
    ]) {
      expect(isEmployeeSort(rejected), String(rejected)).toBe(false);
    }
  });

  it("narrows an untrusted query-string value into a usable sort key", () => {
    const fromQueryString: string | null = "version";
    const list = [
      employee("older", { version: "1.0.0" }),
      employee("newer", { version: "2.0.0" }),
    ];

    if (!isEmployeeSort(fromQueryString)) {
      throw new Error("expected 'version' to pass the guard");
    }

    expect(order(sortEmployees(list, fromQueryString))).toEqual([
      "newer",
      "older",
    ]);
  });

  it("exposes unique, labelled options and no fabricated sort keys", () => {
    const values: string[] = EMPLOYEE_SORT_OPTIONS.map(option => option.value);

    expect(new Set(values).size).toBe(values.length);
    expect(
      EMPLOYEE_SORT_OPTIONS.every(option => option.label.trim().length > 0)
    ).toBe(true);
    // v0.18 收束3 removed the invented rating/hire_count keys; they must not return.
    expect(values).not.toContain("rating");
    expect(values).not.toContain("hire_count");
  });
});

describe("sortEmployees", () => {
  it("returns a new array and never mutates the caller's list", () => {
    const list = [employee("charlie"), employee("alpha"), employee("bravo")];
    const before = order(list);

    const sorted = sortEmployees(list, "name");

    expect(sorted).not.toBe(list);
    expect(order(list)).toEqual(before);
    expect(order(sorted)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("handles empty and single-entry lists", () => {
    expect(sortEmployees([], "recommended")).toEqual([]);
    expect(order(sortEmployees([employee("solo")], "version"))).toEqual([
      "solo",
    ]);
  });

  it("sorts names with locale collation instead of code points", () => {
    const list = [employee("Banana"), employee("apple"), employee("Alpha")];

    // Code-point ordering would hoist every capital ("Alpha", "Banana", "apple").
    expect(order(sortEmployees(list, "name"))).toEqual([
      "Alpha",
      "apple",
      "Banana",
    ]);
  });

  it("ignores version, verification and freshness when sorting by name", () => {
    const list = [
      employee("zulu", {
        version: "9.9.9",
        verified: true,
        updated_at: "2030-01-01T00:00:00.000Z",
      }),
      employee("alpha", {
        version: "0.0.1",
        updated_at: "1999-01-01T00:00:00.000Z",
      }),
    ];

    expect(order(sortEmployees(list, "name"))).toEqual(["alpha", "zulu"]);
  });

  it("compares version segments numerically, newest first", () => {
    const list = [
      employee("a", { version: "1.9.0" }),
      employee("b", { version: "1.10.0" }),
      employee("c", { version: "0.20.0" }),
      employee("d", { version: "2.0.0" }),
    ];

    // A lexical compare would rank 1.9.0 above 1.10.0.
    expect(order(sortEmployees(list, "version"))).toEqual(["d", "b", "a", "c"]);
  });

  it("pads missing version segments with zero and breaks ties on name", () => {
    const list = [
      employee("zed", { version: "1.2" }),
      employee("ann", { version: "1.2.0" }),
      employee("bob", { version: "1.2.1" }),
    ];

    expect(order(sortEmployees(list, "version"))).toEqual([
      "bob",
      "ann",
      "zed",
    ]);
  });

  it("reads an empty version string as 0 and groups it with other zero versions", () => {
    const list = [
      employee("released", { version: "1.0.0" }),
      employee("zero-blank", { version: "" }),
      employee("alpha-zero", { version: "0.0.0" }),
    ];

    expect(order(sortEmployees(list, "version"))).toEqual([
      "released",
      "alpha-zero",
      "zero-blank",
    ]);
  });

  it("ranks a pre-release below its release, whatever the names say", () => {
    // Regression: Number("0-rc1") was NaN, so compareVersionDesc returned NaN and
    // `NaN || a.name.localeCompare(b.name)` silently dropped through to name order.
    const samePrefix = [
      employee("zulu-release", { version: "1.4.0" }),
      employee("alpha-prerelease", { version: "1.4.0-rc1" }),
    ];

    expect(order(sortEmployees(samePrefix, "version"))).toEqual([
      "zulu-release",
      "alpha-prerelease",
    ]);
    // Name order must not decide it, so the reversed input lands the same way.
    expect(order(sortEmployees([...samePrefix].reverse(), "version"))).toEqual([
      "zulu-release",
      "alpha-prerelease",
    ]);

    // An earlier numeric segment still outranks the pre-release rule.
    const differentMajor = [
      employee("alpha-prerelease", { version: "1.4.0-rc1" }),
      employee("zulu-newer", { version: "2.0.0" }),
    ];

    expect(order(sortEmployees(differentMajor, "version"))).toEqual([
      "zulu-newer",
      "alpha-prerelease",
    ]);
  });

  it("orders pre-release identifiers by semver precedence", () => {
    const list = [
      employee("rc2", { version: "1.4.0-rc.2" }),
      employee("release", { version: "1.4.0" }),
      employee("alpha", { version: "1.4.0-alpha" }),
      employee("rc10", { version: "1.4.0-rc.10" }),
      employee("rc-bare", { version: "1.4.0-rc" }),
      employee("numeric", { version: "1.4.0-1" }),
    ];

    // Newest first: release, then rc.10 > rc.2 > rc (a prefix loses to the longer
    // list), then alpha, then the all-numeric identifier, which semver ranks lowest.
    expect(order(sortEmployees(list, "version"))).toEqual([
      "release",
      "rc10",
      "rc2",
      "rc-bare",
      "alpha",
      "numeric",
    ]);
  });

  it("keeps the comparator total, so shuffled input yields one stable order", () => {
    // A NaN comparator result is undefined behaviour for Array#sort: the answer
    // must not depend on the order the entries happened to arrive in.
    const list = [
      employee("b-rc", { version: "1.4.0-rc1" }),
      employee("a-release", { version: "1.4.0" }),
      employee("c-newer", { version: "1.5.0" }),
      employee("d-junk", { version: "not-a-version" }),
    ];
    const expected = ["c-newer", "a-release", "b-rc", "d-junk"];

    expect(order(sortEmployees(list, "version"))).toEqual(expected);
    expect(order(sortEmployees([...list].reverse(), "version"))).toEqual(
      expected
    );
    expect(
      order(sortEmployees([list[2], list[0], list[3], list[1]], "version"))
    ).toEqual(expected);
  });

  it("reads a non-numeric version segment as zero instead of NaN", () => {
    const list = [
      employee("garbage", { version: "x.y.z" }),
      employee("zeroes", { version: "0.0.0" }),
      employee("real", { version: "0.1.0" }),
    ];

    // "x.y.z" degrades to 0.0.0 and ties with it, so the name tie-break decides.
    expect(order(sortEmployees(list, "version"))).toEqual([
      "real",
      "garbage",
      "zeroes",
    ]);
  });

  it("ignores build metadata when ranking versions", () => {
    const list = [
      employee("zulu-build", { version: "1.4.0+build.99" }),
      employee("alpha-plain", { version: "1.4.0" }),
      employee("newer", { version: "1.4.1+build.1" }),
    ];

    // 1.4.0+build.99 and 1.4.0 tie on precedence, so name order breaks the tie.
    expect(order(sortEmployees(list, "version"))).toEqual([
      "newer",
      "alpha-plain",
      "zulu-build",
    ]);
  });

  it("sorts by updated_at with the most recent first", () => {
    const list = [
      employee("stale", { updated_at: "2020-01-01T00:00:00.000Z" }),
      employee("fresh", { updated_at: "2026-06-01T12:30:00.000Z" }),
      employee("mid", { updated_at: "2023-03-03T00:00:00.000Z" }),
    ];

    expect(order(sortEmployees(list, "updated_at"))).toEqual([
      "fresh",
      "mid",
      "stale",
    ]);
  });

  it("keeps input order for identical timestamps instead of falling back to name", () => {
    const list = [
      employee("zulu", { updated_at: "2026-01-01T00:00:00.000Z" }),
      employee("alpha", { updated_at: "2026-01-01T00:00:00.000Z" }),
    ];

    expect(order(sortEmployees(list, "updated_at"))).toEqual(["zulu", "alpha"]);
  });

  it("treats an unparsable updated_at as equal, so its position is preserved", () => {
    // new Date("not-a-date").getTime() is NaN, and a NaN comparator result is coerced to +0.
    const broken = employee("broken", { updated_at: "not-a-date" });
    const dated = employee("dated", { updated_at: "2026-06-01T00:00:00.000Z" });

    expect(order(sortEmployees([broken, dated], "updated_at"))).toEqual([
      "broken",
      "dated",
    ]);
    expect(order(sortEmployees([dated, broken], "updated_at"))).toEqual([
      "dated",
      "broken",
    ]);
  });

  it("recommends verified employees first, then newest version, then name", () => {
    const list = [
      employee("unverified-newest", { version: "9.0.0" }),
      employee("verified-old", { version: "0.1.0", verified: true }),
      employee("verified-new-b", { version: "2.0.0", verified: true }),
      employee("verified-new-a", { version: "2.0.0", verified: true }),
    ];

    expect(order(sortEmployees(list, "recommended"))).toEqual([
      "verified-new-a",
      "verified-new-b",
      "verified-old",
      "unverified-newest",
    ]);
  });

  it("produces the same recommended order however the input was shuffled", () => {
    const list = [
      employee("unverified-newest", { version: "9.0.0" }),
      employee("verified-old", { version: "0.1.0", verified: true }),
      employee("verified-new", { version: "2.0.0", verified: true }),
    ];
    const expected = ["verified-new", "verified-old", "unverified-newest"];

    expect(order(sortEmployees(list, "recommended"))).toEqual(expected);
    expect(order(sortEmployees([...list].reverse(), "recommended"))).toEqual(
      expected
    );
    expect(
      order(sortEmployees([list[1], list[0], list[2]], "recommended"))
    ).toEqual(expected);
  });

  it("ignores updated_at when ranking recommendations", () => {
    const list = [
      employee("verified-stale", {
        verified: true,
        updated_at: "1999-01-01T00:00:00.000Z",
      }),
      employee("unverified-fresh", {
        updated_at: "2030-01-01T00:00:00.000Z",
      }),
    ];

    expect(order(sortEmployees(list, "recommended"))).toEqual([
      "verified-stale",
      "unverified-fresh",
    ]);
  });
});
