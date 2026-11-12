import { randomBytes } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { expect, test } from "./helpers";

/**
 * The E2E server is a PRODUCTION build (`next start`, NODE_ENV=production) with APP_ROOT_DOMAIN=localhost:3100, so these tests
 * exercise the production host policy: only the configured root domain, www.<root> and valid store subdomains are accepted.
 * Requests go to 127.0.0.1 with an explicit Host header (the Host header is the only thing the application trusts).
 */
const PORT = 3100;
const label = () => `hp-${randomBytes(4).toString("hex")}`;

async function asHost(page: Page, host: string | null, path: string, headers: Record<string, string> = {}): Promise<APIResponse> {
  return page.request.get(`http://127.0.0.1:${PORT}${path}`, { headers: { ...(host === null ? {} : { host }), ...headers }, maxRedirects: 0, failOnStatusCode: false });
}
const visibleText = async (r: APIResponse) => (await r.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const PATHS = ["/", "/login", "/register", "/dashboard", "/api/health", "/api/auth/session", "/preview/abc", "/products/x", "/nonexistent"];

test.describe("production host policy: only the configured root domain and valid store subdomains are accepted", () => {
  test("the configured platform hosts (root domain and www) work", async ({ page }) => {
    for (const host of [`localhost:${PORT}`, `www.localhost:${PORT}`, `LOCALHOST:${PORT}`]) {
      const health = await asHost(page, host, "/api/health");
      expect(health.status(), host).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      expect((await asHost(page, host, "/login")).status(), host).toBe(200);
    }
  });

  test("unknown hosts get the neutral 404 on every path: foreign domains, IP hosts, nested labels, wrong ports, no port", async ({ page }) => {
    const l = label();
    const unknown = [
      "evil.com",
      `evil.com:${PORT}`,
      `127.0.0.1:${PORT}`, // IP-based host
      "127.0.0.1",
      `[::1]:${PORT}`,
      `10.0.0.5:${PORT}`,
      "localhost", // right name, missing port
      "localhost:3101", // right name, wrong port
      `${l}.localhost:3101`, // store-shaped, wrong port
      `${l}.localhost`, // store-shaped, no port
      `a.${l}.localhost:${PORT}`, // nested label
      `admin.localhost:${PORT}`, // reserved label
      `localhost:${PORT}.evil.com`,
      `${l}.localhost:${PORT}.evil.com`,
    ];
    let reference: string | null = null;
    for (const host of unknown) {
      for (const path of PATHS) {
        const r = await asHost(page, host, path);
        expect(r.status(), `${host} ${path}`).toBe(404);
        expect(r.headers()["location"], `${host} ${path}`).toBeUndefined();
        expect(r.headers()["set-cookie"], `${host} ${path}`).toBeUndefined();
        const text = await visibleText(r);
        // never the platform's login form, landing page or health payload
        expect(text, `${host} ${path}`).not.toContain("ورود");
        expect(text, `${host} ${path}`).not.toContain('"status":"ok"');
        reference ??= text;
        expect(text, `${host} ${path}`).toBe(reference); // one identical neutral 404 for all of them
      }
    }
  });

  test("a rejected host looks exactly like an unknown store to a visitor (same status, same rendered page)", async ({ page }) => {
    // Rendered text in a real browser (the unknown-store page streams its body, so raw HTML is not the right thing to compare).
    const store = await page.goto(`http://nobody-${label()}.localhost:${PORT}/`);
    expect(store!.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const storeText = (await page.locator("body").innerText()).trim();
    const host = await page.goto(`http://127.0.0.1:${PORT}/`); // IP-based host: rejected
    expect(host!.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(host!.headers()["cache-control"]).toContain("no-store");
    expect(store!.headers()["cache-control"]).toContain("no-store");
    expect((await page.locator("body").innerText()).trim()).toBe(storeText);
  });

  test("forwarded-host style headers never make an unknown host acceptable, nor change an accepted one", async ({ page }) => {
    const spoof = {
      "x-forwarded-host": `localhost:${PORT}`,
      forwarded: `host=localhost:${PORT};proto=http`,
      "x-original-host": `localhost:${PORT}`,
      "x-host": `localhost:${PORT}`,
      "x-forwarded-server": `localhost:${PORT}`,
    };
    for (const path of ["/", "/login", "/api/health", "/dashboard"]) {
      const r = await asHost(page, "evil.com", path, spoof);
      expect(r.status(), path).toBe(404);
    }
    // an accepted Host is not affected by a hostile forwarded header either
    const ok = await asHost(page, `localhost:${PORT}`, "/api/health", { "x-forwarded-host": "evil.com", forwarded: "host=evil.com" });
    expect(ok.status()).toBe(200);
  });

  test("the missing-Host case is rejected too (HTTP/1.1 requires a Host; none is never the platform)", async ({ page }) => {
    // Playwright always sends a Host header derived from the URL (127.0.0.1:3100 here), which the policy rejects.
    const r = await asHost(page, null, "/login");
    expect(r.status()).toBe(404);
  });

  test("in a real browser an IP-based address is a 404, while the configured name works", async ({ page }) => {
    const ip = await page.goto(`http://127.0.0.1:${PORT}/login`);
    expect(ip!.status()).toBe(404);
    await expect(page.locator("input[name=email]")).toHaveCount(0);
    const ok = await page.goto(`http://localhost:${PORT}/login`);
    expect(ok!.status()).toBe(200);
    await expect(page.locator("input[name=email]")).toBeVisible();
  });
});
