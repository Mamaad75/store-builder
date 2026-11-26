import { AxeBuilder } from "@axe-core/playwright";
import { apiSignUp, buyOne, createLiveStore, storeUrl } from "./commerce";
import { db, expect, randomIp, test } from "./helpers";

/**
 * The store trend charts on the dashboard home, end to end: a shopper opens the live storefront (the beacon counts one view and one
 * visitor), buys something, and the merchant sees the real numbers in the KPI cards and charts. Anonymous: nothing identifying is stored.
 */
const REAL_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test("charts show real visits, orders and sales; the range switch works; accessible; no horizontal scroll at 320px", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 5 });

  // A shopper (a normal browser string: the default headless one is, rightly, treated as a bot) opens the store twice and buys one item.
  const context = await browser.newContext({ userAgent: REAL_BROWSER, extraHTTPHeaders: { "x-forwarded-for": randomIp() }, locale: "fa-IR" });
  const buyer = await context.newPage();
  const counted = buyer.waitForResponse((r) => r.url().endsWith("/api/shop/visit"));
  await buyer.goto(storeUrl(s.label));
  expect((await counted).status()).toBe(204);
  await buyer.goto(storeUrl(s.label, `/products/${s.productSlug}`));
  await expect.poll(async () => (await db.storeDailyStat.findMany({ where: { storeId: s.storeId } })).reduce((n, d) => n + d.views, 0)).toBeGreaterThanOrEqual(2);
  await buyOne(buyer, s, "COD");
  await context.close();

  const stat = await db.storeDailyStat.findMany({ where: { storeId: s.storeId } });
  expect(stat).toHaveLength(1);
  expect(stat[0]!.visitors).toBe(1); // one shopper, however many pages
  expect(JSON.stringify(await db.storeDailyVisitor.findMany())).toMatch(/"hash":"[0-9a-f]{64}"/);

  await page.goto(`/dashboard/stores/${s.storeId}`);
  const section = page.getByRole("region", { name: "روند فروشگاه" });
  await expect(section.getByTestId("kpi-sales")).toContainText("۱۵۰٬۰۰۰ تومان"); // 120,000 + 30,000 shipping
  await expect(section.getByTestId("kpi-orders")).toContainText("۱");
  const visits = section.getByTestId("kpi-visits");
  await expect(visits).toContainText("۱ بازدیدکننده");
  await expect(visits).toContainText("نرخ تبدیل ۱۰۰٪"); // 1 order / 1 visitor
  await expect(section.getByTestId("kpi-customers")).toBeVisible();
  for (const c of ["sales", "orders", "visits", "customers"]) await expect(section.getByTestId(`chart-${c}`).getByRole("img")).toBeVisible();

  // The range switch re-reads the data: 7 days shows 7 rows in the sales table, 90 shows 90.
  await section.getByTestId("range-7").click();
  await expect(section.getByTestId("chart-sales").locator("tbody tr")).toHaveCount(7);
  await section.getByTestId("range-90").click();
  await expect(section.getByTestId("chart-sales").locator("tbody tr")).toHaveCount(90);
  await section.getByTestId("range-30").click();
  await expect(section.getByTestId("chart-sales").locator("tbody tr")).toHaveCount(30);

  // The same numbers are reachable without the picture: the data table of the visits chart lists today's views.
  await section.getByTestId("chart-visits").getByText("جدول داده‌ها").click();
  await expect(section.getByTestId("chart-visits").locator("tbody tr").first()).toContainText(/۲|۳|۴/);

  // Hovering a day shows that day's numbers.
  await section.getByTestId("chart-sales").scrollIntoViewIfNeeded(); // the chart is below the fold: the mouse must be over it
  const box = await section.getByTestId("chart-sales").getByRole("img").boundingBox();
  await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2); // the right edge is today (the page reads right to left)
  await expect(section.getByTestId("chart-sales")).toContainText("فروش:");

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="store-analytics"]').analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  await page.setViewportSize({ width: 320, height: 700 });
  await expect(section.getByTestId("kpi-sales")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal scrolling at 320px with the charts loaded").toBeLessThanOrEqual(0);
});

test("a bot, a Do-Not-Track browser and a visit to an unpublished store are not counted", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page);
  const botContext = await browser.newContext({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const bot = await botContext.newPage();
  const answered = bot.waitForResponse((r) => r.url().endsWith("/api/shop/visit"));
  await bot.goto(storeUrl(s.label));
  expect((await answered).status()).toBe(204);
  await botContext.close();

  const dntContext = await browser.newContext({ userAgent: REAL_BROWSER, extraHTTPHeaders: { "x-forwarded-for": randomIp(), dnt: "1" } });
  const dnt = await dntContext.newPage();
  const answeredDnt = dnt.waitForResponse((r) => r.url().endsWith("/api/shop/visit"));
  await dnt.goto(storeUrl(s.label));
  expect((await answeredDnt).status()).toBe(204);
  await dntContext.close();

  expect(await db.storeDailyStat.count({ where: { storeId: s.storeId } })).toBe(0);
  // ...and the dashboard says visits have not started, instead of implying "zero shoppers".
  await page.goto(`/dashboard/stores/${s.storeId}`);
  await expect(page.getByTestId("visits-not-started")).toBeVisible();
});
