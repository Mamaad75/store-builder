import { randomBytes } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { createCategoryViaUi, createProductViaUi, createStoreViaUi, db, expect, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());

const PORT = 3100;
const label = () => `seo-${randomBytes(4).toString("hex")}`;
const origin = (l: string) => `http://${l}.localhost:${PORT}`;
const publishUrl = (storeId: string) => `/dashboard/stores/${storeId}/publish`;

async function asHost(page: Page, host: string, path: string): Promise<APIResponse> {
  return page.request.get(`http://127.0.0.1:${PORT}${path}`, { headers: { host }, maxRedirects: 0, failOnStatusCode: false });
}

async function claim(page: Page, storeId: string, l: string) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=subdomain-input]");
  await page.fill("[data-testid=subdomain-input]", l);
  await page.getByRole("button", { name: /ثبت زیردامنه|تغییر زیردامنه/ }).click();
  await expect(page.getByTestId("current-subdomain")).toContainText(l);
}

/** A fresh page load per step: the claim/publish/unpublish messages share one test id. */
async function publishNow(page: Page, storeId: string) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=publish-button]");
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("publish-success")).toContainText("منتشر شد");
}

async function unpublishNow(page: Page, storeId: string) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=unpublish-button]");
  await page.getByTestId("unpublish-button").click();
  await expect(page.getByTestId("publish-success")).toBeVisible();
}

async function claimAndPublish(page: Page, storeId: string, l: string) {
  await claim(page, storeId, l);
  await publishNow(page, storeId);
}

async function activate(page: Page, storeId: string, name: string) {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await page.getByTestId("product-row").filter({ hasText: name }).getByRole("button", { name: "فعال‌سازی" }).click();
  await page.waitForURL(/notice=status-activated/);
}

async function setDescription(page: Page, storeId: string, text: string) {
  await page.goto(`/dashboard/stores/${storeId}`);
  await waitForHydration(page, "textarea[name=description]");
  await page.fill("textarea[name=description]", text);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).first().click();
  await expect(page.locator(".MuiAlert-message").filter({ hasText: "تغییرات ذخیره شد." })).toBeVisible();
}

const meta = (page: Page, sel: string) => page.locator(sel).first().getAttribute("content");
const jsonLd = async (page: Page) => (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);

test.describe("SEO: metadata, canonical, structured data, robots.txt and sitemap.xml of a published store", () => {
  test("home, listing and product pages carry correct titles, descriptions, canonical, Open Graph, Twitter and JSON-LD", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه سئو", "فروشگاه عمومی");
    await setDescription(page, storeId, "فروشگاه چای و قهوه با ارسال سریع");
    await createCategoryViaUi(page, storeId, "چای");
    await createProductViaUi(page, storeId, { name: "چای ممتاز", price: "125000", stock: "3", slug: "premium-tea", category: "چای" });
    await createProductViaUi(page, storeId, { name: "قهوه تمام‌شده", price: "50000", stock: "0", slug: "sold-out-coffee" });
    await activate(page, storeId, "چای ممتاز");
    await activate(page, storeId, "قهوه تمام‌شده");
    const l = label();
    await claimAndPublish(page, storeId, l);

    // the visitor: a fresh context without the owner's session
    const visitor = await page.context().browser()!.newContext();
    const v = await visitor.newPage();

    // ---- home
    expect((await v.goto(`${origin(l)}/`))!.status()).toBe(200);
    expect(await v.title()).toBe("فروشگاه سئو"); // the store name only: no platform suffix
    expect(await meta(v, 'meta[name="description"]')).toBe("فروشگاه چای و قهوه با ارسال سریع");
    expect(await v.locator('link[rel="canonical"]').getAttribute("href")).toBe(`${origin(l)}/`);
    expect(await meta(v, 'meta[name="robots"]')).toMatch(/index/);
    expect(await meta(v, 'meta[name="robots"]')).not.toMatch(/noindex/);
    expect(await meta(v, 'meta[property="og:title"]')).toBe("فروشگاه سئو");
    expect(await meta(v, 'meta[property="og:url"]')).toBe(`${origin(l)}/`);
    expect(await meta(v, 'meta[property="og:site_name"]')).toBe("فروشگاه سئو");
    expect(await meta(v, 'meta[property="og:locale"]')).toBe("fa_IR");
    expect(await meta(v, 'meta[name="twitter:card"]')).toBe("summary");
    const home = await jsonLd(v);
    expect(home.map((d) => d["@type"])).toEqual(["Organization", "WebSite"]);
    expect(home[0]).toMatchObject({ name: "فروشگاه سئو", url: `${origin(l)}/`, description: "فروشگاه چای و قهوه با ارسال سریع" });

    // ---- listing: junk parameters collapse into the canonical URL
    await v.goto(`${origin(l)}/products?utm_source=x&page=zzz&fbclid=1`);
    expect(await v.locator('link[rel="canonical"]').getAttribute("href")).toBe(`${origin(l)}/products`);
    expect(await v.title()).toMatch(/\| فروشگاه سئو$/);
    expect(await jsonLd(v)).toEqual([]);

    // ---- product with stock
    await v.goto(`${origin(l)}/products/premium-tea`);
    expect(await v.title()).toBe("چای ممتاز | فروشگاه سئو");
    expect(await v.locator('link[rel="canonical"]').getAttribute("href")).toBe(`${origin(l)}/products/premium-tea`);
    const [product, crumbs] = await jsonLd(v);
    expect(product).toMatchObject({ "@type": "Product", name: "چای ممتاز", category: "چای", offers: { "@type": "Offer", priceCurrency: "IRR", price: "1250000", availability: "https://schema.org/InStock" } });
    expect((crumbs as { itemListElement: unknown[] }).itemListElement).toHaveLength(3);
    // ---- product out of stock
    await v.goto(`${origin(l)}/products/sold-out-coffee`);
    expect((await jsonLd(v))[0]).toMatchObject({ offers: { price: "500000", availability: "https://schema.org/OutOfStock" } });

    // a path that does not exist has no metadata of its own and is the neutral 404
    expect((await v.goto(`${origin(l)}/products/no-such-product`))!.status()).toBe(404);
    await visitor.close();
  });

  test("robots.txt and sitemap.xml of the store host: content, types, and the same neutral 404 for everything unavailable", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه نقشه", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "کالای اول", price: "1000", stock: "1", slug: "first-item" });
    await activate(page, storeId, "کالای اول");
    const l = label();
    const host = `${l}.localhost:${PORT}`;
    // before publishing (a claimed but unpublished store) and for an unknown label: 404 on both files
    await claim(page, storeId, l);
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      expect((await asHost(page, host, path)).status(), `unpublished ${path}`).toBe(404);
      expect((await asHost(page, `nobody-${l}.localhost:${PORT}`, path)).status(), `unknown ${path}`).toBe(404);
      expect((await asHost(page, "evil.com", path)).status(), `foreign host ${path}`).toBe(404);
    }

    await publishNow(page, storeId);

    const robots = await asHost(page, host, "/robots.txt");
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    expect(await robots.text()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${origin(l)}/sitemap.xml\n`);

    const sitemap = await asHost(page, host, "/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("application/xml");
    const xml = await sitemap.text();
    for (const path of ["/", "/products", "/about", "/contact", "/products/first-item"]) expect(xml).toContain(`<loc>${origin(l)}${path}</loc>`);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/lastmod>/);
    expect(xml).not.toContain("/dashboard");
    // a spoofed forwarded host never changes which store answers
    const spoof = await page.request.get(`http://127.0.0.1:${PORT}/sitemap.xml`, { headers: { host: "evil.com", "x-forwarded-host": host }, failOnStatusCode: false, maxRedirects: 0 });
    expect(spoof.status()).toBe(404);

    // taking the store offline makes both files the neutral 404 again
    await unpublishNow(page, storeId);
    for (const path of ["/robots.txt", "/sitemap.xml"]) expect((await asHost(page, host, path)).status(), `offline ${path}`).toBe(404);
  });

  test("hostile store data cannot break out of the structured-data script or the page head", async ({ page }) => {
    await signUpAndIn(page);
    const evilName = "x</script><script>window.__pwned=1</script>";
    const storeId = await createStoreViaUi(page, evilName, "فروشگاه عمومی");
    await setDescription(page, storeId, '<img src=x onerror="window.__pwned=2"> & <!-- ');
    const l = label();
    await claimAndPublish(page, storeId, l);
    const visitor = await page.context().browser()!.newContext();
    const v = await visitor.newPage();
    await v.goto(`${origin(l)}/`);
    expect(await v.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    const docs = await jsonLd(v); // every block still parses as JSON
    expect(docs[0]).toMatchObject({ "@type": "Organization", name: evilName });
    for (const raw of await v.locator('script[type="application/ld+json"]').allTextContents()) expect(raw).not.toMatch(/[<>]/);
    expect(await v.title()).toBe(evilName); // text, not markup
    expect(await v.locator("head img, head script:not([type]):not([src])").count()).toBe(0);
    await visitor.close();
  });
});

test.describe("SEO: the platform host", () => {
  test("robots.txt blocks the application, auth pages are noindex, unknown hosts get no robots.txt (the draft preview's noindex is covered in storefront.spec.ts)", async ({ page, request }) => {
    const res = await request.get(`http://localhost:${PORT}/robots.txt`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/User-Agent: \*/i);
    for (const p of ["/dashboard", "/preview", "/login", "/register", "/api/"]) expect(text).toContain(`Disallow: ${p}`);
    expect(text).toMatch(/Allow: \//);

    for (const path of ["/login", "/register"]) {
      await page.goto(path);
      expect(await meta(page, 'meta[name="robots"]'), path).toMatch(/noindex/);
    }
    // an unknown host never reaches any of it
    expect((await page.request.get(`http://127.0.0.1:${PORT}/robots.txt`, { headers: { host: "evil.com" }, failOnStatusCode: false })).status()).toBe(404);
  });
});
