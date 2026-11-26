import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, createLiveStore, shopper, storeRequest, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

const axeOf = (page: import("@playwright/test").Page, include?: string) => {
  const b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  return (include ? b.include(include) : b).analyze();
};
async function republish(page: import("@playwright/test").Page, storeId: string) {
  const state = (await (await api(page, "GET", `/stores/${storeId}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${storeId}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision })).ok()).toBe(true);
}

/** The blog end to end: the merchant writes in the dashboard, it goes live with the next publish, shoppers read it inside the store's theme. */
test("blog: write, keep a draft private, publish, and read it on the store", async ({ page, browser }) => {
  await apiSignUp(page);
  const live = await createLiveStore(page);
  await page.goto(`/dashboard/stores/${live.storeId}/blog/new`);
  await waitForHydration(page, "form button[type=submit]");

  // a short title is refused in words, nothing is created
  await page.getByLabel(/^عنوان/).fill("ab");
  await page.getByLabel("متن مقاله").fill("متن کامل مقاله برای آزمون <script>alert(1)</script>");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByText(/عنوان را کامل‌تر بنویسید/)).toBeVisible();

  // write a published post and a draft
  await page.getByLabel(/^عنوان/).fill("راهنمای دم کردن چای");
  await page.getByLabel(/خلاصه/).fill("سه نکتهٔ ساده برای یک چای خوب");
  await page.getByLabel("متن مقاله").fill("## آب مناسب\nآب تازه و صاف را بجوشانید.\n\nپاراگراف دوم <script>alert(1)</script> فقط متن است.");
  await page.getByLabel("وضعیت").click();
  await page.getByRole("option", { name: "آمادهٔ انتشار" }).click();
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForURL(/\/blog\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "ویرایش مقاله" })).toBeVisible();
  expect((await axeOf(page)).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);

  await api(page, "POST", `/stores/${live.storeId}/blog`, { title: "پیش‌نویس محرمانه", body: "این متن هنوز آماده نیست و نباید دیده شود.", status: "DRAFT" });
  await page.goto(`/dashboard/stores/${live.storeId}/blog`);
  await expect(page.getByTestId("post-row")).toHaveCount(2);
  await expect(page.getByTestId("post-row").filter({ hasText: "پیش‌نویس محرمانه" })).toContainText("پیش‌نویس");

  // before the store is published again, the live site has no blog
  const { context, page: shop } = await shopper(browser);
  expect((await storeRequest(shop, live.label, "/blog")).status()).toBe(404);

  await republish(page, live.storeId);
  await shop.goto(storeUrl(live.label, "/"));
  await shop.getByRole("link", { name: "وبلاگ" }).first().click();
  await expect(shop.getByRole("heading", { name: "وبلاگ", level: 1 })).toBeVisible();
  await expect(shop.getByText("راهنمای دم کردن چای")).toBeVisible();
  await expect(shop.getByText("سه نکتهٔ ساده برای یک چای خوب")).toBeVisible();
  await expect(shop.getByText("پیش‌نویس محرمانه")).toHaveCount(0);
  expect((await axeOf(shop)).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);

  await shop.getByRole("link", { name: "راهنمای دم کردن چای" }).click();
  await expect(shop.getByRole("heading", { name: "راهنمای دم کردن چای", level: 1 })).toBeVisible();
  await expect(shop.getByRole("heading", { name: "آب مناسب", level: 2 })).toBeVisible();
  await expect(shop.getByText("پاراگراف دوم <script>alert(1)</script> فقط متن است.")).toBeVisible(); // text, not markup
  await expect(shop).toHaveTitle(/راهنمای دم کردن چای/);
  expect((await axeOf(shop)).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);
  const sitemap = await (await storeRequest(shop, live.label, "/sitemap.xml")).text();
  expect(sitemap).toContain("/blog");
  expect(sitemap).not.toContain("%D9%BE%DB%8C%D8%B4"); // the draft's link is not listed

  // no horizontal scroll at phone width
  await shop.setViewportSize({ width: 320, height: 700 });
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // delete in the dashboard; the live site keeps it until the next publish, then it is gone (and so is the blog link)
  await page.goto(`/dashboard/stores/${live.storeId}/blog`);
  await page.getByRole("link", { name: "راهنمای دم کردن چای" }).click();
  await waitForHydration(page, "form button[type=submit]");
  await page.getByRole("button", { name: "حذف مقاله" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForURL(/\/blog$/);
  await shop.goto(storeUrl(live.label, "/blog"));
  await expect(shop.getByText("راهنمای دم کردن چای")).toBeVisible();
  await republish(page, live.storeId);
  expect((await storeRequest(shop, live.label, "/blog")).status()).toBe(404);
  await context.close();
});
