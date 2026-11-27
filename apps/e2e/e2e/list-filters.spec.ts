import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, shopper, storeUrl } from "./commerce";
import { expect, test } from "./helpers";

/** The price range and "in stock only" filter above the product list, as a shopper uses it. */
test("list filters: price range, in-stock switch, kept on every link, shareable address", async ({ page, browser }) => {
  await apiSignUp(page);
  const store = (await (await api(page, "POST", "/stores", { name: "فروشگاه فیلتر", templateKey: "bazaar" })).json()) as { id: string };
  // 14 products (two pages of twelve): prices 100,000 ... 1,400,000; every third one is out of stock
  for (let i = 1; i <= 14; i++) {
    const p = (await (await api(page, "POST", `/stores/${store.id}/products`, { name: `کالای شمارهٔ ${i}`, price: i * 100_000, stockQuantity: i % 3 === 0 ? 0 : 5 })).json()) as { id: string };
    await api(page, "POST", `/stores/${store.id}/products/${p.id}/status`, { status: "ACTIVE" });
  }
  const label = `flt${Math.random().toString(36).slice(2, 8)}`;
  await api(page, "POST", `/stores/${store.id}/subdomain`, { label });
  const st = (await (await api(page, "GET", `/stores/${store.id}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: st.draftRevision ?? st.draft?.revision })).ok()).toBe(true);

  const { context, page: shop } = await shopper(browser);
  await shop.goto(storeUrl(label, "/products"));
  const cards = shop.locator("main li a").filter({ hasText: /کالای شمارهٔ/ });
  const filter = shop.getByRole("search", { name: "فیلتر قیمت و موجودی" });
  await expect(filter).toBeVisible();
  await expect(filter.getByRole("link", { name: "حذف فیلتر" })).toHaveCount(0);

  // a price range (typed with Persian digits and a separator, as a shopper might)
  await filter.getByLabel("حداقل قیمت (تومان)").fill("۳۰۰٬۰۰۰");
  await filter.getByLabel("حداکثر قیمت (تومان)").fill("600000");
  await filter.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(shop).toHaveURL(/max=600000/); // the typed Persian digits travel as typed; the server reads them
  const names = async () => (await shop.locator("main").innerText()).match(/کالای شمارهٔ \d{1,2}/g) ?? [];
  await expect.poll(async () => [...new Set(await names())].sort()).toEqual(["کالای شمارهٔ 3", "کالای شمارهٔ 4", "کالای شمارهٔ 5", "کالای شمارهٔ 6"]);
  await expect(filter.getByLabel("حداقل قیمت (تومان)")).toHaveValue("300000");

  // the in-stock switch on top (3 and 6 are out of stock)
  await filter.getByLabel("فقط کالاهای موجود").check();
  await filter.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(shop).toHaveURL(/available=1/);
  await expect.poll(async () => [...new Set(await names())].sort()).toEqual(["کالای شمارهٔ 4", "کالای شمارهٔ 5"]);

  // sorting keeps the filters
  await shop.goto(storeUrl(label, "/products?min=300000&available=1&sort=expensive"));
  await expect(shop.getByLabel("حداقل قیمت (تومان)")).toHaveValue("300000");
  await expect(shop.getByLabel("فقط کالاهای موجود")).toBeChecked();
  // a filter that leaves more than one page: the page links keep it (the second page exists because 12 + more match)
  await shop.goto(storeUrl(label, "/products?min=100000"));
  const next = shop.locator('a[href*="page=2"]').first();
  await expect(next).toBeVisible();
  expect(await next.getAttribute("href")).toContain("min=100000");

  // nothing matches: the page says so instead of an empty gap, and the way out is offered
  await shop.goto(storeUrl(label, "/products?min=999999999"));
  await expect(shop.getByRole("link", { name: "حذف فیلتر" })).toBeVisible();
  expect(await names()).toEqual([]);

  // junk in the address is ignored, never an error page
  const r = await shop.goto(storeUrl(label, "/products?min=abc&max=%3Cscript%3E&available=2"));
  expect(r?.status()).toBe(200);
  await expect(filter.getByLabel("حداقل قیمت (تومان)")).toHaveValue("");

  // accessibility and a phone
  await shop.goto(storeUrl(label, "/products?min=300000"));
  const axe = await new AxeBuilder({ page: shop }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
  await shop.setViewportSize({ width: 320, height: 700 });
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  void cards;
  await context.close();
});
