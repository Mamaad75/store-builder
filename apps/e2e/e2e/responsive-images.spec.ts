import sharp from "sharp";
import { api, apiSignUp, shopper, storeUrl } from "./commerce";
import { expect, test } from "./helpers";

/** Responsive images end to end: an upload stores smaller copies, the published page offers them, and each phone/desktop picks a fitting one. */
const picture = (w: number) => sharp({ create: { width: w, height: Math.round(w * 0.75), channels: 3, background: { r: 90, g: 120, b: 60 }, noise: { type: "gaussian", mean: 128, sigma: 50 } } }).jpeg().toBuffer();

test("responsive images: smaller copies exist, the page offers them, each screen loads a fitting one", async ({ page, browser }) => {
  await apiSignUp(page);
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").origin;
  const store = (await (await api(page, "POST", "/stores", { name: "فروشگاه تصویر", templateKey: "general" })).json()) as { id: string };
  const slugs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const p = (await (await api(page, "POST", `/stores/${store.id}/products`, { name: `محصول ${i + 1}`, price: 100_000, stockQuantity: 5 })).json()) as { id: string; slug: string };
    await api(page, "POST", `/stores/${store.id}/products/${p.id}/status`, { status: "ACTIVE" });
    const up = await page.request.fetch(`${origin}/api/stores/${store.id}/products/${p.id}/image`, { method: "POST", headers: { origin, "content-type": "application/octet-stream" }, data: await picture(1800), failOnStatusCode: false });
    expect(up.status()).toBe(200);
    slugs.push(p.slug);
  }
  const label = `img${Math.random().toString(36).slice(2, 8)}`;
  await api(page, "POST", `/stores/${store.id}/subdomain`, { label });
  const state = (await (await api(page, "GET", `/stores/${store.id}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision })).ok()).toBe(true);

  // the owner sees the image and its copies in the product's data: the main image is the full size, the copies are what pages use
  const { context, page: shop } = await shopper(browser);
  await shop.setViewportSize({ width: 412, height: 823 });
  await shop.goto(storeUrl(label, "/products"));
  const card = shop.locator("img[srcset]").first();
  await expect(card).toHaveAttribute("srcset", /-w320\.webp 320w, .*-w640\.webp 640w, .*-w1024\.webp 1024w/);
  await expect(card).toHaveAttribute("sizes", /50vw/);
  // every address the page offers really serves a WebP of the promised width
  const srcset = (await card.getAttribute("srcset"))!;
  const offered = srcset.split(",").map((s) => s.trim().split(" "));
  expect(offered.map(([, w]) => w)).toEqual(["320w", "640w", "1024w"]);
  for (const [u, w] of offered) {
    const r = await shop.request.get(u!);
    expect(r.status(), u).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/webp");
    expect((await sharp(await r.body()).metadata()).width).toBe(Number.parseInt(w!, 10));
  }
  // the phone loaded a small copy, not the 1800 px original
  await expect.poll(() => card.evaluate((el: HTMLImageElement) => el.complete && el.currentSrc)).toMatch(/-w(320|640)\.webp$/);
  const full = (await card.getAttribute("src"))!;
  expect(full).not.toMatch(/-w\d+\.webp$/); // the fallback src is still the original

  // the product page on a desktop screen picks the large copy
  await shop.setViewportSize({ width: 1280, height: 900 });
  await shop.goto(storeUrl(label, `/products/${slugs[0]}`));
  const main = shop.locator("img[srcset]").first();
  await expect.poll(() => main.evaluate((el: HTMLImageElement) => el.complete && el.currentSrc)).toMatch(/-w1024\.webp$/);
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await context.close();
});
