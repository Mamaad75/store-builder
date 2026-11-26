import { AxeBuilder } from "@axe-core/playwright";
import { apiSignUp, buyOne, createLiveStore, shopper } from "./commerce";
import { db, expect, test, waitForHydration } from "./helpers";

/** The carrier's tracking code, end to end: the merchant ships with a code, the shopper sees it on their order page, the merchant corrects and clears it. */
test("tracking code: entered when shipping, shown to the shopper, corrected and cleared by the merchant", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { stock: 3 });
  const { context, page: buyer } = await shopper(browser);
  const orderUrl = await buyOne(buyer, s, "COD");
  const order = await db.order.findFirstOrThrow({ where: { storeId: s.storeId } });

  await page.goto(`/dashboard/stores/${s.storeId}/orders/${order.id}`);
  await waitForHydration(page, "button");
  await page.getByRole("button", { name: "تأیید سفارش" }).click();
  await expect(page.getByLabel("کد رهگیری مرسوله (اختیاری)")).toBeVisible(); // asked when the order can be shipped
  await expect(page.getByTestId("order-tracking")).toHaveCount(0); // not before shipping

  // a wrong code is refused with the reason and the order is NOT shipped
  await page.getByLabel("کد رهگیری مرسوله (اختیاری)").fill("ab");
  await page.getByRole("button", { name: "ثبت ارسال" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "کد رهگیری باید ۳ تا ۴۰" })).toBeVisible();
  expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");

  // Persian digits and spaces are accepted and normalised
  await page.getByLabel("کد رهگیری مرسوله (اختیاری)").fill("۱۲۳۴ ۵۶۷۸ ۹۰۱۲");
  await page.getByRole("button", { name: "ثبت ارسال" }).click();
  const tracking = page.getByTestId("order-tracking");
  await expect(tracking).toContainText("123456789012");
  expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).trackingCode).toBe("123456789012");

  // the shopper sees it on the order page they already have
  await buyer.goto(orderUrl);
  await expect(buyer.getByTestId("shopper-tracking")).toContainText("123456789012");

  // correct it, then clear it
  await tracking.getByRole("button", { name: "اصلاح کد" }).click();
  await tracking.getByLabel("کد رهگیری").fill("RR987654321IR");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="order-tracking"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  await tracking.getByRole("button", { name: "ذخیره" }).click();
  await expect(tracking).toContainText("RR987654321IR");
  await buyer.reload();
  await expect(buyer.getByTestId("shopper-tracking")).toContainText("RR987654321IR");

  await tracking.getByRole("button", { name: "اصلاح کد" }).click();
  await tracking.getByLabel("کد رهگیری").fill("");
  await tracking.getByRole("button", { name: "ذخیره" }).click();
  await expect(tracking).toContainText("هنوز کد رهگیری ثبت نشده است");
  await buyer.reload();
  await expect(buyer.getByTestId("shopper-tracking")).toHaveCount(0);
  await context.close();

  // it is in the store's activity log
  await page.goto(`/dashboard/stores/${s.storeId}/activity`);
  await expect(page.locator('[data-testid=audit-row][data-action="order.tracking_set"]').first()).toBeVisible();
  await expect(page.getByText("کد رهگیری سفارش ثبت یا تغییر کرد").first()).toBeVisible();
});
