import {
  GENERIC_LOGIN_ERROR, PASSWORD, RATE_LIMIT_TEXT, createUser, db, expect, formAlert, login,
  loginAndWaitForDashboard, register, test, uniqueUsername,
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

test.describe("username sign-in (ADR 0001, U1)", () => {
  test("the forms ask for a username, never an e-mail, and the old password-reset pages are gone (real 404)", async ({ page, request, baseURL }) => {
    for (const path of ["/login", "/register"]) {
      await page.goto(path);
      await expect(page.locator("input[name=username]"), path).toBeVisible();
      await expect(page.locator("input[name=email]"), path).toHaveCount(0);
    }
    await page.goto("/login");
    await expect(page.getByText("فراموش کرده")).toHaveCount(0);
    for (const path of ["/forgot-password", "/reset-password?token=x"]) {
      expect((await request.get(`${baseURL}${path}`)).status(), path).toBe(404);
    }
  });
});

test.describe("registration", () => {
  test("creates an account with an Argon2id hash, a lower-cased username and no e-mail", async ({ page }) => {
    const username = uniqueUsername();
    await register(page, username.toUpperCase());
    await expect(page).toHaveURL(/\/login\?registered=1/);
    const user = await db.user.findUniqueOrThrow({ where: { username } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.authVersion).toBe(0);
    expect(user.email).toBeNull();
  });

  test("shows field validation errors and creates nothing", async ({ page }) => {
    const username = uniqueUsername();
    await register(page, username, "x", "short");
    await expect(formAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { username } })).toBe(0);
  });

  test("a taken username is reported on the form and the existing account stays untouched", async ({ page }) => {
    const username = await createUser(page);
    await register(page, username, "Attacker", "attackerpass1");
    await expect(formAlert(page)).toContainText("قبلاً گرفته شده");
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { username } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { username } })).name).toBe("علی");
    await login(page, username, "attackerpass1");
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
  });

  test("registration is rate limited per client IP, and spoofed left-hand X-Forwarded-For entries do not help", async ({ page, context, ip }) => {
    for (let i = 0; i < 5; i++) {
      await context.setExtraHTTPHeaders({ "x-forwarded-for": `6.6.6.${i}, ${ip}` }); // attacker rotates a fake IP
      await register(page, uniqueUsername());
      await expect(page).toHaveURL(/\/login\?registered=1/);
    }
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `6.6.6.99, ${ip}` });
    await register(page, uniqueUsername());
    await expect(formAlert(page)).toContainText(RATE_LIMIT_TEXT);
    await expect(page).toHaveURL(/\/register/);
  });
});

test.describe("login and logout", () => {
  test("logs in, reaches the dashboard, sets a hardened cookie and leaks nothing in the session endpoint", async ({ page, context }) => {
    const username = await createUser(page);
    await loginAndWaitForDashboard(page, username);
    await expect(page.getByText("علی", { exact: true })).toBeVisible(); // user name in the app bar

    const cookie = (await context.cookies()).find((c) => c.name === "authjs.session-token");
    expect(cookie).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

    const body = await (await page.request.get("/api/auth/session")).text();
    expect(body).not.toMatch(/argon2|passwordHash|authVersion/);
    expect(JSON.parse(body).user.name).toBe("علی");
  });

  test("wrong password and unknown username show the identical generic error", async ({ page }) => {
    const username = await createUser(page);
    await login(page, username, "wrong-password-1");
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    await login(page, uniqueUsername(), PASSWORD);
    await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout ends access to the dashboard", async ({ page }) => {
    const username = await createUser(page);
    await loginAndWaitForDashboard(page, username);
    await page.getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("callbackUrl cannot redirect to external or non-dashboard locations", async ({ page }) => {
    const username = await createUser(page);
    await page.goto("/login?callbackUrl=" + encodeURIComponent("https://evil.example/"));
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard/);
    expect(new URL(page.url()).hostname).toBe("localhost");
  });

  test("login is rate limited per username; even the correct password is refused while limited", async ({ page }) => {
    const username = await createUser(page);
    for (let i = 0; i < 10; i++) {
      await login(page, username, `wrong-password-${i}`);
      await expect(formAlert(page)).toHaveText(GENERIC_LOGIN_ERROR);
    }
    await login(page, username, PASSWORD);
    await expect(formAlert(page)).toContainText(RATE_LIMIT_TEXT);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("session invalidation (authVersion)", () => {
  test("bumping authVersion revokes the existing session and clears the cookie; re-login works", async ({ page, context }) => {
    const username = await createUser(page);
    await loginAndWaitForDashboard(page, username);

    await db.user.update({ where: { username }, data: { authVersion: { increment: 1 } } });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).find((c) => c.name === "authjs.session-token")).toBeUndefined();

    await loginAndWaitForDashboard(page, username);
    await expect(page.getByText("علی", { exact: true })).toBeVisible(); // user name in the app bar
  });

  test("deleting the user revokes the session", async ({ page }) => {
    const username = await createUser(page);
    await loginAndWaitForDashboard(page, username);
    await db.user.delete({ where: { username } });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a revoked session is also rejected by the session endpoint", async ({ page }) => {
    const username = await createUser(page);
    await loginAndWaitForDashboard(page, username);
    await db.user.update({ where: { username }, data: { authVersion: { increment: 1 } } });
    expect(await (await page.request.get("/api/auth/session")).json()).toBeNull();
  });
});
