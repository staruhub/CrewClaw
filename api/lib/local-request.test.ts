import { describe, expect, it } from "vitest";
import { assertLocalApiRequest, isLoopbackAddress } from "./local-request";

describe("local API request boundary", () => {
  it("accepts same-origin loopback requests and rejects remote or cross-origin access", () => {
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(() =>
      assertLocalApiRequest(
        new Request("http://127.0.0.1:3000/api/local/team", {
          headers: { Origin: "http://127.0.0.1:3000" },
        }),
        { remoteAddress: "::1" }
      )
    ).not.toThrow();
    expect(() =>
      assertLocalApiRequest(
        new Request("http://127.0.0.1:3000/api/local/team", {
          headers: { Origin: "https://evil.example" },
        })
      )
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertLocalApiRequest(
        new Request("http://192.168.1.5:3000/api/local/team")
      )
    ).toThrow(/only from this machine/);
  });

  it("requires an explicit non-simple header for mutations", () => {
    const url = "http://127.0.0.1:3000/api/local/team/hire";
    expect(() =>
      assertLocalApiRequest(new Request(url, { method: "POST" }), {
        mutation: true,
      })
    ).toThrow(/confirmation/);
    expect(() =>
      assertLocalApiRequest(
        new Request(url, {
          method: "POST",
          headers: { "X-CrewClaw-Local": "1" },
        }),
        { mutation: true }
      )
    ).not.toThrow();
  });
});
