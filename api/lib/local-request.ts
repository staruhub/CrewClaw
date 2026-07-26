export class LocalRequestError extends Error {
  readonly status = 403;
}

export function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::1" ||
    normalized === "localhost" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function assertLocalApiRequest(
  request: Request,
  options: { remoteAddress?: string; mutation?: boolean } = {}
) {
  const url = new URL(request.url);
  if (
    !isLoopbackAddress(url.hostname) ||
    (options.remoteAddress !== undefined &&
      !isLoopbackAddress(options.remoteAddress))
  ) {
    throw new LocalRequestError(
      "Local CrewClaw state is available only from this machine."
    );
  }

  const origin = request.headers.get("Origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new LocalRequestError("Invalid request origin.");
    }
    if (originUrl.origin !== url.origin) {
      throw new LocalRequestError(
        "Cross-origin local state access is blocked."
      );
    }
  }

  if (options.mutation && request.headers.get("X-CrewClaw-Local") !== "1") {
    throw new LocalRequestError("Missing local state mutation confirmation.");
  }
}

export async function readSmallJsonBody(
  request: Request,
  maxBytes = 64 * 1024
) {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json."), {
      status: 415,
    });
  }
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Object.assign(new Error("Request body is not valid JSON."), {
      status: 400,
    });
  }
}
