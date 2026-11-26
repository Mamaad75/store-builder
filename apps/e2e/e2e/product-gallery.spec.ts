import { AxeBuilder } from "@axe-core/playwright";
import sharp from "sharp";
import { api, apiSignUp, createLiveStore, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

const png = (w: number, h: number, r: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 60 } } }).png().toBuffer();

/** Extra product images: uploaded in the dashboard, limited to five, one can become the main image, and shoppers see them on the product page. */
test("gallery: add up to five extras, make one the main image, remove one; shoppers see the thumbnails", async ({ page, browser }) => {
  await apiSignUp(page);
  const live = await createLiveStore(page);
  // the main image through the API, the extras through the dashboard form
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").origin;
  const main = await page.request.fetch(`${origin}/api/stores/${live.storeId}/products/${live.productId}/image`, {
    method: "POST", headers: { origin, "content-type": "application/octet-stream" }, data: await png(400, 300, 200), failOnStatusCode: false,
  });
  expect(main.status()).toBe(200);

  await page.goto(`/dashboard/stores/${live.storeId}/products/${live.productId}`);
  const gallery = page.getByTestId("product-gallery");
  await waitForHydration(page, '[data-testid="product-gallery"] form');
  const add = async (w: number, r: number) => {
    await gallery.locator("input[type=file]").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: await png(w, 200, r) });
    await gallery.getByRole("button", { name: "افزودن تصویر" }).click();
  };
  for (let i = 0; i < 5; i++) {
    await add(300 + i * 10, 20 + i * 30);
    await expect(gallery.getByTestId("gallery-tile")).toHaveCount(i + 1);
  }
  // full: no more upload control, the reason is shown
  await expect(gallery.getByTestId("gallery-full")).toBeVisible();
  await expect(gallery.locator("input[type=file]")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="product-gallery"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // make the second extra the main image: the old main takes its place, the count stays five
  const before = (await (await api(page, "GET", `/stores/${live.storeId}/products/${live.productId}`)).json()) as { image: { id: string }; gallery: { media: { id: string } }[] };
  await gallery.getByRole("button", { name: "تصویر ۳ را تصویر اصلی کن" }).click();
  await expect.poll(async () => ((await (await api(page, "GET", `/stores/${live.storeId}/products/${live.productId}`)).json()) as { image: { id: string } }).image.id).toBe(before.gallery[1]!.media.id);
  await expect(gallery.getByTestId("gallery-tile")).toHaveCount(5);

  // remove one: four left and the upload control is back
  await gallery.getByRole("button", { name: "حذف تصویر ۲" }).click();
  await expect(gallery.getByTestId("gallery-tile")).toHaveCount(4);
  await expect(gallery.locator("input[type=file]")).toHaveCount(1);

  // publish and look as a shopper: the main image and four thumbnails on the product page
  const state = (await (await api(page, "GET", `/stores/${live.storeId}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${live.storeId}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision })).ok()).toBe(true);
  const { context, page: shop } = await (async () => {
    const c = await browser.newContext();
    return { context: c, page: await c.newPage() };
  })();
  await shop.goto(storeUrl(live.label, `/products/${live.productSlug}`));
  const strip = shop.locator("[data-gallery]");
  await expect(strip.locator("img")).toHaveCount(4);
  await expect.poll(() => strip.locator("img").first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await context.close();
});
