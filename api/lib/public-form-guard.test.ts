import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../context";
import { contactInputSchema } from "../routers/contact";
import {
  assertPublicFormAllowed,
  resetPublicFormRateLimitsForTest,
} from "./public-form-guard";

function context(address = "203.0.113.10"): TrpcContext {
  return {
    req: new Request("https://crewhire.example/api/trpc", {
      headers: { "fly-client-ip": address },
    }),
    resHeaders: new Headers(),
    remoteAddress: "fdaa::1",
  };
}

afterEach(resetPublicFormRateLimitsForTest);

describe("public form boundaries", () => {
  it("matches API field limits to the database schema", () => {
    expect(
      contactInputSchema.safeParse({
        name: "n".repeat(256),
        email: "person@example.com",
      }).success
    ).toBe(false);
    expect(
      contactInputSchema.safeParse({
        name: "Pong",
        email: "person@example.com",
        message: "m".repeat(2001),
      }).success
    ).toBe(false);
  });

  it("rate-limits each public form and client independently", () => {
    const first = context();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() =>
        assertPublicFormAllowed(first, "contact", 1000)
      ).not.toThrow();
    }
    expect(() => assertPublicFormAllowed(first, "contact", 1000)).toThrow(
      TRPCError
    );
    expect(() =>
      assertPublicFormAllowed(context("203.0.113.11"), "contact", 1000)
    ).not.toThrow();
    expect(() =>
      assertPublicFormAllowed(first, "contact", 61_001)
    ).not.toThrow();
  });
});
