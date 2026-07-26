import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3173);
const baseURL = `http://127.0.0.1:${port}`;
const externalServer = process.env.CREWCLAW_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/._*", "**/production-distribution.spec.ts"],
  fullyParallel: false,
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalServer
    ? undefined
    : {
        command: `pnpm run dev --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome",
      },
    },
  ],
});
