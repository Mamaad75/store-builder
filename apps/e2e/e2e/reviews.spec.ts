import { AxeBuilder } from "@axe-core/playwright";
import { apiSignUp, createLiveStore, shopper, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

const axeOf = (page: import("@playwright/test").Page, include: string) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include(include).analyze();

/** Reviews end to end: a customer writes, the merchant approves and answers in the dashboard, the product page shows both. */
test("reviews: customer writes, merchant approves and answers, the product page shows it", async ({ page, browser }) => {
  await apiSignUp(page);
  const live = await createLiveStore(page);
  const { context, page: shop } = await shopper(browser);
  const productUrl = storeUrl(live.label, `/products/${live.productSlug}`);

  // signed out: the section says there is nothing yet and invites sign-in (the form is not shown)
  await shop.goto(productUrl);
  await expect(shop.getByTestId("reviews-summary")).toHaveText("هنوز نظری ثبت نشده است.");
  await expect(shop.getByRole("link", { name: "وارد حساب خود شوید" })).toBeVisible();
  await expect(shop.getByLabel("متن نظر")).toHaveCount(0);

  // a customer of this store signs up (through the store's own API path) and writes a review
  const reg = await shop.evaluate(async () => (await fetch("/api/shop/customer/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "09121112233", name: "سارا احمدی", password: "Passw0rd-12345" }) })).status);
  expect(reg).toBeLessThan(300);
  await shop.reload();
  await expect(shop.getByLabel("متن نظر")).toBeVisible();
  await shop.getByLabel("۴", { exact: true }).check();
  await shop.getByLabel("متن نظر").fill("چای خوش‌عطری بود و سریع رسید.");
  await shop.getByRole("button", { name: "ثبت نظر" }).click();
  await expect(shop.getByText("پس از تأیید فروشگاه نمایش داده می‌شود.")).toBeVisible();
  await shop.reload();
  await expect(shop.getByTestId("shop-review")).toHaveCount(0); // still waiting
  expect((await axeOf(shop, "[data-reviews]")).violations.map((v) => v.id)).toEqual([]);

  // the merchant: the sidebar group, the queue, approve, answer
  await page.goto(`/dashboard/stores/${live.storeId}/reviews`);
  await waitForHydration(page, '[data-testid="review-card"] button');
  await expect(page.getByRole("button", { name: "سایت و تم‌ها" })).toHaveAttribute("aria-expanded", "true");
  const card = page.getByTestId("review-card");
  await expect(card).toContainText("سارا احمدی");
  await expect(card).toContainText("در انتظار تأیید");
  expect((await axeOf(page, '[aria-label="نظرها"]')).violations.map((v) => v.id + ": " + v.nodes.map((n) => n.html.slice(0, 160) + " " + n.any[0]?.message).join(" | "))).toEqual([]);
  await card.getByRole("button", { name: /تأیید نظر سارا احمدی/ }).click();
  await expect(page.getByText("نظری در این وضعیت نیست.")).toBeVisible(); // it left the pending tab
  await page.getByRole("tab", { name: "تأیید شده" }).click();
  await page.getByRole("button", { name: /پاسخ به نظر سارا احمدی/ }).click();
  await page.getByLabel("پاسخ عمومی به این نظر").fill("ممنون از اعتماد شما!");
  await page.getByRole("button", { name: "ذخیرهٔ پاسخ" }).click();
  await expect(page.getByTestId("review-card")).toContainText("ممنون از اعتماد شما!");

  // the shopper now sees the review, its rating, the average and the answer; the phone number is nowhere
  await shop.reload();
  const r = shop.getByTestId("shop-review");
  await expect(r).toHaveCount(1);
  await expect(r).toContainText("سارا احمدی");
  await expect(r).toContainText("چای خوش‌عطری بود");
  await expect(r).toContainText("امتیاز ۴ از ۵");
  await expect(r).toContainText("پاسخ فروشگاه: ممنون از اعتماد شما!");
  await expect(shop.getByTestId("reviews-summary")).toContainText("میانگین امتیاز ۴٫۰ از ۵ (۱ نظر)");
  expect(await shop.content()).not.toContain("9121112233");
  expect((await axeOf(shop, "[data-reviews]")).violations.map((v) => v.id)).toEqual([]);
  // a second review of the same product is refused in words
  await expect(shop.getByLabel("متن نظر")).toBeVisible();
  await shop.getByLabel("۵", { exact: true }).check();
  await shop.getByLabel("متن نظر").fill("نظر دوم من درباره همین چای");
  await shop.getByRole("button", { name: "ثبت نظر" }).click();
  await expect(shop.locator("[data-reviews] [role=alert]")).toContainText("قبلاً");
  await context.close();
});
