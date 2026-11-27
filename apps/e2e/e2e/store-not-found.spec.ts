import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, shopper, storeUrl } from "./commerce";
import { expect, test } from "./helpers";

/** A wrong address on a store's own host: the store's theme, a way back, and nothing for hosts that are not live stores. */
test("store 404: inside the store's theme with ways back; neutral for a host that is not a live store", async ({ page, browser }) => {
  await apiSignUp(page);
  const store = (await (await api(page, "POST", "/stores", { name: "فروشگاه گمشده", templateKey: "bazaar" })).json()) as { id: string };
  const label = `nf${Math.random().toString(36).slice(2, 8)}`;
  await api(page, "POST", `/stores/${store.id}/subdomain`, { label });
  const st = (await (await api(page, "GET", `/stores/${store.id}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: st.draftRevision ?? st.draft?.revision })).ok()).toBe(true);

  const { context, page: shop } = await shopper(browser);
  const res = await shop.goto(storeUrl(label, "/no-such-page"));
  expect(res?.status()).toBe(404);
  await expect(shop.getByRole("heading", { level: 1, name: "صفحه پیدا نشد" })).toBeVisible();
  await expect(shop.locator("[data-store-not-found]")).toBeVisible();
  await expect(shop.getByText("فروشگاه گمشده").first()).toBeVisible(); // the store's own header
  await expect(shop.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);

  // a way back that works
  await shop.getByRole("link", { name: "مشاهدهٔ محصولات" }).click();
  await expect(shop).toHaveURL(/\/products$/);

  // search from the 404 page lands on the product list with the query
  await shop.goto(storeUrl(label, "/no-such-page"));
  await shop.getByRole("search", { name: "جستجوی محصولات" }).getByLabel("جستجو در محصولات").fill("چای");
  await shop.getByRole("search", { name: "جستجوی محصولات" }).getByRole("button", { name: "جستجو" }).click();
  await expect(shop).toHaveURL(/\/products\?.*q=/);

  // accessibility and a phone
  await shop.goto(storeUrl(label, "/no-such-page"));
  const axe = await new AxeBuilder({ page: shop }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
  await shop.setViewportSize({ width: 320, height: 700 });
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // an unknown label: the plain page, no store name, no theme
  const other = await shop.goto(storeUrl("zz" + label, "/no-such-page"));
  expect(other?.status()).toBe(404);
  await expect(shop.locator("[data-store-not-found]")).toHaveCount(0);
  await expect(shop.getByRole("heading", { level: 1, name: "صفحه پیدا نشد" })).toBeVisible();
  await context.close();
});
