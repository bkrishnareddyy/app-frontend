import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A cold dev server compiles each route on first request, and that can pass
  // 30s under parallel load. Raising the budget keeps the guard deterministic;
  // a retry would have hidden the latency instead of allowing for it.
  timeout: 90_000,
  // A retry hides a flaky guard, and a guard that is flaky is a guard that failed.
  retries: 0,
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev --port 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
