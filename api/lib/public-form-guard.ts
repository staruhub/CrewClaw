import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../context";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_KEYS = 5_000;

type RateEntry = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, RateEntry>();

function clientKey(ctx: TrpcContext, form: string) {
  const flyClientIp = ctx.req.headers.get("fly-client-ip")?.trim() || "none";
  return `${form}:${ctx.remoteAddress || "unknown"}:${flyClientIp}`;
}

function prune(now: number) {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function assertPublicFormAllowed(
  ctx: TrpcContext,
  form: "contact",
  now = Date.now()
) {
  prune(now);
  const key = clientKey(ctx, form);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (current.count >= MAX_ATTEMPTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many form submissions. Please try again in a minute.",
    });
  }
  current.count += 1;
}

export function resetPublicFormRateLimitsForTest() {
  attempts.clear();
}
