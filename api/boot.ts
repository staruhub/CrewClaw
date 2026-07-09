import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { buildEmployeePackage } from "./lib/pack-employee";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// v0.18 Phase 2: a REAL "download employee" — the gzipped package of experts/<slug>/ built from the
// registry's local_source (never a stranger's absolute path). Answers "网站上下载不了": now there's
// an actual artifact + sha256, not just a copyable command. ?meta=1 returns the manifest+checksum as
// JSON (so the site can show the sha before download); otherwise it streams the tarball.
app.get("/api/employees/:slug/package", (c) => {
  const slug = c.req.param("slug");
  if (!/^[a-z0-9-]+$/.test(slug)) return c.json({ error: "invalid slug" }, 400);
  let pkg;
  try {
    pkg = buildEmployeePackage(process.cwd(), slug);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
  }
  if (c.req.query("meta")) {
    return c.json({ slug, filename: pkg.filename, version: pkg.version, sha256: pkg.sha256, files: pkg.files });
  }
  c.header("Content-Type", "application/gzip");
  c.header("Content-Disposition", `attachment; filename="${pkg.filename}"`);
  c.header("X-Checksum-Sha256", pkg.sha256);
  return c.body(pkg.gzip as unknown as ArrayBuffer);
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}
