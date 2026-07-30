import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PRODUCTION_PORT ?? 3273);
const baseURL = `http://127.0.0.1:${port}`;
const externalServer = process.env.CREWCLAW_E2E_EXTERNAL_SERVER === "1";
const browserExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim();

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
  webServer: externalServer
    ? undefined
    : {
        command: "pnpm run build && pnpm start",
        env: {
          NODE_ENV: "production",
          PORT: String(port),
        },
        url: baseURL,
        reuseExistingServer: false,
        timeout: 240_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "production-chrome",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserExecutable
          ? { launchOptions: { executablePath: browserExecutable } }
          : {
              channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome",
            }),
      },
    },
  ],
});
