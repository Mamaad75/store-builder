import { PASSWORD, countMailsTo, createStoreViaUi, createUser, db, expect, login, loginAndWaitForDashboard, readMailTo, resetLinkFrom, signUpAndIn, test, uniqueEmail } from "./helpers";

test.afterAll(() => db.$disconnect());

const NEW_PASSWORD = "a-brand-new-pass-9";

test.describe("password reset", () => {
  test("request -> emailed link -> new password; old password and old sessions stop working; the link is single-use", async ({ page, browser, ip }) => {
    const email = await createUser(page);
    // a second browser is signed in before the reset
    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
    const op = await other.newPage();
    await loginAndWaitForDashboard(op, email);

    await page.goto("/forgot-password");
    await page.fill("input[name=email]", email);
    await page.click("button[type=submit]");
    await expect(page.getByTestId("forgot-sent")).toBeVisible();

    const link = resetLinkFrom((await readMailTo(email)).text);
    await page.goto(link);
    await expect(page.locator("input[name=password]")).toBeVisible();
    await page.fill("input[name=password]", NEW_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/login\?notice=password-reset/);
    await expect(page.getByTestId("login-notice")).toBeVisible();

    // the session that existed before the reset is gone
    await op.goto("/dashboard");
    await expect(op).toHaveURL(/\/login/);
    await other.close();

    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login/); // old password refused
    await login(page, email, NEW_PASSWORD);
    await page.waitForURL(/\/dashboard/);

    // the same link cannot be used twice
    await page.goto(link);
    await expect(page.getByTestId("reset-invalid")).toBeVisible();
    // nothing is left behind once the reset is done
    expect(await db.passwordResetToken.count({ where: { user: { email } } })).toBe(0);
  });

  test("an unknown address gets the very same confirmation and no email is sent", async ({ page }) => {
    const ghost = uniqueEmail();
    await page.goto("/forgot-password");
    await page.fill("input[name=email]", ghost);
    await page.click("button[type=submit]");
    await expect(page.getByTestId("forgot-sent")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countMailsTo(ghost)).toBe(0);
  });

  test("garbage, truncated and unknown tokens are all the same neutral 'invalid link' page", async ({ page }) => {
    for (const t of ["", "x", "A".repeat(43), "../../etc/passwd"]) {
      await page.goto(`/reset-password?token=${encodeURIComponent(t)}`);
      await expect(page.getByTestId("reset-invalid")).toBeVisible();
      await expect(page.locator("input[name=password]")).toHaveCount(0);
    }
  });

  test("the reset page is noindex and sends no referrer", async ({ page }) => {
    await page.goto("/reset-password?token=x");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });
});

test.describe("account page", () => {
  test("changing the password needs the current one, then ends every session", async ({ page }) => {
    const email = await signUpAndIn(page);
    await page.goto("/dashboard/account");
    await page.fill("input[name=currentPassword]", "wrong-password-1");
    await page.fill("input[name=newPassword]", NEW_PASSWORD);
    await page.click("button:has-text('تغییر رمز عبور')");
    await expect(page.getByText("رمز عبور فعلی نادرست است")).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { email } })).authVersion).toBe(0);

    await page.fill("input[name=currentPassword]", PASSWORD);
    await page.fill("input[name=newPassword]", NEW_PASSWORD);
    await page.click("button:has-text('تغییر رمز عبور')");
    await page.waitForURL(/\/login\?notice=password-changed/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/login/);
    await login(page, email, NEW_PASSWORD);
    await page.waitForURL(/\/dashboard/);
  });

  test("'sign out everywhere' ends this and every other session, and the password still works", async ({ page, browser, ip }) => {
    const email = await signUpAndIn(page);
    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
    const op = await other.newPage();
    await loginAndWaitForDashboard(op, email);

    await page.goto("/dashboard/account");
    await page.click("button:has-text('خروج از همه دستگاه‌ها')");
    await page.waitForURL(/\/login\?notice=signed-out-everywhere/);
    await op.goto("/dashboard");
    await expect(op).toHaveURL(/\/login/);
    await other.close();
    await login(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
  });

  test("the account page needs a session", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/dashboard/account`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
  });
});

test.describe("landing, legal, errors and accessibility", () => {
  test("the landing page is indexable, has one h1, links to sign-up and the legal pages", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await expect(page.getByRole("main")).toBeVisible();
    await page.getByRole("link", { name: "ثبت‌نام" }).first().click();
    await expect(page).toHaveURL(/\/register/);
    await page.goto("/");
    await page.getByRole("link", { name: "شرایط استفاده" }).click();
    await expect(page).toHaveURL(/\/terms/);
    await expect(page.getByTestId("legal-draft")).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await page.goto("/privacy");
    await expect(page.getByTestId("legal-draft")).toBeVisible();
  });

  test("an unknown page is a real 404 with a way back", async ({ page }) => {
    const res = await page.goto("/no-such-page");
    expect(res!.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("صفحه پیدا نشد");
    await expect(page.getByRole("link", { name: "بازگشت به صفحه اصلی" })).toBeVisible();
  });

  test("the legal pages are not served on a store host", async ({ request }) => {
    for (const p of ["/terms", "/privacy"]) {
      const res = await request.get(`http://127.0.0.1:3100${p}`, { headers: { host: "evil.com" }, failOnStatusCode: false });
      expect(res.status()).toBe(404);
    }
  });

  test("the dashboard has a skip link as the first tab stop, a main landmark and a labelled nav", async ({ page }) => {
    await signUpAndIn(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "پرش به محتوای اصلی" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await skip.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "منوی حساب" })).toBeVisible();
  });

  test("every public auth form control has an accessible name", async ({ page }) => {
    for (const [path, labels] of [["/login", ["ایمیل", "رمز عبور"]], ["/register", ["نام", "ایمیل", "رمز عبور"]], ["/forgot-password", ["ایمیل"]]] as const) {
      await page.goto(path);
      for (const l of labels) await expect(page.getByLabel(l, { exact: false }).first(), `${path} ${l}`).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
    }
  });
});

test.describe("onboarding checklist", () => {
  test("follows the merchant's progress and links into the right place", async ({ page }) => {
    await signUpAndIn(page);
    const box = page.getByTestId("onboarding");
    await expect(box).toBeVisible();
    await expect(box.locator('[data-step=store]')).toHaveAttribute("data-done", "false");
    await box.getByRole("link", { name: "ساخت فروشگاه" }).click();
    await expect(page).toHaveURL(/\/dashboard\/stores\/new/);

    const storeId = await createStoreViaUi(page, "فروشگاه راهنما", "فروشگاه عمومی");
    await page.goto("/dashboard");
    await expect(box.locator('[data-step=store]')).toHaveAttribute("data-done", "true");
    await expect(box.locator('[data-step=category]')).toHaveAttribute("data-done", "false");
    await box.getByRole("link", { name: "افزودن دسته‌بندی" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/stores/${storeId}/categories`));
  });
});
