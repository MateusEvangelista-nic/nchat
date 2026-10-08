import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Browser regression coverage with the API/WS mocks in ownership.spec.ts.
// Real integration remains in playwright.ownership-live.config.ts.
export default defineConfig({
  ...base,
  testMatch: "messaging/ownership.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5181", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    {
      name: "chromium-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5181 --strictPort",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
