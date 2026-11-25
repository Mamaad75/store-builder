import { api, apiSignUp, buyOne, createLiveStore, shopper } from "./commerce";
import { db, expect, test } from "./helpers";

/**
 * M2-5 (MVP roadmap): the store overview on the dashboard home after a real purchase. A cash-on-delivery order counts in the order value at
 * once, is "money to collect" until delivered, and becomes paid revenue when delivered (rules: roadmap §12.4).
 */
test("overview: a COD order shows as order value and to-confirm; delivered, it becomes paid revenue; low stock listed", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 3 });
  const { context, page: buyer } = await shopper(browser);
  await buyOne(buyer, s, "COD");
  await context.close();

  await page.goto(`/dashboard/stores/${s.storeId}`);
  const overview = page.getByRole("region", { name: "نمای کلی فروشگاه" });
  const today = overview.getByTestId("overview-today");
  await expect(today).toContainText("۱۵۰٬۰۰۰ تومان"); // order value: 120,000 + 30,000 shipping
  await expect(today.getByRole("cell").nth(1)).toHaveText("۱");
  await expect(today.getByRole("cell").nth(3)).toHaveText("۰ تومان"); // COD: not paid before delivery
  await expect(overview.getByRole("link", { name: "سفارش منتظر تأیید: ۱" })).toBeVisible();
  await expect(overview.getByText("پرداخت در محل (هنوز تحویل نشده): ۱ سفارش — ۱۵۰٬۰۰۰ تومان")).toBeVisible();
  await expect(overview.getByRole("list", { name: "محصولات با موجودی کم" })).toContainText("چای آزمون: ۲ عدد");

  const order = await db.order.findFirstOrThrow({ where: { storeId: s.storeId } });
  for (const to of ["CONFIRMED", "SHIPPED", "DELIVERED"]) {
    const r = await api(page, "POST", `/stores/${s.storeId}/orders/${order.id}/status`, { to, note: "" });
    expect(r.status(), await r.text()).toBe(200);
  }
  await page.reload();
  await expect(today.getByRole("cell").nth(3)).toHaveText("۱۵۰٬۰۰۰ تومان");
  await expect(overview.getByText("پرداخت در محل (هنوز تحویل نشده): ۰ سفارش — ۰ تومان")).toBeVisible();

  // The receipt link opens the precise receipt-review filter (not the generic awaiting-payment list).
  await expect(overview.getByRole("link", { name: /رسید کارت‌به‌کارت منتظر بررسی/ })).toHaveAttribute("href", `/dashboard/stores/${s.storeId}/orders?review=receipt`);
  // The "to confirm" link opens the order list already filtered.
  await overview.getByRole("link", { name: /سفارش منتظر تأیید/ }).click();
  await page.waitForURL(/\/orders\?status=PLACED$/);
});
