import http from "node:http";
import https from "node:https";

import { resolvePublicHttpTarget } from "./tool-gateway.mjs";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const CROSS_ORIGIN_SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-subscription-token",
]);
export const MAX_PUBLIC_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_PUBLIC_REQUEST_BYTES = 1024 * 1024;

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = String(name).toLowerCase();
    if (!lower || HOP_BY_HOP_HEADERS.has(lower) || value == null) continue;
    normalized[name] = value;
  }
  return normalized;
}

function deleteHeader(headers, name) {
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

function setHeader(headers, name, value) {
  deleteHeader(headers, name);
  headers[name] = value;
}

function stripCrossOriginSecrets(headers) {
  const stripped = { ...headers };
  for (const name of CROSS_ORIGIN_SECRET_HEADERS) deleteHeader(stripped, name);
  return stripped;
}

function requestBodyBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  throw new TypeError(
    "public HTTP request body must be a string or byte buffer"
  );
}

function headersFacade(headers) {
  return {
    get(name) {
      const value = headers[String(name).toLowerCase()];
      return Array.isArray(value)
        ? value.join(", ")
        : value == null
          ? null
          : String(value);
    },
  };
}

function requestPinned(
  target,
  {
    signal,
    method = "GET",
    headers = {},
    body = null,
    maxBytes = MAX_PUBLIC_BODY_BYTES,
  } = {}
) {
  return new Promise((resolvePromise, reject) => {
    const url = new URL(target.url);
    const client = url.protocol === "https:" ? https : http;
    const lookup = (hostname, options, callback) => {
      if (hostname.toLowerCase().replace(/\.$/, "") !== target.hostname) {
        callback(
          new Error("request hostname changed after public-target validation")
        );
        return;
      }
      if (options?.all)
        callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const request = client.request(
      url,
      {
        method,
        headers,
        lookup,
        servername: target.hostname,
        signal,
        maxHeaderSize: 16 * 1024,
        agent: false,
      },
      response => {
        const chunks = [];
        let bytes = 0;
        let settled = false;
        response.on("data", chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > maxBytes) {
            settled = true;
            response.destroy();
            resolvePromise({
              ok: false,
              code: "response_too_large",
              status: response.statusCode || 0,
              headers: headersFacade(response.headers),
              url: target.url,
            });
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolvePromise({
            ok: true,
            status: response.statusCode || 0,
            headers: headersFacade(response.headers),
            body: Buffer.concat(chunks).toString("utf8"),
            url: target.url,
          });
        });
        response.on("error", error => {
          if (!settled) reject(error);
        });
      }
    );
    request.on("error", reject);
    if (body?.length) request.write(body);
    request.end();
  });
}

/**
 * Request a public URL while binding the actual socket to the IP set that passed policy validation.
 * Every redirect is resolved and checked independently; the operating-system resolver is never
 * consulted between validation and connect, closing the DNS-rebinding window.
 */
export async function requestPublicText(
  rawUrl,
  {
    signal,
    method = "GET",
    headers,
    body,
    maxBytes = MAX_PUBLIC_BODY_BYTES,
    maxRequestBytes = MAX_PUBLIC_REQUEST_BYTES,
    maxRedirects = 5,
    resolveTarget = resolvePublicHttpTarget,
  } = {}
) {
  let currentUrl = String(rawUrl ?? "").trim();
  let currentMethod = String(method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(currentMethod)) {
    return { ok: false, code: "method_not_allowed", url: currentUrl };
  }

  let currentBody;
  try {
    currentBody = requestBodyBuffer(body);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_request_body",
      url: currentUrl,
      error: error?.message || String(error),
    };
  }
  if (currentBody && BODYLESS_METHODS.has(currentMethod)) {
    return { ok: false, code: "method_body_not_allowed", url: currentUrl };
  }
  if (currentBody && currentBody.length > maxRequestBytes) {
    return { ok: false, code: "request_too_large", url: currentUrl };
  }

  let currentHeaders = normalizeHeaders(headers);
  if (currentBody) {
    setHeader(currentHeaders, "Content-Length", String(currentBody.length));
  } else {
    deleteHeader(currentHeaders, "content-length");
  }

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const target = await resolveTarget(currentUrl);
    if (!target?.ok) {
      return {
        ok: false,
        code: target?.reason || "private_network_blocked",
        url: currentUrl,
      };
    }
    const response = await requestPinned(target, {
      signal,
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      maxBytes,
    });
    if (!response.ok) return response;
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirects === maxRedirects) {
      return {
        ok: false,
        code: "redirect_limit",
        status: response.status,
        url: currentUrl,
      };
    }
    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl).href;
    } catch {
      return {
        ok: false,
        code: "invalid_redirect",
        status: response.status,
        url: currentUrl,
      };
    }

    const crossOrigin = new URL(nextUrl).origin !== new URL(currentUrl).origin;
    // A generic client cannot identify secrets embedded in an API request body (Tavily keeps an
    // api_key there for backwards compatibility). Never replay a body to an origin that did not
    // receive the original request; operators should configure the provider's final canonical URL.
    if (crossOrigin && currentBody) {
      return {
        ok: false,
        code: "cross_origin_redirect_blocked",
        status: response.status,
        url: currentUrl,
      };
    }
    if (crossOrigin) {
      currentHeaders = stripCrossOriginSecrets(currentHeaders);
    }
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        currentMethod === "POST")
    ) {
      if (currentMethod !== "HEAD") currentMethod = "GET";
      currentBody = null;
      deleteHeader(currentHeaders, "content-length");
      deleteHeader(currentHeaders, "content-type");
    }
    currentUrl = nextUrl;
  }
  return { ok: false, code: "redirect_limit", url: currentUrl };
}
