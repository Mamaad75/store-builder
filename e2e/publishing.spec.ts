import { randomBytes } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import { createProductViaUi, createStoreViaUi, db, expect, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());

const PORT = 3100;
const label = () => `e2e-${randomBytes(4).toString("hex")}`;
const storeUrl = (l: string, path = "/") => `http://${l}.localhost:${PORT}${path}`;
const publishUrl = (storeId: string) => `/dashboard/stores/${storeId}/publish`;

/** A raw request to the server with an arbitrary Host header (nothing else decides which store answers). */
async function asHost(page: Page, host: string, path: string, headers: Record<string, string> = {}): Promise<APIResponse> {
  return page.request.get(`http://127.0.0.1:${PORT}${path}`, { headers: { host, ...headers }, maxRedirects: 0, failOnStatusCode: false });
}

async function claim(page: Page, storeId: string, l: string) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=subdomain-input]");
  await page.fill("[data-testid=subdomain-input]", l);
  await page.getByRole("button", { name: /ثبت زیردامنه|تغییر زیردامنه/ }).click();
  await expect(page.getByTestId("current-subdomain")).toContainText(l);
}

async function publish(page: Page, storeId: string) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=publish-button]");
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("publish-success")).toContainText("منتشر شد");
}

async function setLive(page: Page, storeId: string, version: number) {
  await page.goto(publishUrl(storeId));
  await waitForHydration(page, "[data-testid=publish-button]");
  await page.locator(`[data-testid=version-row][data-version="${version}"]`).getByTestId("set-live-button").click();
  await expect(page.getByTestId("publish-success")).toBeVisible();
}

async function activateProduct(page: Page, storeId: string, name: string) {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await page.getByTestId("product-row").filter({ hasText: name }).getByRole("button", { name: "فعال‌سازی" }).click();
  await expect(page.getByTestId("product-row").filter({ hasText: name })).toContainText("فعال");
}

test.describe("publishing and host routing", () => {
  test("claim, publish, public site shows only the snapshot, draft edits stay private until the next publish", async ({ page, browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه زنده", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "کتری زنده", price: "1000", stock: "3", slug: "kettle" });
    await createProductViaUi(page, storeId, { name: "پیش‌نویس محرمانه", price: "5", stock: "1" });
    await activateProduct(page, storeId, "کتری زنده");
    const l = label();

    // publishing needs a claimed subdomain
    await page.goto(publishUrl(storeId));
    await expect(page.getByTestId("publish-button")).toBeDisabled();
    await claim(page, storeId, l);

    // an anonymous visitor (a separate context: no session) before publishing: neutral 404
    const visitor = await browser.newContext();
    const vp = await visitor.newPage();
    expect((await vp.goto(storeUrl(l)))!.status()).toBe(404);

    await publish(page, storeId);
    const res = await vp.goto(storeUrl(l));
    expect(res!.status()).toBe(200);
    await expect(vp.getByText("کتری زنده").first()).toBeVisible();
    await expect(vp.getByText("پیش‌نویس محرمانه")).toHaveCount(0);
    await expect(vp.locator("meta[name=robots]")).toHaveCount(0); // a live store is indexable; the draft preview is not

    // a draft edit does not reach the public site
    await page.goto(`/dashboard/stores/${storeId}/products`);
    await createProductViaUi(page, storeId, { name: "محصول بعد از انتشار", price: "9", stock: "1" });
    await activateProduct(page, storeId, "محصول بعد از انتشار");
    await vp.goto(storeUrl(l));
    await expect(vp.getByText("محصول بعد از انتشار")).toHaveCount(0);

    // publishing the same content again is refused as "no changes"; a new draft change publishes as version 2
    await publish(page, storeId);
    await vp.goto(storeUrl(l));
    await expect(vp.getByText("محصول بعد از انتشار").first()).toBeVisible();
    await page.goto(publishUrl(storeId));
    await waitForHydration(page, "[data-testid=publish-button]");
    await page.getByTestId("publish-button").click();
    await expect(page.getByTestId("publish-error")).toContainText("تفاوتی ندارد");
    expect(await db.storeVersion.count({ where: { storeId } })).toBe(2);

    // unpublish -> 404, republish an old version -> live again with that version's content
    await page.getByTestId("unpublish-button").click();
    await expect(page.getByTestId("publish-success")).toBeVisible();
    expect((await vp.goto(storeUrl(l)))!.status()).toBe(404);
    await setLive(page, storeId, 1);
    expect((await vp.goto(storeUrl(l)))!.status()).toBe(200);
    await expect(vp.getByText("محصول بعد از انتشار")).toHaveCount(0);
    await visitor.close();
  });

  test("a renamed product slug 301-redirects, also after a rollback; deleted products and never-published slugs are plain 404s", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه تغییرمسیر", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "کتری", price: "1000", stock: "3", slug: "kettle" });
    await activateProduct(page, storeId, "کتری");
    const l = label();
    await claim(page, storeId, l);
    await publish(page, storeId); // v1: /products/kettle
    const host = `${l}.localhost:${PORT}`;
    expect((await asHost(page, host, "/products/kettle")).status()).toBe(200);

    const product = await db.product.findFirstOrThrow({ where: { storeId, slug: "kettle" } });
    await page.goto(`/dashboard/stores/${storeId}/products/${product.id}`);
    await waitForHydration(page, "form:has(input[name=price])");
    await page.fill("input[name=slug]", "kettle-new");
    await page.getByLabel(/تغییر آدرس را تأیید می‌کنم/).check();
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("تغییرات محصول ذخیره شد.")).toBeVisible();
    await publish(page, storeId); // v2: /products/kettle-new, old slug redirects

    const redirect = await asHost(page, host, "/products/kettle?utm=1");
    expect(redirect.status()).toBe(301);
    expect(redirect.headers()["location"]).toBe(`http://${host}/products/kettle-new?utm=1`);
    expect(redirect.headers()["cache-control"]).toContain("no-store");
    expect((await asHost(page, host, "/products/kettle-new")).status()).toBe(200);

    // roll back to v1: the old slug is the real page again and the new one redirects back (nothing cached, nothing stuck)
    await setLive(page, storeId, 1);
    expect((await asHost(page, host, "/products/kettle")).status()).toBe(200);
    const back = await asHost(page, host, "/products/kettle-new");
    expect(back.status()).toBe(301);
    expect(back.headers()["location"]).toBe(`http://${host}/products/kettle`);

    // a slug that never existed is a 404, not a redirect
    expect((await asHost(page, host, "/products/never-published")).status()).toBe(404);
  });

  test("every unavailable case is the same neutral 404; no dashboard, auth, api or preview is reachable on a store host", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه خاموش", "فروشگاه عمومی");
    const l = label();
    await claim(page, storeId, l);

    const cases: [string, string][] = [
      ["unknown label", `nope-${l}.localhost:${PORT}`],
      ["claimed but never published", `${l}.localhost:${PORT}`],
    ];
    const seen = new Set<string>();
    for (const [name, host] of cases) {
      const r = await asHost(page, host, "/");
      expect(r.status(), name).toBe(404);
      seen.add(`${r.status()}|${r.headers()["cache-control"] ?? ""}|${(await r.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ").length > 0}`);
    }
    expect(seen.size).toBe(1);

    await publish(page, storeId);
    const host = `${l}.localhost:${PORT}`;
    for (const p of ["/dashboard", "/dashboard/stores/" + storeId, "/login", "/register", "/api/health", "/api/auth/session", `/preview/${storeId}`, "/store-host/other/x", "/nonexistent"]) {
      const r = await asHost(page, host, p);
      expect(r.status(), p).toBe(404);
      expect(r.headers()["location"], p).toBeUndefined();
    }
    // traversal and encoded separators
    for (const p of ["/products/%2e%2e/%2e%2e/dashboard", "/%2e%2e/login", "/products//x", "/a%2fb", "/x%00y"]) {
      let r = await asHost(page, host, p);
      if (r.status() === 308) {
        // Next normalises "//" itself, on the same host and before the proxy runs; the normalised target must be just as unavailable.
        const to = new URL(r.headers()["location"]!, `http://${host}`);
        expect(to.host, p).toBe(host);
        r = await asHost(page, host, to.pathname + to.search);
      }
      expect(r.status(), p).toBe(404);
      expect(r.headers()["location"], p).toBeUndefined();
    }
    expect((await asHost(page, host, "/")).status()).toBe(200);
    // hosts that are not exactly <label>.<root> never render the store (nested label, other port)
    for (const other of [`a.${l}.localhost:${PORT}`, `${l}.localhost:1`, `${l}.localhost`]) {
      expect(await (await asHost(page, other, "/")).text(), other).not.toContain("فروشگاه خاموش");
    }
  });

  test("forwarded headers cannot select a store, and the session cookie never reaches a store host", async ({ page, browser }) => {
    const email = await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه امن", "فروشگاه عمومی");
    const l = label();
    await claim(page, storeId, l);
    await publish(page, storeId);

    // platform host + X-Forwarded-Host naming a store: still the platform (the dashboard login gate), never the store
    for (const h of ["x-forwarded-host", "forwarded", "x-original-host", "x-host"]) {
      const r = await asHost(page, `localhost:${PORT}`, "/", { [h]: h === "forwarded" ? `host=${l}.localhost:${PORT}` : `${l}.localhost:${PORT}` });
      expect(await r.text(), h).not.toContain("فروشگاه امن");
    }
    // platform host: the dashboard is protected as before (no session -> login)
    const anon = await browser.newContext();
    const ap = await anon.newPage();
    await ap.goto(`http://localhost:${PORT}/dashboard`);
    await expect(ap).toHaveURL(/\/login/);

    // the signed-in browser visits the store host: it is just a public visitor there (host-only cookie)
    await page.goto(storeUrl(l, "/dashboard"));
    expect((await page.goto(storeUrl(l, "/dashboard")))!.status()).toBe(404);
    expect((await page.goto(storeUrl(l, "/api/auth/session")))!.status()).toBe(404);
    await page.goto(`/dashboard`);
    await expect(page).toHaveURL(/\/dashboard/);
    expect(email).toContain("@");
    await anon.close();
  });

  test("subdomain rules: reserved names and invalid labels are refused; a released name stays reserved for other stores", async ({ page, browser }) => {
    await signUpAndIn(page);
    const a = await createStoreViaUi(page, "فروشگاه الف", "فروشگاه عمومی");
    const l = label();
    await claim(page, a, l);

    await page.goto(publishUrl(a));
    await waitForHydration(page, "[data-testid=subdomain-input]");
    for (const bad of ["admin", "A", "bad_label", "-x-"]) {
      await page.fill("[data-testid=subdomain-input]", bad);
      await page.getByRole("button", { name: "تغییر زیردامنه" }).click();
      await expect(page.getByTestId("publish-error")).toBeVisible();
    }

    // change to a new label: the old one is reserved, another owner cannot take it
    const l2 = label();
    await claim(page, a, l2);
    const other = await browser.newContext();
    const op = await other.newPage();
    await signUpAndIn(op);
    const b = await createStoreViaUi(op, "فروشگاه ب", "فروشگاه عمومی");
    await op.goto(publishUrl(b));
    await waitForHydration(op, "[data-testid=subdomain-input]");
    await op.fill("[data-testid=subdomain-input]", l);
    await op.getByRole("button", { name: "ثبت زیردامنه" }).click();
    await expect(op.getByTestId("publish-error")).toContainText("رزرو");
    expect(await db.domain.count({ where: { host: l } })).toBe(0);
    await other.close();
  });
});
