import type { Browser } from "@playwright/test";
import { createStoreViaUi, db, expect, randomIp, signUpAndIn, test } from "./helpers";

test.afterAll(() => db.$disconnect());

/** A second, independent browser session (own cookies, own client IP) for "User B". */
async function newUserSession(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  const email = await signUpAndIn(page);
  return { context, page, email };
}

test.describe("store management (owner)", () => {
  test("create with a chosen template, edit settings, and delete with typed confirmation", async ({ page }) => {
    await signUpAndIn(page);
    await expect(page.getByText("هنوز فروشگاهی نساخته‌اید")).toBeVisible();

    const id = await createStoreViaUi(page, "فروشگاه من", "پوشاک");
    const row = await db.store.findUniqueOrThrow({ where: { id }, include: { templateVersion: { include: { template: true } }, pages: true } });
    expect(row.templateVersion.template.key).toBe("fashion");
    expect(row.pages).toHaveLength(5);

    await page.fill("input[name=name]", "فروشگاه جدید");
    await page.fill("input[name=phone]", "09120000000");
    await page.fill("input[name=instagram]", "my_shop");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("تغییرات ذخیره شد.")).toBeVisible();
    await page.reload();
    await expect(page.locator("input[name=name]").first()).toHaveValue("فروشگاه جدید");
    await expect(page.locator("input[name=phone]")).toHaveValue("09120000000");
    expect((await db.store.findUniqueOrThrow({ where: { id } })).draftRevision).toBe(2);

    // invalid input is rejected with a message and nothing is saved
    await page.fill("input[name=email]", "not-an-email");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.locator(".MuiAlert-message").first()).toBeVisible();
    expect((await db.store.findUniqueOrThrow({ where: { id } })).draftRevision).toBe(2);

    // delete requires typing the exact name
    const del = page.getByRole("button", { name: "حذف دائمی فروشگاه" });
    await expect(del).toBeDisabled();
    await page.fill("input[name=confirmName]", "اشتباه");
    await expect(del).toBeDisabled();
    await page.fill("input[name=confirmName]", "فروشگاه جدید");
    await expect(del).toBeEnabled();
    await del.click();
    await page.waitForURL(/\/dashboard$/);
    expect(await db.store.count({ where: { id } })).toBe(0);
    expect(await db.page.count({ where: { storeId: id } })).toBe(0);
    await expect(page.getByText("هنوز فروشگاهی نساخته‌اید")).toBeVisible();
  });

  test("enforces the 10-store limit in the UI and on the server", async ({ page }) => {
    const email = await signUpAndIn(page);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const tv = await db.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
    await db.store.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ ownerId: user.id, templateVersionId: tv.id, name: `s${i}`, settings: {} })),
    });
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "ساخت فروشگاه جدید" })).toHaveCount(0);

    await page.goto("/dashboard/stores/new"); // direct URL still reachable; the server must refuse
    await page.fill("input[name=name]", "eleventh");
    await page.getByRole("button", { name: "ساخت فروشگاه" }).click();
    await expect(page.locator(".MuiAlert-message").first()).toContainText("۱۰");
    expect(await db.store.count({ where: { ownerId: user.id } })).toBe(10);
  });
});

test.describe("tenant isolation (two real users)", () => {
  test("unauthenticated users cannot reach store pages", async ({ request, baseURL }) => {
    for (const p of ["/dashboard/stores/new", "/dashboard/stores/anything"]) {
      const res = await request.get(`${baseURL}${p}`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  });

  test("A gets the identical 404 for B's store and for a non-existent store, and never sees B's data in lists", async ({ page, browser }) => {
    await signUpAndIn(page);
    await createStoreViaUi(page, "فروشگاه الف");
    const b = await newUserSession(browser);
    const bId = await createStoreViaUi(b.page, "فروشگاه محرمانه ب");

    const foreign = await page.goto(`/dashboard/stores/${bId}`);
    const foreignText = await page.locator("body").innerText();
    const missing = await page.goto("/dashboard/stores/cmnonexistent0000000000000");
    const missingText = await page.locator("body").innerText();
    expect(foreign!.status()).toBe(404);
    expect(missing!.status()).toBe(404);
    expect(foreignText).toBe(missingText);
    expect(foreignText).not.toContain("محرمانه");

    await page.goto("/dashboard");
    await expect(page.getByText("فروشگاه الف")).toBeVisible();
    await expect(page.getByText("محرمانه")).toHaveCount(0);

    // B still sees their own store
    await b.page.goto(`/dashboard/stores/${bId}`);
    await expect(b.page.locator("h1")).toContainText("فروشگاه محرمانه ب");
    await b.context.close();
  });

  test("forged Server Action requests from A (tampered hidden storeId) cannot update or delete B's store", async ({ page, browser }) => {
    const aEmail = await signUpAndIn(page);
    const aId = await createStoreViaUi(page, "A-shop");
    const b = await newUserSession(browser);
    const bId = await createStoreViaUi(b.page, "B-shop");
    const bBefore = await db.store.findUniqueOrThrow({ where: { id: bId } });
    const aUser = await db.user.findUniqueOrThrow({ where: { email: aEmail } });

    // --- forged UPDATE: swap the hidden storeId to B's id, add forged ownership fields, submit
    await page.goto(`/dashboard/stores/${aId}`);
    await page.evaluate((target) => {
      const form = document.querySelector<HTMLFormElement>("form:has(input[name=primaryColor])")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = target.bId;
      for (const [k, v] of Object.entries({ ownerId: target.uid, userId: target.uid, status: "PUBLISHED" })) {
        const i = document.createElement("input");
        i.type = "hidden"; i.name = k; i.value = v; form.appendChild(i);
      }
      form.querySelector<HTMLInputElement>("input[name=name]")!.value = "PWNED";
    }, { bId, uid: aUser.id });
    // prove the forged value is what will really be submitted
    const sent = await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>("form:has(input[name=primaryColor])")!;
      return Object.fromEntries(new FormData(form).entries());
    });
    expect(sent["storeId"]).toBe(bId);
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await page.waitForURL(`**/dashboard/stores/${bId}`);
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible(); // real 404 page, same as a non-existent id

    // --- forged DELETE: target B's id with B's exact name. The UI keeps the button disabled (the typed
    // name does not match A's store), so submit the form directly, exactly like a crafted request would.
    await page.goto(`/dashboard/stores/${aId}`);
    const sentDelete = await page.evaluate((target) => {
      const form = document.querySelector<HTMLFormElement>("form:has(input[name=confirmName])")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = target.bId;
      const typed = form.querySelector<HTMLInputElement>("input[name=confirmName]")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(typed, "B-shop");
      const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
      form.requestSubmit();
      return { storeId: data["storeId"], confirmName: data["confirmName"] };
    }, { bId });
    expect(sentDelete).toEqual({ storeId: bId, confirmName: "B-shop" }); // the forged values really were submitted
    await page.waitForURL(`**/dashboard/stores/${bId}`);
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();

    // B's store is byte-for-byte unchanged and still owned by B; A's own store is untouched too
    const bAfter = await db.store.findUniqueOrThrow({ where: { id: bId }, include: { pages: true } });
    expect({ ...bAfter, pages: undefined }).toEqual({ ...bBefore, pages: undefined });
    expect(bAfter.pages).toHaveLength(5);
    expect((await db.store.findUniqueOrThrow({ where: { id: aId } })).name).toBe("A-shop");
    await b.context.close();
  });
});
