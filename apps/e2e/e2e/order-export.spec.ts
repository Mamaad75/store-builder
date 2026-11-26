import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { apiSignUp, buyOne, createLiveStore, shopper } from "./commerce";
import { db, expect, test, waitForHydration } from "./helpers";

/** Invoice, packing slip and the orders CSV, from a real purchase. */
test("orders: CSV download, printable invoice and packing slip (chrome hidden when printing)", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 5 });
  const { context, page: buyer } = await shopper(browser);
  await buyOne(buyer, s, "COD"); // مریم احمدی, 09121234567, 120,000 + 30,000 shipping
  await context.close();
  const order = await db.order.findFirstOrThrow({ where: { storeId: s.storeId } });

  // ---- CSV
  await page.goto(`/dashboard/stores/${s.storeId}/orders`);
  await waitForHydration(page, '[data-testid="orders-export"] a');
  const link = page.getByRole("link", { name: /دریافت فایل CSV/ });
  await expect(link).toHaveAttribute("href", new RegExp(`/api/stores/${s.storeId}/orders/export\\?$`));
  await page.getByLabel("بازهٔ خروجی").click();
  await page.getByRole("option", { name: "۳۰ روز اخیر" }).click();
  await expect(link).toHaveAttribute("href", /days=30/);
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
  const bytes = readFileSync((await download.path())!);
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // a BOM, so Excel reads the Persian
  const lines = bytes.toString("utf8").replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("مریم احمدی");
  expect(lines[1]).toContain("09121234567");
  expect(lines[1]).toContain("150000");

  // ---- invoice
  await page.goto(`/dashboard/stores/${s.storeId}/orders/${order.id}`);
  await waitForHydration(page, "button");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "چاپ فاکتور" }).click()]);
  await popup.waitForLoadState();
  const inv = popup.getByTestId("invoice");
  await expect(inv).toContainText("فاکتور فروش");
  await expect(inv).toContainText("مریم احمدی");
  await expect(inv.getByTestId("invoice-totals")).toContainText("۱۵۰٬۰۰۰ تومان"); // 120,000 goods + 30,000 shipping
  await expect(inv).toContainText("چای آزمون");
  const axe = await new AxeBuilder({ page: popup }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="invoice"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // printing hides the panel's menus and top bar, keeps the document
  await expect(popup.getByRole("navigation", { name: "بخش‌های فروشگاه" })).toBeVisible();
  await popup.emulateMedia({ media: "print" });
  await expect(popup.getByRole("navigation", { name: "بخش‌های فروشگاه" })).toBeHidden();
  await expect(popup.getByRole("button", { name: "چاپ فاکتور" })).toBeHidden();
  await expect(inv).toBeVisible();

  // ---- packing slip: no prices, a tick per line
  await popup.emulateMedia({ media: "screen" });
  await popup.getByRole("link", { name: /نمایش برگهٔ بسته‌بندی/ }).click();
  await expect(popup.getByTestId("invoice")).toContainText("برگهٔ بسته‌بندی");
  await expect(popup.getByTestId("invoice")).not.toContainText("قیمت واحد");
  await expect(popup.getByTestId("invoice-totals")).toHaveCount(0);
  await expect(popup.getByTestId("invoice")).toContainText("چای آزمون");
});
