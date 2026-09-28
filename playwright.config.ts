import { defineConfig, devices } from "@playwright/test";

// Must match APP_URL in .env.test (see tests/e2e/helpers.ts BASE_URL).
const baseURL = "http://localhost:3100";

/**
 * Browser journeys against the production build and a seeded TEST database.
 * Requires PostgreSQL (roles from `npm run db:bootstrap`) and Mailpit on :1025/:8025.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
