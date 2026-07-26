import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  remoteAddress?: string;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
  local?: { remoteAddress?: string }
): Promise<TrpcContext> {
  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    remoteAddress: local?.remoteAddress,
  };
}
