import { randomBytes } from "node:crypto";
import { createProductViaUi, createStoreViaUi, expect, signUpAndIn, test, waitForHydration, db } from "../e2e/helpers";

const PORT = Number(process.env.SMOKE_PORT ?? 8443);
const root = `https://localhost:${PORT}`;
const label = `smoke-${randomBytes(3).toString("hex")}`;

test.afterAll(() => db.$disconnect());

test.describe("production stack through Caddy", () => {
  test("readiness, security headers (incl. HSTS over https) and the neutral 404 for unknown hosts", async ({ request }) => {
    const ready = await request.get(`${root}/api/ready`);
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready", checks: { api: "ok", database: "ok", storage: "ok" } });

    const home = await request.get(`${root}/`);
    const h = home.headers();
    expect(h["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(h["content-security-policy"]).toContain("upgrade-insecure-requests");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(h["server"], "Caddy's Server header is removed").toBeUndefined();
    expect(h["x-powered-by"]).toBeUndefined();

    // A forged X-Forwarded-Host must not select a store: the application only trusts the raw Host (and Caddy removes the header).
    const forged = await request.get(`${root}/`, { headers: { "x-forwarded-host": `${label}.localhost:${PORT}` } });
    expect(forged.status()).toBe(200);
    expect(await forged.text()).toContain("فروشگاه اینترنتی خود را در چند دقیقه بسازید"); // the platform landing page, never a store
  });

  test("register, sign in, create a store and a product, claim a subdomain, publish and read the live store over its wildcard host", async ({ page }) => {
    // Invite-only registration (the production default): the code comes from `pnpm platform:admin invite` in the worker image.
    expect(process.env.SMOKE_INVITE, "ci-container-smoke.sh passes SMOKE_INVITE").toBeTruthy();
    await signUpAndIn(page, process.env.SMOKE_INVITE); // Argon2 (native module in the image) + PostgreSQL + migrations
    const storeId = await createStoreViaUi(page, "فروشگاه دودی", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "کالای آزمایشی", price: "1000", stock: "2", slug: "smoke-item" });
    await page.goto(`/dashboard/stores/${storeId}/products`);
    await page.getByTestId("product-row").filter({ hasText: "کالای آزمایشی" }).getByRole("button", { name: "فعال‌سازی" }).click();
    await page.waitForURL(/notice=status-activated/);

    await page.goto(`/dashboard/stores/${storeId}/publish`);
    await waitForHydration(page, "[data-testid=subdomain-input]");
    await page.fill("[data-testid=subdomain-input]", label);
    await page.getByRole("button", { name: /ثبت زیردامنه|تغییر زیردامنه/ }).click();
    await expect(page.getByTestId("current-subdomain")).toContainText(label);
    await page.goto(`/dashboard/stores/${storeId}/publish`);
    await waitForHydration(page, "[data-testid=publish-button]");
    await page.getByTestId("publish-button").click();
    await expect(page.getByTestId("publish-success")).toContainText("منتشر شد");

    // TLS name stays localhost (the certificate); the Host header selects the store, exactly as the wildcard DNS name would.
    const asStore = (path: string) => page.request.get(`${root}${path}`, { headers: { host: `${label}.localhost:${PORT}` }, failOnStatusCode: false });
    const live = await asStore("/products/smoke-item");
    expect(live.status()).toBe(200);
    expect(await live.text()).toContain("کالای آزمایشی");
    expect(live.headers()["strict-transport-security"]).toContain("max-age=31536000");
    const robots = await asStore("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`https://${label}.localhost:${PORT}/sitemap.xml`);
    const sitemap = await asStore("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
  });
});
