import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const sourceUrl = "https://github.com/staruhub/CrewClaw";

test("production advertises source setup without an unpublished package command", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("pnpm dlx @chaogeek/hermes");
  expect(body).not.toContain("pnpm --silent -C");
  await expect(
    page.getByRole("button", { name: /copy crewclaw/i })
  ).toHaveCount(0);
  await expect(
    page.getByText("Local setup", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText(/public package distribution is not available yet/i).first()
  ).toBeVisible();

  const sourceLinks = page.getByRole("link", { name: /view source/i });
  expect(await sourceLinks.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await sourceLinks.count()); index++) {
    await expect(sourceLinks.nth(index)).toHaveAttribute("href", sourceUrl);
  }

  await page.goto("/employee/code-review-shrimp");
  const detailBody = await page.locator("body").innerText();
  expect(detailBody).not.toContain("pnpm dlx @chaogeek/hermes");
  await expect(
    page.getByText(/public package distribution is pending/i)
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("production serves the downloadable employee package through Hono", async ({
  request,
}) => {
  const metadataResponse = await request.get(
    "/api/employees/ai-adoption-whale/package?meta=1"
  );
  expect(metadataResponse.status()).toBe(200);
  expect(metadataResponse.headers()["content-type"]).toContain(
    "application/json"
  );
  expect(metadataResponse.headers()["etag"]).toMatch(/^"[a-f0-9]{64}"$/);
  expect(metadataResponse.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate"
  );

  const metadata = (await metadataResponse.json()) as {
    slug: string;
    filename: string;
    version: string;
    sha256: string;
    files: string[];
  };
  expect(metadata.slug).toBe("ai-adoption-whale");
  expect(metadata.filename).toBe(
    `ai-adoption-whale-${metadata.version}.tar.gz`
  );
  expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(metadata.files).toEqual(
    expect.arrayContaining([
      "hire.yaml",
      "crewclaw.employee.yaml",
      "distribution.yaml",
      "SOUL.md",
    ])
  );

  const packageResponse = await request.get(
    "/api/employees/ai-adoption-whale/package"
  );
  expect(packageResponse.status()).toBe(200);
  const headers = packageResponse.headers();
  expect(headers["content-type"]).toContain("application/gzip");
  expect(headers["content-disposition"]).toBe(
    `attachment; filename="${metadata.filename}"`
  );
  expect(headers["x-checksum-sha256"]).toBe(metadata.sha256);

  const archive = await packageResponse.body();
  expect([...archive.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  expect(createHash("sha256").update(archive).digest("hex")).toBe(
    metadata.sha256
  );

  const notModified = await request.get(
    "/api/employees/ai-adoption-whale/package",
    { headers: { "If-None-Match": `"${metadata.sha256}"` } }
  );
  expect(notModified.status()).toBe(304);
  expect((await notModified.body()).length).toBe(0);
});

test("production package endpoint returns 404 for an unknown employee", async ({
  request,
}) => {
  const response = await request.get(
    "/api/employees/employee-that-does-not-exist/package?meta=1"
  );
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringMatching(/unknown employee/i),
  });
});
