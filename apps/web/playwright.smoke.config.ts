import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test of the PRODUCTION container stack (phase 13, CI job "Container images and production-stack smoke test"):
 * Caddy (TLS) -> app (standalone image) -> PostgreSQL, with the migrate job already applied. The stack is started by
 * scripts/ci-container-smoke.sh; this config only points a browser at it. APP_ROOT_DOMAIN of that stack is localhost:8443,
 * store hosts are <label>.localhost:8443 (Chromium resolves *.localhost to loopback), certificates are Caddy's internal CA.
 */
export const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 8443);

export default defineConfig({
  testDir: "./e2e-smoke",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  use: { baseURL: `https://localhost:${SMOKE_PORT}`, ignoreHTTPSErrors: true, locale: "fa-IR", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: [`--host-resolver-rules=MAP *.localhost 127.0.0.1`] } } }],
});
