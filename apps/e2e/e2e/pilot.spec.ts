import { apiSignUp, makeSuperAdmin, shopper } from "./commerce";
import { PASSWORD, db, expect, test, uniqueUsername, waitForHydration } from "./helpers";

/**
 * MVP item 2 (pilot access controls) in the browser: invite-only sign-up with a code issued on /platform/access, and admin-assisted
 * account recovery (link → new password → the owner sees the notice). The E2E database is opened for the other suites (global setup);
 * this spec switches it to invite-only and always restores it.
 */
const setMode = (mode: "invite" | "open") =>
  db.platformSetting.upsert({ where: { key: "registration" }, create: { key: "registration", value: { mode } }, update: { value: { mode } } });

test.afterEach(async () => {
  await setMode("open");
});

test("invite-only sign-up: the form asks for a code; an invitation link issued on /platform/access creates the account", async ({ page, browser }) => {
  await makeSuperAdmin(page);
  await page.goto("/platform/access");
  await waitForHydration(page, "form");
  // Switch to invite-only through the page (the switch reflects the open E2E database).
  await page.getByRole("switch", { name: /ثبت‌نام آزاد است/ }).click();
  await expect(page.getByText("ثبت‌نام فقط با کد دعوت ممکن است.")).toBeVisible();

  const { context, page: seller } = await shopper(browser);
  await seller.goto("/register");
  await expect(seller.getByLabel("کد دعوت")).toBeVisible();

  await page.getByLabel("یادداشت (برای چه کسی)").fill("فروشنده‌ی پایلوت");
  await page.getByRole("button", { name: "ساخت کد دعوت" }).click();
  const issued = page.getByTestId("invite-issued");
  await expect(issued).toContainText("پیوند ثبت‌نام");
  const link = (await issued.textContent())!.match(/http:\/\/localhost:3100\/register\?invite=[A-Za-z0-9_-]{22}/)![0];

  await seller.goto(link);
  await waitForHydration(seller, "form");
  await expect(seller.locator("input[name=inviteCode]")).toHaveValue(link.split("=")[1]!);
  const username = uniqueUsername();
  await seller.fill("input[name=name]", "فروشنده‌ی پایلوت");
  await seller.fill("input[name=username]", username);
  await seller.fill("input[name=password]", PASSWORD);
  await seller.getByRole("button", { name: "ثبت‌نام" }).click();
  await seller.waitForURL(/\/login\?registered=1/);
  await page.reload(); // the list shows the code as used, by this account
  await expect(page.getByRole("region", { name: "فهرست کدهای دعوت" })).toContainText("استفاده‌شده");
  await expect(page.getByRole("region", { name: "فهرست کدهای دعوت" })).toContainText(username);
  expect(await db.user.count({ where: { username } })).toBe(1);
  await context.close();
});

test("account recovery: admin issues a link after an out-of-band check; old sessions end; the owner sets a new password and sees the notice", async ({ page, browser }) => {
  const { context, page: owner } = await shopper(browser);
  const ownerName = await apiSignUp(owner, "صاحب فروشگاه");
  await owner.goto("/dashboard");
  await expect(owner.getByRole("heading", { name: "فروشگاه‌های من" })).toBeVisible();

  await makeSuperAdmin(page);
  await page.goto("/platform/access");
  await waitForHydration(page, "form");
  await page.getByLabel("نام کاربری فروشنده").fill(ownerName);
  await page.getByRole("button", { name: "جستجو" }).click();
  await page.getByLabel("دلیل (چه کسی، چگونه بررسی شد)").fill("تماس تلفنی با شماره‌ی ثبت‌شده و تطبیق نام فروشگاه");
  await page.getByRole("checkbox", { name: /هویت صاحب این حساب/ }).check();
  await page.getByLabel("رمز عبور خودتان (برای تأیید)").fill(PASSWORD);
  await page.getByRole("button", { name: "ساخت پیوند بازیابی" }).click();
  const issued = page.getByTestId("recovery-issued");
  await expect(issued).toBeVisible();
  const link = (await issued.textContent())!.match(/http:\/\/localhost:3100\/recover\?token=[A-Za-z0-9_-]{43}/)![0];

  // The owner's existing session is over.
  await owner.goto("/dashboard");
  await owner.waitForURL(/\/login/);

  await owner.goto(link);
  await waitForHydration(owner, "form");
  await owner.getByLabel(/^رمز عبور تازه/).fill("a-new-strong-password");
  await owner.getByLabel(/^تکرار رمز عبور تازه/).fill("a-new-strong-password");
  await owner.getByRole("button", { name: "ثبت رمز عبور تازه" }).click();
  await owner.waitForURL(/\/login\?notice=recovered/);
  await expect(owner.getByText("رمز عبور تازه ثبت شد. با رمز جدید وارد شوید.")).toBeVisible();

  await waitForHydration(owner, "form");
  await owner.fill("input[name=username]", ownerName);
  await owner.fill("input[name=password]", "a-new-strong-password");
  await owner.getByRole("button", { name: "ورود" }).click();
  await owner.waitForURL(/\/dashboard/);
  await expect(owner.getByTestId("recovery-notice")).toContainText("توسط پشتیبانی پلتفرم بازنشانی شد");
  await context.close();
});
