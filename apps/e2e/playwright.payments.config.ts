import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { getTestStorageEnv } from "./src/storage-env";

/**
 * D-E2E-PAY (MVP roadmap §12.1, approved): the ISOLATED online-payment E2E stack, run as its own Playwright invocation
 * (`pnpm test:e2e:payments`), never at the same time as the main suite (playwright.config.ts).
 *
 *  - API: the same production build, started with NODE_ENV=test, the only mode in which ZARINPAL_DEV_BASE_URL is accepted
 *    (apps/api/src/config/env.ts). No production rule is changed or bypassed: a NODE_ENV=production API still refuses it at start-up.
 *  - Database: its own, whose name must end in "_e2e" (the global setup refuses any other).
 *  - Secrets: a test-only AUTH_SECRET, and a SECRETS_MASTER_KEYS envelope key generated per run (never a real key, never reused).
 *  - Gateway: a loopback fake Zarinpal (src/fake-zarinpal.mjs) accepting one fixed TEST merchant id; it moves no money.
 *  - The test API and the fake gateway bind to 127.0.0.1 only. The web binds like the main E2E web (0.0.0.0): the Next standalone server's
 *    host-based store routing does not work when it is bound to 127.0.0.1 (store hosts answer 404 without calling the API). The web holds
 *    no secret and no gateway access; it only proxies to the loopback API. CI runners accept no inbound connections.
 *
 * It uses the SAME ports as the main stack on purpose: the web build fixes its /api proxy target (next.config.ts rewrites) at build time,
 * so a second web server on another port would still talk to the main API. Running the two stacks one after the other avoids that.
 */
const PORT = 3100;
const API_PORT = 4100;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const FAKE_ZARINPAL_PORT = 4180; // not 4190: it is on the Fetch standard's blocked-port list (undici refuses it)
export const FAKE_ZARINPAL_URL = `http://127.0.0.1:${FAKE_ZARINPAL_PORT}`;
export const TEST_ZARINPAL_MERCHANT = "00000000-0000-4000-8000-00000000e2e1";
export const PAY_DATABASE_URL =
  process.env.E2E_PAY_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_payments_e2e";

/** Reuse an existing web build (CI: the main E2E run just built it from the same commit). Locally the web is rebuilt every time. */
const webBuild = process.env.E2E_REUSE_WEB_BUILD === "1" ? "" : "pnpm --filter @store-builder/web build && ";

export default defineConfig({
  testDir: "./e2e-payments",
  outputDir: "./test-results-payments", // the main run's failure traces (test-results/) are kept
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["github"], ["json", { outputFile: "playwright-report/payments-results.json" }]]
    : [["list"]],
  globalSetup: "./e2e-payments/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "fa-IR", trace: "retain-on-failure" },
  projects: [
    {
      name: "payments",
      use: { ...devices["Desktop Chrome"], ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) },
    },
  ],
  webServer: [
    {
      cwd: REPO_ROOT,
      command: `node apps/e2e/src/fake-zarinpal.mjs ${FAKE_ZARINPAL_PORT} ${TEST_ZARINPAL_MERCHANT} .localhost:${PORT}`,
      url: `${FAKE_ZARINPAL_URL}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      cwd: REPO_ROOT,
      command: "pnpm --filter @store-builder/api build && pnpm --filter @store-builder/api start",
      url: `${API_URL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: PAY_DATABASE_URL,
        AUTH_SECRET: "e2e-payments-only-secret-0123456789abcdef",
        SECRETS_MASTER_KEYS: `e2e:${randomBytes(32).toString("base64")}`,
        SECRETS_ACTIVE_KEY_ID: "e2e",
        ZARINPAL_DEV_BASE_URL: FAKE_ZARINPAL_URL,
        AQAYEPARDAKHT_DEV_BASE_URL: "",
        CUSTOMER_OTP_DEV_LOG: "",
        APP_ROOT_DOMAIN: `localhost:${PORT}`,
        APP_PROTOCOL: "http",
        TRUST_PROXY_HOPS: "1",
        API_HOST: "127.0.0.1",
        API_PORT: String(API_PORT),
        RATE_LIMIT_BACKEND: "postgres",
        ...getTestStorageEnv("e2e"),
      },
    },
    {
      cwd: REPO_ROOT,
      command: `${webBuild}bash apps/web/scripts/run-standalone.sh ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        INTERNAL_API_URL: API_URL,
        API_DEV_PROXY_URL: API_URL,
        APP_ROOT_DOMAIN: `localhost:${PORT}`,
        APP_PROTOCOL: "http",
        S3_PUBLIC_BASE_URL: getTestStorageEnv("e2e").S3_PUBLIC_BASE_URL,
        TRUST_PROXY_HEADERS: "true",
        TRUSTED_PROXY_HOPS: "1",
      },
    },
  ],
});
