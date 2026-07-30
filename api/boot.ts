import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { getEmployeePackage } from "./lib/pack-employee";
import {
  fireLocalEmployee,
  hireLocalEmployee,
  LocalTeamError,
  readLocalEmployeePerformance,
  readLocalTeam,
} from "./lib/local-team";
import {
  assertLocalApiRequest,
  LocalRequestError,
  readSmallJsonBody,
} from "./lib/local-request";
import { submitVerifiedReview } from "./lib/local-reviews";

type AppEnv = { Bindings: HttpBindings };
const app = new Hono<AppEnv>();

app.use(bodyLimit({ maxSize: 1024 * 1024 }));
app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: opts =>
      createContext(opts, { remoteAddress: remoteAddress(c) }),
  });
});

// v0.18 Phase 2: a REAL "download employee" — the gzipped package of experts/<slug>/ built from the
// registry's local_source (never a stranger's absolute path). Answers "网站上下载不了": now there's
// an actual artifact + sha256, not just a copyable command. ?meta=1 returns the manifest+checksum as
// JSON (so the site can show the sha before download); otherwise it streams the tarball.
app.get("/api/employees/:slug/package", async c => {
  const slug = c.req.param("slug");
  if (!/^[a-z0-9-]+$/.test(slug)) return c.json({ error: "invalid slug" }, 400);
  let pkg;
  try {
    pkg = await getEmployeePackage(process.cwd(), slug, {
      production: env.isProduction,
    });
  } catch (error) {
    const notFound =
      (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
      (error instanceof Error &&
        /unknown employee|no local package|no available local source/i.test(
          error.message
        ));
    return c.json(
      {
        error: notFound
          ? "unknown employee or package unavailable"
          : "employee package unavailable",
      },
      notFound ? 404 : 500
    );
  }
  const etag = `"${pkg.sha256}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=0, must-revalidate");
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
  if (c.req.query("meta")) {
    return c.json({
      slug,
      filename: pkg.filename,
      version: pkg.version,
      sha256: pkg.sha256,
      files: pkg.files,
    });
  }
  c.header("Content-Type", "application/gzip");
  c.header("Content-Disposition", `attachment; filename="${pkg.filename}"`);
  c.header("X-Checksum-Sha256", pkg.sha256);
  c.header("Content-Length", String(pkg.gzip.length));
  return c.body(pkg.gzip as unknown as ArrayBuffer);
});

function remoteAddress(c: Context<AppEnv>) {
  return c.env?.incoming?.socket?.remoteAddress;
}

function localApiError(c: Context<AppEnv>, error: unknown) {
  const status =
    error instanceof LocalTeamError
      ? error.status
      : error instanceof LocalRequestError
        ? error.status
        : ((error as { status?: number })?.status ?? 500);
  const body = {
    error:
      error instanceof Error
        ? error.message
        : "Local CrewClaw state is unavailable.",
    code:
      error instanceof LocalTeamError
        ? error.code
        : status === 500
          ? "LOCAL_STATE_UNAVAILABLE"
          : "LOCAL_REQUEST_REJECTED",
  };
  if (status === 400) return c.json(body, 400);
  if (status === 403) return c.json(body, 403);
  if (status === 404) return c.json(body, 404);
  if (status === 409) return c.json(body, 409);
  if (status === 413) return c.json(body, 413);
  if (status === 415) return c.json(body, 415);
  if (status === 422) return c.json(body, 422);
  console.error("Local state API failed:", error);
  return c.json(body, 500);
}

app.get("/api/local/team", async c => {
  try {
    assertLocalApiRequest(c.req.raw, { remoteAddress: remoteAddress(c) });
    return c.json({
      team: await readLocalTeam(),
      source: ".crewclaw/team.json",
    });
  } catch (error) {
    return localApiError(c, error);
  }
});

app.post("/api/local/team/hire", async c => {
  try {
    assertLocalApiRequest(c.req.raw, {
      remoteAddress: remoteAddress(c),
      mutation: true,
    });
    const result = await hireLocalEmployee(await readSmallJsonBody(c.req.raw));
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    return localApiError(c, error);
  }
});

app.post("/api/local/team/fire", async c => {
  try {
    assertLocalApiRequest(c.req.raw, {
      remoteAddress: remoteAddress(c),
      mutation: true,
    });
    return c.json(await fireLocalEmployee(await readSmallJsonBody(c.req.raw)));
  } catch (error) {
    return localApiError(c, error);
  }
});

app.get("/api/local/employees/:slug/performance", async c => {
  try {
    assertLocalApiRequest(c.req.raw, { remoteAddress: remoteAddress(c) });
    const slug = c.req.param("slug");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return c.json({ error: "Invalid employee id." }, 400);
    }
    return c.json(await readLocalEmployeePerformance(slug));
  } catch (error) {
    return localApiError(c, error);
  }
});

app.post("/api/local/employees/:slug/reviews", async c => {
  try {
    assertLocalApiRequest(c.req.raw, {
      remoteAddress: remoteAddress(c),
      mutation: true,
    });
    const slug = c.req.param("slug");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return c.json({ error: "Invalid employee id." }, 400);
    }
    return c.json(
      await submitVerifiedReview(slug, await readSmallJsonBody(c.req.raw)),
      201
    );
  } catch (error) {
    return localApiError(c, error);
  }
});

app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  const hostname = process.env.HOST || "127.0.0.1";
  serve({ fetch: app.fetch, hostname, port }, () => {
    console.log(`Server running on http://${hostname}:${port}/`);
  });
}
