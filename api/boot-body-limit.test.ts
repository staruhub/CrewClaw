import { describe, expect, it } from "vitest";
import app from "./boot";

describe("API body limit", () => {
  it("rejects oversized public API requests before tRPC parsing", async () => {
    const body = "x".repeat(1024 * 1024 + 1);
    const response = await app.request("/api/trpc/contact.submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
    });
    expect(response.status).toBe(413);
  });
});
