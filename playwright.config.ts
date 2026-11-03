import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "fa-IR", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build against an isolated database; never touches the dev database.
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0123456789",
      AUTH_TRUST_HOST: "true",
      RATE_LIMIT_BACKEND: "postgres",
      // The tests act as the trusted proxy: they set X-Forwarded-For per test to get isolated buckets.
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_PROXY_HOPS: "1",
    },
  },
});
