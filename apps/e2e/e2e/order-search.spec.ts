import { AxeBuilder } from "@axe-core/playwright";
import { apiSignUp, buyOne, createLiveStore, shopper } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

/** The merchant finds an order by its number, a part of the mobile number, or the recipient's name (a real purchase, the real list). */
test("orders: search by number, mobile fragment and name; empty result and clear; accessible", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 5 });
  const { context, page: buyer } = await shopper(browser);
  await buyOne(buyer, s, "COD"); // recipient مریم احمدی, mobile 09121234567
  await context.close();

  await page.goto(`/dashboard/stores/${s.storeId}/orders`);
  await waitForHydration(page, '[role="search"] button');
  const rows = page.getByRole("table", { name: "سفارش‌ها" }).getByRole("row");
  await expect(rows).toHaveCount(2); // header + the order
  const box = page.getByRole("textbox", { name: /جست‌وجو: شمارهٔ سفارش/ });
  const go = page.getByRole("button", { name: "جست‌وجو", exact: true });

  for (const q of ["۱", "#1", "1234567", "۰۹۱۲۱۲۳۴", "احمدی", "مریم"]) {
    await box.fill(q);
    await go.click();
    await expect(page.getByRole("status").filter({ hasText: "نتیجهٔ جست‌وجوی" })).toContainText("۱ سفارش");
    await expect(rows).toHaveCount(2);
  }

  await box.fill("نامی که وجود ندارد");
  await go.click();
  await expect(page.getByRole("status").filter({ hasText: "نتیجهٔ جست‌وجوی" })).toContainText("۰ سفارش");
  await expect(page.getByTestId("orders-empty")).toContainText("سفارشی با این جست‌وجو پیدا نشد"); // no table, a clear message
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[role="search"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  await page.getByRole("button", { name: "پاک کردن جست‌وجو" }).click();
  await expect(rows).toHaveCount(2);
  await expect(box).toHaveValue("");
});
