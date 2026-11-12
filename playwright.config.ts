import { defineConfig, devices } from "@playwright/test";
import { getTestStorageEnv } from "./src/test/storage-env";

const PORT = 3100;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // One retry in CI only. A test that passes on retry is reported as "flaky" (see scripts/ci-summarize-playwright.mjs),
  // never as a plain pass. Local runs never retry.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["github"], ["json", { outputFile: "playwright-report/results.json" }]]
    : [["list"]],
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
      // Store hosts are <label>.localhost:3100 (Chromium resolves *.localhost to loopback; other clients set the Host header).
      APP_ROOT_DOMAIN: `localhost:${PORT}`,
      APP_PROTOCOL: "http",
      // Isolated "-e2e" bucket on a local S3-compatible server (MinIO in CI); never production storage (see src/test/storage-env.ts).
      ...getTestStorageEnv("e2e"),
      // The tests act as the trusted proxy: they set X-Forwarded-For per test to get isolated buckets.
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_PROXY_HOPS: "1",
    },
  },
});
