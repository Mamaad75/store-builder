import type { Browser } from "@playwright/test";
import { createCategoryViaUi, createProductViaUi, createStoreViaUi, db, expect, productRow, randomIp, signUpAndIn, test } from "./helpers";

test.afterAll(() => db.$disconnect());

async function newUserSession(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  await signUpAndIn(page);
  return { context, page };
}

async function activate(page: import("@playwright/test").Page, storeId: string, name: string) {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await productRow(page, name).getByRole("button", { name: "فعال‌سازی" }).click();
  await expect(productRow(page, name)).toContainText("فعال");
}

test.describe("draft storefront preview", () => {
  test("owner sees the real storefront: draft products hidden, active shown, banner, RTL, no-index, nothing modified", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه پیش‌نمایش", "فروشگاه عمومی");
    await createCategoryViaUi(page, storeId, "چای");
    await createProductViaUi(page, storeId, { name: "چای فعال", price: "۱۲۵۰۰۰", stock: "3", category: "چای" });
    await createProductViaUi(page, storeId, { name: "قهوه پیش‌نویس", price: "5000", stock: "10" });
    await activate(page, storeId, "چای فعال");
    const before = await db.store.findUniqueOrThrow({ where: { id: storeId } });

    // entry point from the dashboard
    await page.goto(`/dashboard/stores/${storeId}/products`);
    const [preview] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "پیش‌نمایش پیش‌نویس" }).click()]);
    await preview.waitForURL(`**/preview/${storeId}`);

    await expect(preview.getByTestId("preview-banner")).toContainText("پیش‌نمایش پیش‌نویس");
    await expect(preview.getByTestId("preview-banner")).toContainText("این صفحه عمومی نیست");
    await expect(preview.getByTestId("preview-note-excluded")).toContainText("۱ محصول");
    await expect(preview.locator("[data-template=general]")).toHaveAttribute("dir", "rtl");
    await expect(preview.getByRole("link", { name: "فروشگاه پیش‌نمایش" }).first()).toBeVisible();
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(preview.getByText("چای فعال").first()).toBeVisible();
    await expect(preview.getByText("قهوه پیش‌نویس")).toHaveCount(0);
    await expect(preview.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);

    // navigate: listing, category filter, detail, about, contact
    await preview.goto(`/preview/${storeId}/products`);
    await expect(preview.getByText("۱۲۵٬۰۰۰ تومان")).toBeVisible();
    await expect(preview.getByText("قهوه پیش‌نویس")).toHaveCount(0);
    await preview.getByRole("navigation", { name: "دسته‌بندی محصولات" }).getByRole("link", { name: "چای" }).click();
    await expect(preview).toHaveURL(/category=/);
    await expect(preview.getByText("چای فعال").first()).toBeVisible();
    await preview.getByRole("link", { name: "چای فعال" }).first().click();
    await expect(preview.getByRole("heading", { level: 1, name: "چای فعال" })).toBeVisible();
    await expect(preview.getByText("تنها ۳ عدد باقی مانده")).toBeVisible();
    await preview.goto(`/preview/${storeId}/about`);
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
    await preview.goto(`/preview/${storeId}/contact`);
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();

    // unknown product / path: not found, and a DRAFT product's slug is not reachable either
    const draft = await db.product.findFirstOrThrow({ where: { storeId, name: "قهوه پیش‌نویس" } });
    // (inside an existing store the not-found UI is streamed after the loading boundary, so the HTTP status stays 200;
    // the missing/foreign STORE case, where it matters for isolation, is a real 404 - see the cross-user test)
    for (const path of [`/products/${encodeURIComponent(draft.slug)}`, "/nope", "/products/nope"]) {
      await preview.goto(`/preview/${storeId}${path}`);
      await expect(preview.getByRole("heading", { level: 1, name: "صفحه پیدا نشد" })).toBeVisible();
      await expect(preview.getByText("قهوه پیش‌نویس")).toHaveCount(0);
    }

    // response headers
    const res = await preview.goto(`/preview/${storeId}`);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    expect(res?.headers()["cache-control"]).toContain("no-store");

    // read-only: nothing changed by previewing
    const after = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(after.draftRevision).toBe(before.draftRevision);
    expect(after.status).toBe("DRAFT");
    expect(await db.storeVersion.count({ where: { storeId } })).toBe(0);
  });

  test("reflects draft changes immediately and shows empty states for a fresh store", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه خالی", "فروشگاه عمومی");
    await page.goto(`/preview/${storeId}`);
    await expect(page.getByText("هنوز محصولی منتشر نشده است").first()).toBeVisible();
    await page.goto(`/preview/${storeId}/products`);
    await expect(page.getByText("هنوز محصولی منتشر نشده است")).toBeVisible();

    await createProductViaUi(page, storeId, { name: "محصول تازه", price: "1000", stock: "0" });
    await page.goto(`/preview/${storeId}/products`);
    await expect(page.getByText("محصول تازه")).toHaveCount(0); // still DRAFT
    await activate(page, storeId, "محصول تازه");
    await page.goto(`/preview/${storeId}/products`);
    await expect(page.getByText("محصول تازه").first()).toBeVisible();
    await expect(page.getByText("ناموجود")).toBeVisible(); // zero stock is shown, not hidden
  });

  test("anonymous visitors are sent to login and never see content", async ({ page }) => {
    const owner = await newUserSession(await page.context().browser()!);
    const storeId = await createStoreViaUi(owner.page, "خصوصی", "فروشگاه عمومی");
    await page.goto(`/preview/${storeId}`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("خصوصی")).toHaveCount(0);
    await owner.context.close();
  });

  test("another user gets the same 404 as for a missing store, and learns nothing about the real one", async ({ page, browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه محرمانه", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "محصول محرمانه", price: "1" });
    await activate(page, storeId, "محصول محرمانه");

    const other = await newUserSession(browser);
    const foreign = await other.page.goto(`/preview/${storeId}`);
    const missing = await other.page.goto(`/preview/ckdoesnotexist000000000000`);
    const foreignBody = await (await other.page.goto(`/preview/${storeId}`))!.text();
    expect(foreign?.status()).toBe(404);
    expect(missing?.status()).toBe(404);
    expect(foreignBody).not.toContain("فروشگاه محرمانه");
    expect(foreignBody).not.toContain("محصول محرمانه");
    expect((await other.page.goto(`/preview/${storeId}/products`))?.status()).toBe(404);
    // the owner's dashboard preview button does not exist on another user's dashboard route either
    expect((await other.page.goto(`/dashboard/stores/${storeId}/products`))?.status()).toBe(404);
    await other.context.close();
  });

  test("a store on a template without a renderer yet gets a friendly explanation, not a crash", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "کافه", "قهوه و مواد غذایی");
    const res = await page.goto(`/preview/${storeId}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("preview-unsupported_template")).toContainText("این قالب هنوز پیش‌نمایش ندارد");
    await expect(page.getByTestId("preview-banner")).toBeVisible();
  });

  test("mobile viewport: no horizontal scrolling on any storefront page", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه موبایل", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "یک محصول با نام بسیار بسیار طولانی برای بررسی شکستن خط در نمایش موبایل", price: "999999999", stock: "50" });
    await activate(page, storeId, "یک محصول با نام");
    await page.setViewportSize({ width: 360, height: 740 });
    const product = await db.product.findFirstOrThrow({ where: { storeId } });
    for (const path of ["", "/products", `/products/${encodeURIComponent(product.slug)}`, "/about", "/contact"]) {
      await page.goto(`/preview/${storeId}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
