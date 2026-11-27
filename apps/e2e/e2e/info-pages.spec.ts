import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { api, apiSignUp, createLiveStore, shopper, storeRequest, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

const clean = async (page: Page, what: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${what} ${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
};
async function republish(page: Page, storeId: string) {
  const state = (await (await api(page, "GET", `/stores/${storeId}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${storeId}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision })).ok()).toBe(true);
}

/** The store's information pages and announcement: written in the dashboard, live with the next publish, read by shoppers in the store's theme. */
test("info pages: write terms and FAQ, add an announcement, publish, and read them on the store", async ({ page, browser }) => {
  await apiSignUp(page);
  const live = await createLiveStore(page);
  await page.goto(`/dashboard/stores/${live.storeId}/info-pages`);
  await waitForHydration(page, "main button");
  await expect(page.getByRole("button", { name: "ذخیره", exact: true })).toBeDisabled(); // nothing to save yet
  await clean(page, "editor");

  // terms from the suggested text
  await page.getByRole("button", { name: "درج متن پیشنهادی" }).click();
  await expect(page.getByLabel(/متن «قوانین و مقررات»/)).toHaveValue(/شرایط استفاده/);
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByText(/ذخیره شد/).first()).toBeVisible();

  // the FAQ, written by hand (with markup that must stay text)
  await page.getByRole("tab", { name: /سؤالات پرتکرار/ }).click();
  await page.getByLabel(/متن «سؤالات پرتکرار»/).fill("## ارسال چند روزه است؟\nدو تا چهار روز <script>alert(1)</script> کاری.\n\n## بازگشت دارید؟\nبله.");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByText(/ذخیره شد/).first()).toBeVisible();

  // the announcement
  await page.getByLabel("متن اعلان").fill("ارسال رایگان برای خرید بالای پانصد هزار تومان");
  await page.getByRole("combobox", { name: "پیوند اعلان" }).click();
  await page.getByRole("option", { name: "محصولات" }).click();
  await page.getByRole("button", { name: "ذخیرهٔ اعلان" }).click();
  await expect(page.getByText(/ذخیره شد/).last()).toBeVisible();

  // before the store is published again, the live site has none of it
  const { context, page: shop } = await shopper(browser);
  expect((await storeRequest(shop, live.label, "/info/terms")).status()).toBe(404);
  expect(await (await storeRequest(shop, live.label, "/")).text()).not.toContain("data-announcement");

  await republish(page, live.storeId);
  await shop.goto(storeUrl(live.label, "/"));
  await expect(shop.getByRole("region", { name: "اعلان فروشگاه" })).toContainText("ارسال رایگان برای خرید بالای پانصد هزار تومان");
  const links = shop.getByRole("navigation", { name: "قوانین و اطلاعات" });
  await expect(links.getByRole("link")).toHaveText(["قوانین و مقررات", "سؤالات پرتکرار"]);
  await clean(shop, "home");

  await links.getByRole("link", { name: "سؤالات پرتکرار" }).click();
  await expect(shop.getByRole("heading", { name: "سؤالات پرتکرار", level: 1 })).toBeVisible();
  const q = shop.getByText("ارسال چند روزه است؟");
  await expect(shop.getByText(/دو تا چهار روز/)).toBeHidden(); // closed until opened
  await q.click();
  await expect(shop.getByText("دو تا چهار روز <script>alert(1)</script> کاری.")).toBeVisible(); // text, not markup
  await expect(shop).toHaveTitle(/سؤالات پرتکرار/);
  await clean(shop, "faq");

  await shop.goto(storeUrl(live.label, "/info/terms"));
  await expect(shop.getByRole("heading", { name: "شرایط استفاده", level: 2 })).toBeVisible();
  await clean(shop, "terms");
  expect((await storeRequest(shop, live.label, "/info/privacy")).status()).toBe(404); // a page without text does not exist
  const sitemap = await (await storeRequest(shop, live.label, "/sitemap.xml")).text();
  expect(sitemap).toContain("/info/terms");
  expect(sitemap).toContain("/info/faq");

  // the shop pages carry the bar and the links too
  await shop.goto(storeUrl(live.label, "/cart"));
  await expect(shop.getByRole("region", { name: "اعلان فروشگاه" })).toBeVisible();
  await expect(shop.getByRole("navigation", { name: "قوانین و اطلاعات" })).toBeVisible();

  // phone width
  await shop.setViewportSize({ width: 320, height: 700 });
  await shop.goto(storeUrl(live.label, "/info/terms"));
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // removing a page and the announcement: live only after the next publish
  await page.goto(`/dashboard/stores/${live.storeId}/info-pages`);
  await waitForHydration(page, "main button");
  await page.getByLabel(/متن «قوانین و مقررات»/).fill("");
  await page.getByRole("button", { name: "حذف صفحه" }).click();
  await page.getByRole("button", { name: "برداشتن اعلان" }).click();
  await expect(page.getByText(/اعلان برداشته شد/)).toBeVisible();
  await shop.goto(storeUrl(live.label, "/info/terms"));
  await expect(shop.getByRole("heading", { name: "شرایط استفاده", level: 2 })).toBeVisible();
  await republish(page, live.storeId);
  expect((await storeRequest(shop, live.label, "/info/terms")).status()).toBe(404);
  expect(await (await storeRequest(shop, live.label, "/")).text()).not.toContain("data-announcement");
  await context.close();
});
