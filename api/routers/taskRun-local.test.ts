import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { describe, expect, it } from "vitest";
import { taskRunRouter } from "./taskRun";

describe("TaskRun local boundary", () => {
  it("maps a cross-origin read to HTTP 403", async () => {
    const caller = taskRunRouter.createCaller({
      req: new Request("http://127.0.0.1:3000/api/trpc/taskRun.get", {
        headers: { Origin: "https://evil.example" },
      }),
      resHeaders: new Headers(),
      remoteAddress: "127.0.0.1",
    });

    try {
      await caller.get({ id: "missing-task" });
      throw new Error("expected the local boundary to reject the request");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      if (!(error instanceof TRPCError)) throw error;
      expect(getHTTPStatusCodeFromError(error)).toBe(403);
    }
  });
});
