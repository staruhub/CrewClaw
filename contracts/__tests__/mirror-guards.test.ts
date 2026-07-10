import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — untyped runtime .mjs module.
import { BUDGET_CAPS } from "../../packages/runtime/spend.mjs";
// @ts-expect-error — untyped runtime .mjs module.
import { APPROVAL_ALL_DELIVERIES, APPROVAL_TRUST_AUTO } from "../../packages/runtime/tui/prefs.mjs";

// Cross-language mirror guards. The Rust SETTINGS overlay defines the option tables the user sees;
// the Node engine interprets the persisted indices. Rust can't be imported, so we extract the
// constants from the source text — crude, but it turns a silent cross-language drift into a red test.

const repoRoot = path.resolve(__dirname, "../..");
const overlaySource = readFileSync(
  path.join(repoRoot, "crates/crewclaw-cli/src/workbench/widgets/overlay_settings.rs"),
  "utf8",
);

function extractRustArray(name: string): string[] {
  const match = overlaySource.match(new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]+)\\]`));
  expect(match, `${name} not found in overlay_settings.rs — was it renamed?`).toBeTruthy();
  return [...match![1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe("Rust ↔ Node mirror tables", () => {
  it("BUDGET_OPTS (Rust) matches BUDGET_CAPS (spend.mjs) in count and dollar values", () => {
    const rust = extractRustArray("BUDGET_OPTS"); // e.g. ["$20", "$50", "$100", "$200"]
    const rustValues = rust.map((s) => Number(s.replace(/[^0-9.]/g, "")));
    expect(rustValues).toEqual([...(BUDGET_CAPS as number[])]);
  });

  it("APPROVAL_OPTS (Rust) matches the prefs.mjs policy indices in count and order", () => {
    const rust = extractRustArray("APPROVAL_OPTS"); // ["所有交付", "信任后自动"]
    expect(rust).toHaveLength(2);
    // Index semantics: 0 = manual gate for every delivery, 1 = trust-auto. The engine-side
    // constants must agree with the positions the Rust overlay persists.
    expect(APPROVAL_ALL_DELIVERIES).toBe(0);
    expect(APPROVAL_TRUST_AUTO).toBe(1);
    expect(rust[APPROVAL_ALL_DELIVERIES as number]).toBe("所有交付");
    expect(rust[APPROVAL_TRUST_AUTO as number]).toBe("信任后自动");
  });
});
