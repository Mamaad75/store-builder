import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { apiSignUp, createLiveStore, makeSuperAdmin, shopper } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
const clean = async (page: Page, what: string) => expect((await axe(page)).violations.map((v) => `${what} ${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);

/** Finance end to end: staff make a plan, an invited store enters its code, staff record its first purchase, the inviter earns credit. */
test("finance: plan, referral code, first purchase with the 10% discount, the inviter's wallet", async ({ page, browser }) => {
  // staff
  const { context: staffCtx, page: staff } = await shopper(browser);
  await makeSuperAdmin(staff);
  await staff.goto("/platform/plans");
  await waitForHydration(staff, "main button");
  await staff.getByRole("button", { name: "پلن تازه" }).click();
  await staff.getByLabel("نام پلن").fill("ماهانه");
  await staff.getByLabel("قیمت (تومان)").fill("500000");
  await staff.getByLabel("مدت (روز)").fill("30");
  await staff.getByRole("button", { name: "ذخیره" }).click();
  await expect(staff.getByTestId("plan-row")).toContainText("ماهانه");
  await expect(staff.getByTestId("plan-row")).toContainText("۳۰ روز");
  await clean(staff, "plans");

  // the inviter (this browser)
  await apiSignUp(page, "دعوت‌کننده");
  const inviter = await createLiveStore(page);
  await page.goto(`/dashboard/stores/${inviter.storeId}/referrals`);
  await expect(page.getByTestId("referral-code")).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);
  const code = (await page.getByTestId("referral-code").innerText()).trim();
  await expect(page.getByTestId("referral-count")).toHaveText("۰");
  await clean(page, "referrals");
  // the sidebar group is open on finance pages
  await expect(page.getByRole("button", { name: "مالی" })).toHaveAttribute("aria-expanded", "true");

  // the invited store: the link shows the banner, then the code is entered under Finance
  const { context: invCtx, page: invited } = await shopper(browser);
  await invited.goto(`/register?ref=${code}`);
  await expect(invited.getByTestId("ref-banner")).toContainText(code);
  await apiSignUp(invited, "دعوت‌شده");
  const friend = await createLiveStore(invited);
  await invited.goto(`/dashboard/stores/${friend.storeId}/referrals`);
  await waitForHydration(invited, "form button[type=submit]");
  await invited.getByRole("textbox", { name: "کد معرف" }).fill("ZZZZZZZZ");
  await invited.getByRole("button", { name: "ثبت کد" }).click();
  await expect(invited.getByText("این کد معرف پیدا نشد.")).toBeVisible();
  await invited.getByRole("textbox", { name: "کد معرف" }).fill(code.toLowerCase());
  await invited.getByRole("button", { name: "ثبت کد" }).click();
  await expect(invited.getByTestId("invited-notice")).toContainText("۱۰٪ تخفیف");
  await invited.goto(`/dashboard/stores/${friend.storeId}/billing`);
  await expect(invited.getByTestId("invite-discount")).toBeVisible();
  await expect(invited.getByTestId("plan-card")).toContainText("۵۰۰٬۰۰۰ تومان");
  await clean(invited, "billing");

  // staff record the first purchase: the preview and the result agree on 450,000
  await staff.goto(`/platform/stores/${friend.storeId}/billing`);
  await waitForHydration(staff, "form button[type=submit]");
  await expect(staff.getByTestId("purchase-preview")).toContainText("دریافت ۴۵۰٬۰۰۰ تومان");
  await staff.getByLabel(/یادداشت/).fill("کارت به کارت · پیگیری ۱۲۳");
  await staff.getByRole("button", { name: "ثبت خرید" }).click();
  await expect(staff.getByTestId("purchase-result")).toContainText("مبلغ دریافتی: ۴۵۰٬۰۰۰ تومان");
  await expect(staff.getByTestId("purchase-result")).toContainText("پاداش دعوت‌کننده: ۴۵٬۰۰۰ تومان");
  await expect(staff.getByTestId("staff-state")).toContainText("۳۰ روز مانده");
  await clean(staff, "staff billing");

  // the invited store sees its subscription and the purchase; the discount is used up
  await invited.goto(`/dashboard/stores/${friend.storeId}/billing`);
  await expect(invited.getByTestId("subscription-card")).toContainText("ماهانه");
  await expect(invited.getByTestId("subscription-card")).toContainText("فعال");
  await expect(invited.getByTestId("purchase-row")).toContainText("۴۵۰٬۰۰۰ تومان");
  await expect(invited.getByTestId("invite-discount")).toHaveCount(0);

  // the inviter's wallet got 45,000, and the referral shows as rewarded
  await page.goto(`/dashboard/stores/${inviter.storeId}/wallet`);
  await expect(page.getByTestId("wallet-balance")).toHaveText("۴۵٬۰۰۰ تومان");
  await expect(page.getByTestId("wallet-row")).toContainText("هدیهٔ دعوت از دوستان");
  await clean(page, "wallet");
  await page.goto(`/dashboard/stores/${inviter.storeId}/referrals`);
  await expect(page.getByTestId("referral-count")).toHaveText("۱");
  await expect(page.getByTestId("referral-earned")).toHaveText("۴۵٬۰۰۰ تومان");

  // staff adjust the wallet: a refusal in words, then success
  await staff.goto(`/platform/stores/${inviter.storeId}/billing`);
  await waitForHydration(staff, "form button[type=submit]");
  await staff.getByLabel(/مبلغ/).fill("-100000");
  await staff.getByLabel("دلیل").fill("اصلاح آزمایشی");
  await staff.getByRole("button", { name: "ثبت", exact: true }).click();
  await expect(staff.getByText(/اعتبار کیف پول برای این کاهش کافی نیست/)).toBeVisible();
  await staff.getByLabel(/مبلغ/).fill("5000");
  await staff.getByRole("button", { name: "ثبت", exact: true }).click();
  await expect(staff.getByTestId("staff-balance")).toHaveText("۵۰٬۰۰۰ تومان");

  await staffCtx.close();
  await invCtx.close();
});
