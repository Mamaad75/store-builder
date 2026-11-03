import {
  GENERIC_LOGIN_ERROR, PASSWORD, RATE_LIMIT_TEXT, createUser, db, expect, formAlert, login,
  loginAndWaitForDashboard, register, test, uniqueEmail,
} from "./helpers";

test.afterAll(() => db.$disconnect());

test.describe("unauthorized dashboard access", () => {
  test("redirects to /login without any session (server-side, no JS needed)", async ({ request, baseURL }) => {
    for (const path of ["/dashboard", "/dashboard/anything/deep"]) {
      const res = await request.get(`${baseURL}${path}`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  });

  test("a forged or garbage session cookie does not grant access", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "authjs.session-token", value: "forged.jwt.value", url: baseURL! }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("registration", () => {
  test("creates an account with an Argon2id hash and lowercased email", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email.toUpperCase());
    await expect(page).toHaveURL(/\/login\?registered=1/);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.authVersion).toBe(0);
  });

  test("shows field validation errors and creates nothing", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email, "x", "short");
    await expect(formAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  test("duplicate email gives the same outcome and leaves the account untouched", async ({ page }) => {
    const email = await createUser(page);
    await register(page, email, "Attacker", "attackerpass1");
    await expect(page).toHaveURL(/\/login\?registered=1/);
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { email } })).name).toBe("علی");
    await login(page, email, "attackerpass1");
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
  });

  test("registration is rate limited per client IP, and spoofed left-hand X-Forwarded-For entries do not help", async ({ page, context, ip }) => {
    for (let i = 0; i < 5; i++) {
      await context.setExtraHTTPHeaders({ "x-forwarded-for": `6.6.6.${i}, ${ip}` }); // attacker rotates a fake IP
      await register(page, uniqueEmail());
      await expect(page).toHaveURL(/\/login\?registered=1/);
    }
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `6.6.6.99, ${ip}` });
    await register(page, uniqueEmail());
    await expect(formAlert(page)).toContainText(RATE_LIMIT_TEXT);
    await expect(page).toHaveURL(/\/register/);
  });
});

test.describe("login and logout", () => {
  test("logs in, reaches the dashboard, sets a hardened cookie and leaks nothing in the session endpoint", async ({ page, context }) => {
    const email = await createUser(page);
    await loginAndWaitForDashboard(page, email);
    await expect(page.getByText("علی", { exact: true })).toBeVisible(); // user name in the app bar

    const cookie = (await context.cookies()).find((c) => c.name === "authjs.session-token");
    expect(cookie).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

    const body = await (await page.request.get("/api/auth/session")).text();
    expect(body).not.toMatch(/argon2|passwordHash|authVersion/);
    expect(JSON.parse(body).user.email).toBe(email);
  });

  test("wrong password and unknown email show the identical generic error", async ({ page }) => {
    const email = await createUser(page);
    await login(page, email, "wrong-password-1");
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    await login(page, uniqueEmail(), PASSWORD);
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout ends access to the dashboard", async ({ page }) => {
    const email = await createUser(page);
    await loginAndWaitForDashboard(page, email);
    await page.getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("callbackUrl cannot redirect to external or non-dashboard locations", async ({ page }) => {
    const email = await createUser(page);
    await page.goto("/login?callbackUrl=" + encodeURIComponent("https://evil.example/"));
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard/);
    expect(new URL(page.url()).hostname).toBe("localhost");
  });

  test("login is rate limited per email; even the correct password is refused while limited", async ({ page }) => {
    const email = await createUser(page);
    for (let i = 0; i < 10; i++) {
      await login(page, email, `wrong-password-${i}`);
      await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    }
    await login(page, email, PASSWORD);
    await expect(formAlert(page)).toContainText(RATE_LIMIT_TEXT);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("session invalidation (authVersion)", () => {
  test("bumping authVersion revokes the existing session and clears the cookie; re-login works", async ({ page, context }) => {
    const email = await createUser(page);
    await loginAndWaitForDashboard(page, email);

    await db.user.update({ where: { email }, data: { authVersion: { increment: 1 } } });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).find((c) => c.name === "authjs.session-token")).toBeUndefined();

    await loginAndWaitForDashboard(page, email);
    await expect(page.getByText("علی", { exact: true })).toBeVisible(); // user name in the app bar
  });

  test("deleting the user revokes the session", async ({ page }) => {
    const email = await createUser(page);
    await loginAndWaitForDashboard(page, email);
    await db.user.delete({ where: { email } });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a revoked session is also rejected by the session endpoint", async ({ page }) => {
    const email = await createUser(page);
    await loginAndWaitForDashboard(page, email);
    await db.user.update({ where: { email }, data: { authVersion: { increment: 1 } } });
    expect(await (await page.request.get("/api/auth/session")).json()).toBeNull();
  });
});
