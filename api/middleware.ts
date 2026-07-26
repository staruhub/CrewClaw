import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertLocalApiRequest } from "./lib/local-request";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;
export const localQuery = t.procedure.use(async ({ ctx, next }) => {
  try {
    assertLocalApiRequest(ctx.req, { remoteAddress: ctx.remoteAddress });
  } catch {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This local workspace resource is available only to the same-origin loopback site.",
    });
  }
  return next();
});
