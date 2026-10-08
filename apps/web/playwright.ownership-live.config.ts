import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.OWNERSHIP_QA_BASE_URL;
if (!baseURL || !process.env.OWNERSHIP_QA_FIXTURES || !process.env.OWNERSHIP_QA_PREFLIGHT_DSN) {
  throw new Error(
    "BLOCKED: OWNERSHIP_QA_BASE_URL, OWNERSHIP_QA_FIXTURES and OWNERSHIP_QA_PREFLIGHT_DSN are required",
  );
}
const target = new URL(baseURL);
if (
  target.username ||
  target.password ||
  target.search ||
  target.hash ||
  !["https:", "http:"].includes(target.protocol)
) {
  throw new Error("BLOCKED: invalid QA URL");
}
if (process.env.OWNERSHIP_QA_ENVIRONMENT !== "nchat-dev" && target.hostname !== "127.0.0.1") {
  throw new Error("BLOCKED: select nchat-dev or a disposable loopback environment");
}

export default defineConfig({
  testDir: "./e2e/ownership-live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["./e2e/ownership-live/reporter.ts"]],
  // Traces/HAR contain bearer headers and private API/WS payloads. Keep them off.
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    {
      name: "chromium-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
