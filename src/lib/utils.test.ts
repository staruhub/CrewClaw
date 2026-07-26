import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("returns an empty string for no arguments or only falsy ones", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined, "", 0)).toBe("");
    expect(cn(true)).toBe("");
  });

  it("joins class names in order and normalises stray whitespace", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
    expect(cn("  px-2   py-1  ")).toBe("px-2 py-1");
    expect(cn("rounded", undefined, "border", null, "shadow")).toBe(
      "rounded border shadow"
    );
  });

  it("flattens nested arrays and truthy object keys", () => {
    expect(cn(["a", "b"])).toBe("a b");
    expect(cn(["px-2", ["py-1", ["m-1"]]])).toBe("px-2 py-1 m-1");
    expect(cn({ "text-lg": true, "text-sm": false })).toBe("text-lg");
    expect(cn(["a"], { b: true }, "c")).toBe("a b c");
  });

  it("keeps the last of two conflicting utilities from the same group", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("flex", "block")).toBe("block");
    expect(cn("p-2", undefined, "p-3", null, "p-4")).toBe("p-4");
  });

  it("resolves shorthand against longhand only in the later-wins direction", () => {
    // A later `p-4` supersedes an earlier `px-2` …
    expect(cn("px-2", "p-4")).toBe("p-4");
    // … but an earlier `p-4` survives a later `px-2`, which only overrides the x axis.
    expect(cn("p-4", "px-2")).toBe("p-4 px-2");
  });

  it("scopes conflict resolution per variant", () => {
    expect(cn("hover:px-2", "px-4")).toBe("hover:px-2 px-4");
    expect(cn("hover:px-2", "hover:px-4")).toBe("hover:px-4");
  });

  it("treats an arbitrary value as conflicting with the same utility", () => {
    expect(cn("bg-red-500", "bg-[#fff]")).toBe("bg-[#fff]");
    expect(cn("bg-[#fff]", "bg-red-500")).toBe("bg-red-500");
  });

  it("collapses duplicate tailwind utilities but keeps duplicate unknown classes", () => {
    expect(cn("px-2", "px-2")).toBe("px-2");
    // Project-specific class names are not in the tailwind conflict map, so they pass through twice.
    expect(cn("crew-card", "crew-card")).toBe("crew-card crew-card");
  });

  it("does not merge Tailwind v3 legacy aliases against their v4 names", () => {
    // Suspected issue, pinned as current behaviour: the app is on tailwindcss 3.x while
    // tailwind-merge 3.x models the v4 utility set, so v3-only aliases go unrecognised and both
    // classes survive — the later one does not win.
    expect(cn("flex-grow", "grow")).toBe("flex-grow grow");
    expect(cn("overflow-ellipsis", "text-ellipsis")).toBe(
      "overflow-ellipsis text-ellipsis"
    );
    // The v4 spellings that tailwind-merge does know still merge correctly.
    expect(cn("grow", "grow-0")).toBe("grow-0");
  });

  it("keeps an important class alongside its non-important counterpart", () => {
    expect(cn("p-4", "!p-2")).toBe("p-4 !p-2");
    expect(cn("!p-4", "!p-2")).toBe("!p-2");
  });

  it("supports the conditional-class pattern components use", () => {
    const badge = (isActive: boolean) =>
      cn("rounded px-2 py-1", isActive && "bg-black text-white");

    expect(badge(true)).toBe("rounded px-2 py-1 bg-black text-white");
    expect(badge(false)).toBe("rounded px-2 py-1");
  });

  it("lets a caller override a component's base classes", () => {
    const button = (className?: string) =>
      cn("inline-flex items-center px-4 py-2 text-sm", className);

    expect(button()).toBe("inline-flex items-center px-4 py-2 text-sm");
    expect(button("px-8 text-lg")).toBe(
      "inline-flex items-center py-2 px-8 text-lg"
    );
  });

  it("renders numbers via clsx truthiness rules", () => {
    expect(cn(1)).toBe("1");
    expect(cn(0)).toBe("");
    expect(cn("gap", 2)).toBe("gap 2");
  });
});
