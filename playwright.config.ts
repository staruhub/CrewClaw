import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/._*"],
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
  webServer: {
    command: `pnpm run dev --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 500,
    },
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" },
    },
  ],
});
