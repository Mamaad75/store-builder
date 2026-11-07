import type { Browser, Page } from "@playwright/test";
import sharp from "sharp";
import { createProductViaUi, createStoreViaUi, db, expect, productRow, randomIp, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());

const png = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 140, b: 90 } } }).png().toBuffer();
const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });

async function newUserSession(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  await signUpAndIn(page);
  return { context, page };
}

async function openProduct(page: Page, storeId: string, name: string) {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await productRow(page, name).getByRole("link").first().click();
  await page.waitForURL(/\/products\/[^/]+$/);
  await waitForHydration(page, "[data-testid=product-image] form");
}

async function upload(page: Page, testId: string, f: ReturnType<typeof file>) {
  const input = page.locator(`[data-testid=${testId}] input[type=file]`);
  // React resets the (uncontrolled) form once an action completes; wait for that so the next file is not wiped.
  await expect(input).toHaveValue("");
  await expect(page.locator(`[data-testid=${testId}] form`).first().locator("button[type=submit]")).toBeEnabled();
  await input.setInputFiles(f);
  await page.locator(`[data-testid=${testId}] form`).first().locator("button[type=submit]").click();
}

const publicGet = (url: string) => fetch(url); // anonymous: no cookies, no credentials

test.describe("product images", () => {
  test("upload, display from the public bucket URL, preview, replace, remove (objects are really deleted)", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه تصویر", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "چای تصویردار", price: "1000", stock: "4" });
    await createProductViaUi(page, storeId, { name: "محصول پیش‌نویس", price: "2000" });
    await openProduct(page, storeId, "چای تصویردار");

    // upload a PNG: it is re-encoded to WebP and the REAL metadata is stored
    await upload(page, "product-image", file("photo.png", "image/png", await png()));
    await expect(page.getByText("تصویر محصول ذخیره شد.")).toBeVisible();
    const img = page.getByTestId("product-image-image");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(400); // really loaded from the bucket

    const product = await db.product.findFirstOrThrow({ where: { storeId, name: "چای تصویردار" }, include: { image: true } });
    const m = product.image!;
    expect(m).toMatchObject({ status: "READY", mimeType: "image/webp", width: 400, height: 300, storeId });
    expect(m.key).toMatch(new RegExp(`^stores/${storeId}/[0-9a-f]{32}\\.webp$`));
    const src = (await img.getAttribute("src"))!;
    expect(src).toContain(m.key);
    const res = await publicGet(src);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");

    // preview: only ACTIVE products appear, so activate it first; the draft product (no image) stays hidden
    await page.goto(`/dashboard/stores/${storeId}/products`);
    await productRow(page, "چای تصویردار").getByRole("button", { name: "فعال‌سازی" }).click();
    await expect(productRow(page, "چای تصویردار")).toContainText("فعال");
    await page.goto(`/preview/${storeId}/products`);
    const card = page.locator("article", { hasText: "چای تصویردار" });
    await expect(card.locator("img")).toHaveAttribute("src", src);
    await expect.poll(() => card.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(400);
    await page.goto(`/preview/${storeId}/products/${encodeURIComponent(product.slug)}`);
    await expect(page.getByRole("img", { name: "چای تصویردار" })).toBeVisible();

    // replace: the previous object disappears from the bucket
    await openProduct(page, storeId, "چای تصویردار");
    await upload(page, "product-image", file("second.png", "image/png", await png(200, 200)));
    await expect(page.getByText("تصویر محصول ذخیره شد.")).toBeVisible();
    const second = (await db.product.findFirstOrThrow({ where: { id: product.id }, include: { image: true } })).image!;
    expect(second.id).not.toBe(m.id);
    expect(await db.media.count({ where: { id: m.id } })).toBe(0);
    await expect.poll(async () => (await publicGet(src)).status).toBe(404);
    expect((await publicGet(src.replace(m.key, second.key))).status).toBe(200);

    // remove: detached, object and row gone
    await page.getByRole("button", { name: "حذف تصویر" }).click();
    await expect(page.getByText("تصویر محصول حذف شد.")).toBeVisible();
    expect(await db.media.count({ where: { storeId } })).toBe(0);
    await expect.poll(async () => (await publicGet(src.replace(m.key, second.key))).status).toBe(404);
    await expect(page.getByText("بدون تصویر")).toBeVisible();
  });

  test("invalid files are rejected on the server with a clear message and leave nothing behind", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه رد فایل", "فروشگاه عمومی");
    await createProductViaUi(page, storeId, { name: "محصول", price: "1000" });
    await openProduct(page, storeId, "محصول");

    const cases: [string, ReturnType<typeof file>, string][] = [
      ["SVG renamed to .png", file("evil.png", "image/png", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")), "فقط تصویر JPEG، PNG یا WebP مجاز است."],
      ["text claiming to be an image", file("a.jpg", "image/jpeg", Buffer.from("not an image at all")), "فقط تصویر JPEG، PNG یا WebP مجاز است."],
      ["GIF", file("a.gif", "image/gif", await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).gif().toBuffer()), "فقط تصویر JPEG، PNG یا WebP مجاز است."],
      ["image with a payload appended", file("p.png", "image/png", Buffer.concat([await png(), Buffer.from("<?php echo 1;")])), "فایل تصویر معتبر نیست یا آسیب دیده است."],
      ["decompression bomb (30 MP)", file("big.png", "image/png", await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "red" } }).png({ compressionLevel: 9 }).toBuffer()), "ابعاد تصویر بیش از حد بزرگ است"],
      ["file over 5 MB", file("huge.png", "image/png", Buffer.concat([await png(), Buffer.alloc(5.5 * 1024 * 1024)])), "حجم فایل بیش از ۵ مگابایت است."],
    ];
    for (const [label, f, message] of cases) {
      await upload(page, "product-image", f);
      await expect(page.getByRole("alert").filter({ hasText: message }), label).toBeVisible();
      expect(await db.media.count({ where: { storeId } }), label).toBe(0);
    }
  });

  test("a forged store id in the upload form cannot attach anything to another tenant's product", async ({ page, browser }) => {
    await signUpAndIn(page);
    const victimStore = await createStoreViaUi(page, "فروشگاه قربانی", "فروشگاه عمومی");
    await createProductViaUi(page, victimStore, { name: "محصول قربانی", price: "1000" });
    const victimProduct = await db.product.findFirstOrThrow({ where: { storeId: victimStore } });

    const attacker = await newUserSession(browser);
    const ap = attacker.page;
    const attackerStore = await createStoreViaUi(ap, "فروشگاه مهاجم", "فروشگاه عمومی");
    await createProductViaUi(ap, attackerStore, { name: "محصول مهاجم", price: "1000" });
    await openProduct(ap, attackerStore, "محصول مهاجم");
    // forge BOTH hidden ids to point at the victim
    await ap.evaluate(
      ([s, p]) => {
        (document.querySelector("[data-testid=product-image] input[name=storeId]") as HTMLInputElement).value = s!;
        (document.querySelector("[data-testid=product-image] input[name=productId]") as HTMLInputElement).value = p!;
      },
      [victimStore, victimProduct.id],
    );
    await upload(ap, "product-image", file("x.png", "image/png", await png()));
    await expect(ap.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible(); // same 404 as for a missing product
    expect(await db.media.count({ where: { storeId: victimStore } })).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: victimProduct.id } })).imageId).toBeNull();
    await attacker.context.close();
  });
});

test.describe("store logo", () => {
  test("upload, show in the preview header, replace, remove", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه لوگو", "فروشگاه عمومی");
    await page.goto(`/dashboard/stores/${storeId}`);
    await waitForHydration(page, "[data-testid=store-logo] form");
    await upload(page, "store-logo", file("logo.png", "image/png", await png(256, 256)));
    await expect(page.getByText("لوگوی فروشگاه ذخیره شد.")).toBeVisible();
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { logo: true } });
    expect(store.logo).toMatchObject({ status: "READY", mimeType: "image/webp", width: 256, height: 256 });

    await page.goto(`/preview/${storeId}`);
    const logo = page.locator("header img");
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(256);
    expect(await logo.getAttribute("src")).toContain(store.logo!.key);

    await page.goto(`/dashboard/stores/${storeId}`);
    await waitForHydration(page, "[data-testid=store-logo] form");
    await page.getByTestId("store-logo").getByRole("button", { name: "حذف تصویر" }).click();
    await expect(page.getByText("لوگوی فروشگاه حذف شد.")).toBeVisible();
    expect(await db.media.count({ where: { storeId } })).toBe(0);
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("header img")).toHaveCount(0);
  });
});
