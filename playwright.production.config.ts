import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PRODUCTION_PORT ?? 3273);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-distribution.spec.ts",
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
    command: "pnpm run build:web && pnpm start",
    env: {
      NODE_ENV: "production",
      PORT: String(port),
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 500,
    },
  },
  projects: [
    {
      name: "production-chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome",
      },
    },
  ],
});
