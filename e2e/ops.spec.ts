import { expect, test } from "./helpers";

const PORT = 3100;

test.describe("production readiness endpoints and security headers", () => {
  test("/api/ready answers 200 with both dependencies ok on the platform host, and never on any other host", async ({ request }) => {
    const ok = await request.get(`http://localhost:${PORT}/api/ready`);
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ status: "ready", checks: { database: "ok", storage: "ok" } });
    expect(ok.headers()["cache-control"]).toBe("no-store");
    for (const host of ["evil.com", `shop.localhost:${PORT}`]) {
      const res = await request.get(`http://127.0.0.1:${PORT}/api/ready`, { headers: { host }, failOnStatusCode: false });
      expect(res.status(), host).toBe(404);
    }
  });

  test("every response carries the CSP (with the media origin), COOP and Permissions-Policy: pages, the neutral 404 and unknown hosts alike", async ({ request }) => {
    const urls: [string, string?][] = [
      [`http://localhost:${PORT}/`],
      [`http://localhost:${PORT}/login`],
      [`http://localhost:${PORT}/no-such-page`],
      [`http://127.0.0.1:${PORT}/`, "evil.com"],
      [`http://127.0.0.1:${PORT}/`, `nobody.localhost:${PORT}`],
    ];
    for (const [url, host] of urls) {
      const res = await request.get(url, { headers: host ? { host } : {}, failOnStatusCode: false });
      const h = res.headers();
      expect(h["content-security-policy"], `${url} ${host ?? ""}`).toContain("default-src 'self'");
      expect(h["content-security-policy"]).toContain("img-src 'self' data: blob: http://127.0.0.1:9000");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
      expect(h["cross-origin-opener-policy"]).toBe("same-origin");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["strict-transport-security"], "no HSTS over plain http").toBeUndefined();
    }
  });

  test("the browser reports no CSP violation on the landing and login pages", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    for (const path of ["/", "/login", "/register"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
    }
    expect(violations).toEqual([]);
  });
});
