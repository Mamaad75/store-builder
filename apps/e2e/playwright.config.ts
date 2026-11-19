import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { getTestStorageEnv } from "./src/storage-env";

const PORT = 3100;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const API_PORT = 4100;
/** The NestJS API of the E2E stack (ADR 0001, N3). Production build, own process, same isolated database. */
export const E2E_API_URL = `http://127.0.0.1:${API_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_e2e";

/** Outbox of the file mail transport (decision D12-2): the E2E suite reads password-reset links from here. Test-only; never a provider. */
export const E2E_MAIL_DIR = path.join(os.tmpdir(), "store-builder-e2e-mail");

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
  // E2E_BROWSER_CHANNEL (local only, e.g. "chrome" or "msedge") runs the suite on an installed Chromium-based browser instead of
  // Playwright's own build, whose download CDN refuses Iranian networks. CI leaves it unset and uses Playwright's Chromium.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) },
    },
  ],
  webServer: [
    {
      // The API first: the web app asks it who is signed in. Production build against the isolated database.
      cwd: REPO_ROOT,
      command: "pnpm --filter @store-builder/api build && pnpm --filter @store-builder/api start",
      url: `${E2E_API_URL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "production",
        DATABASE_URL: E2E_DATABASE_URL,
        AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0123456789",
        APP_ROOT_DOMAIN: `localhost:${PORT}`,
        APP_PROTOCOL: "http",
        // The tests act as the trusted proxy: they set X-Forwarded-For per test to get isolated buckets (one hop).
        TRUST_PROXY_HOPS: "1",
        API_HOST: "127.0.0.1",
        API_PORT: String(API_PORT),
        RATE_LIMIT_BACKEND: "postgres",
        // Isolated "-e2e" bucket on a local S3-compatible server (MinIO in CI); never production storage (see src/storage-env.ts).
        ...getTestStorageEnv("e2e"),
      },
    },
    {
    // Production build against an isolated database; never touches the dev database.
    // The standalone bundle is what the container runs (scripts/run-standalone.sh copies it out of the repository first).
    cwd: REPO_ROOT,
    command: `pnpm --filter @store-builder/web build && bash apps/web/scripts/run-standalone.sh ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      INTERNAL_API_URL: E2E_API_URL,
      // Store hosts are <label>.localhost:3100 (Chromium resolves *.localhost to loopback; other clients set the Host header).
      APP_ROOT_DOMAIN: `localhost:${PORT}`,
      APP_PROTOCOL: "http",
      // The web app only builds public image URLs: the credentials belong to the API (above).
      S3_PUBLIC_BASE_URL: getTestStorageEnv("e2e").S3_PUBLIC_BASE_URL,
      // The tests act as the trusted proxy: they set X-Forwarded-For per test to get isolated buckets.
      MAIL_TRANSPORT: "file",
      MAIL_OUTBOX_DIR: E2E_MAIL_DIR,
      // The E2E server is a production build: the file outbox needs the explicit test-only override (loopback host only).
      MAIL_E2E_FILE_OUTBOX_OVERRIDE: "1",
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_PROXY_HOPS: "1",
    },
  },
  ],
});
