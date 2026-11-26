import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, buyOne, createLiveStore, shopper } from "./commerce";
import { db, expect, test } from "./helpers";

/**
 * M2-5 (MVP roadmap) on the store dashboard: the overview after a real purchase. A cash-on-delivery order counts in the order value at
 * once, is "money to collect" until delivered, and becomes paid revenue when delivered (rules: roadmap §12.4). The overview is shown as
 * tiles, bars and a ring, every figure also written out as text.
 */
test("overview: a COD order shows as order value and to-confirm; delivered, it becomes paid revenue; low stock listed", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 3 });
  const { context, page: buyer } = await shopper(browser);
  await buyOne(buyer, s, "COD");
  await context.close();

  await page.goto(`/dashboard/stores/${s.storeId}/dashboard`);
  const overview = page.getByRole("region", { name: "نمای کلی فروشگاه" });
  const today = overview.getByTestId("overview-today");
  await expect(overview.getByTestId("overview-today-value")).toHaveText("۱۵۰٬۰۰۰ تومان"); // order value: 120,000 + 30,000 shipping
  await expect(today).toContainText("۱ سفارش");
  await expect(overview.getByTestId("overview-today-paid")).toContainText("دریافت‌شده: ۰ تومان"); // COD: not paid before delivery
  // Gross only: completed refunds are not recorded yet, and the page says so (owner decision 2026-11-25).
  await expect(overview.getByTestId("overview-refund-note")).toContainText("بازپرداخت‌های انجام‌شده هنوز از درآمد کسر نمی‌شود");
  await expect(overview.getByRole("link", { name: "۱ سفارش منتظر تأیید" })).toBeVisible();
  await expect(overview.getByTestId("pending-cod")).toContainText("۱ سفارش — ۱۵۰٬۰۰۰ تومان");
  await expect(overview.getByRole("list", { name: "محصولات با موجودی کم" })).toContainText("چای آزمون: ۲ عدد");

  const order = await db.order.findFirstOrThrow({ where: { storeId: s.storeId } });
  for (const to of ["CONFIRMED", "SHIPPED", "DELIVERED"]) {
    const r = await api(page, "POST", `/stores/${s.storeId}/orders/${order.id}/status`, { to, note: "" });
    expect(r.status(), await r.text()).toBe(200);
  }
  await page.reload();
  await expect(overview.getByTestId("overview-today-paid")).toContainText("دریافت‌شده: ۱۵۰٬۰۰۰ تومان");
  await expect(overview.getByTestId("overview-today-paid")).toContainText("۱۰۰٪ از ارزش سفارش‌ها");
  await expect(overview.getByTestId("pending-cod")).toContainText("۰ سفارش — ۰ تومان");

  // The receipt link opens the precise receipt-review filter (not the generic awaiting-payment list).
  await expect(overview.getByRole("link", { name: /رسید کارت‌به‌کارت منتظر بررسی/ })).toHaveAttribute("href", `/dashboard/stores/${s.storeId}/orders?review=receipt`);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="store-overview"]').analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  // The "to confirm" tile opens the order list already filtered.
  await overview.getByRole("link", { name: /سفارش منتظر تأیید/ }).click();
  await page.waitForURL(/\/orders\?status=PLACED$/);
});

test("dashboard: the sidebar has a Dashboard entry, the settings page no longer holds the charts, and a new store shows a clear empty state", async ({ page }) => {
  await apiSignUp(page);
  const c = await api(page, "POST", "/stores", { name: "فروشگاه خالی", templateKey: "general" });
  const { id } = (await c.json()) as { id: string };
  await page.goto(`/dashboard/stores/${id}/dashboard`);
  const nav = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: "داشبورد" }) }).first();
  await expect(nav.getByRole("link", { name: "داشبورد" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "نمای کلی فروشگاه" }).getByText("هنوز سفارشی ثبت نشده است")).toBeVisible();
  await expect(page.getByRole("region", { name: "روند فروشگاه" })).toBeVisible();
  await expect(page.getByTestId("setup-checklist")).toBeVisible();

  await page.goto(`/dashboard/stores/${id}`); // settings
  await expect(page.getByRole("region", { name: "نمای کلی فروشگاه" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "روند فروشگاه" })).toHaveCount(0);
  await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
});
