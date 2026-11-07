import type { Browser, Page } from "@playwright/test";
import { createProductViaUi, createStoreViaUi, db, expect, productRow, randomIp, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());

const activate = async (page: Page, storeId: string, name: string) => {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await productRow(page, name).getByRole("button", { name: "فعال‌سازی" }).click();
  await expect(productRow(page, name)).toContainText("فعال");
};
const sectionsOf = async (storeId: string, type: string) => (await db.page.findFirstOrThrow({ where: { storeId, type: type as never } })).sections as { id: string; type: string; props: Record<string, unknown> }[];

test.describe("creating stores: business category and theme are separate choices", () => {
  for (const [theme, label] of [["general", "ساده و همه‌منظوره"], ["coffee", "گرم و ادیتوریال"], ["fashion", "مینیمال و مدرن"]] as const) {
    test(`theme ${theme} renders with its own design; the preview works end to end`, async ({ page }) => {
      await signUpAndIn(page);
      const storeId = await createStoreViaUi(page, `فروشگاه ${theme}`, theme);
      const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { templateVersion: { include: { template: true } } } });
      expect(store.templateVersion.template.key).toBe(theme);
      await createProductViaUi(page, storeId, { name: "محصول نمونه", price: "125000", stock: "3" });
      await activate(page, storeId, "محصول نمونه");
      for (const path of ["", "/products", "/about", "/contact"]) {
        const res = await page.goto(`/preview/${storeId}${path}`);
        expect(res?.status(), path).toBe(200);
        await expect(page.locator(`[data-template=${theme}]`), path).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      }
      await page.goto(`/preview/${storeId}/products`);
      await expect(page.getByText("۱۲۵٬۰۰۰ تومان")).toBeVisible();
      // the dashboard card names the theme by its visual direction and shows the category
      await page.goto("/dashboard");
      await expect(page.getByText(label)).toBeVisible();
    });
  }

  test("any category can be combined with any theme (a fashion shop can use the warm coffee theme); starter text follows the CATEGORY", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "پوشاک گرم", "coffee", "fashion");
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { templateVersion: { include: { template: true } } } });
    expect([store.businessCategory, store.templateVersion.template.key]).toEqual(["fashion", "coffee"]);
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("[data-template=coffee]")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("استایل خودتان را پیدا کنید"); // fashion starter text inside the coffee theme
  });

  test("choosing a category only SUGGESTS a theme; the user can still pick another", async ({ page }) => {
    await signUpAndIn(page);
    await page.goto("/dashboard/stores/new");
    await waitForHydration(page, "form:has(input[name=templateKey])");
    await page.locator("[data-category-key=coffee-food] button").click();
    await expect(page.locator("input[name=templateKey]")).toHaveValue("coffee");
    await page.locator("[data-theme-key=fashion] button").click();
    await expect(page.locator("input[name=templateKey]")).toHaveValue("fashion");
    await expect(page.locator("input[name=businessCategory]")).toHaveValue("coffee-food");
  });
});

test.describe("theme-specific sections", () => {
  // Several multi-step editor flows: allow a throttled/slow CI machine more than the default 30 s per test.
  test.describe.configure({ timeout: 90_000 });
  test("coffee: add opening hours from the editor, edit it, see it in the preview", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "کافه", "coffee");
    await page.goto(`/dashboard/stores/${storeId}/pages/contact`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await waitForHydration(page, "select[name=sectionType]"); // the controlled select hydrates separately under load
    await page.locator("select[name=sectionType]").selectOption({ label: "ساعت کاری" });
    await page.getByRole("button", { name: "افزودن", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بخش اضافه شد." }).first()).toBeVisible({ timeout: 20_000 });
    const card = page.locator("[data-section-type='coffee.openingHours']");
    await card.locator("button[aria-expanded]").first().click();
    await card.getByLabel(/ساعت‌ها/).fill("شنبه تا چهارشنبه: ۸ تا ۲۲\nجمعه: ۱۰ تا ۲۳");
    await card.getByRole("button", { name: "ذخیرهٔ بخش" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بخش ذخیره شد." }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`/preview/${storeId}/contact`);
    await expect(page.getByRole("heading", { name: "ساعت کاری" })).toBeVisible();
    await expect(page.getByText("جمعه")).toBeVisible();
    await expect(page.getByText("۱۰ تا ۲۳")).toBeVisible();
  });

  test("fashion: the size guide renders as a table; it is not offered by the coffee or general theme", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "مد", "fashion");
    await page.goto(`/dashboard/stores/${storeId}/pages/about`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await waitForHydration(page, "select[name=sectionType]");
    await page.locator("select[name=sectionType]").selectOption({ label: "راهنمای سایز" });
    await page.getByRole("button", { name: "افزودن", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بخش اضافه شد." }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "دور سینه" })).toBeVisible();

    const other = await createStoreViaUi(page, "عمومی", "general");
    await page.goto(`/dashboard/stores/${other}/pages/about`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await expect(page.locator("select[name=sectionType] option", { hasText: "راهنمای سایز" })).toHaveCount(0);
    await expect(page.locator("select[name=sectionType] option", { hasText: "ساعت کاری" })).toHaveCount(0);
  });

  test("a section of another theme is DORMANT: shown as inactive, kept untouched, not rendered, and only the owner can delete it", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "عمومی با بخش دیگر", "general");
    const hours = { id: "hours1", type: "coffee.openingHours", props: { title: "ساعت کاری ویژه", body: "شنبه: ۸ تا ۲۲", note: "" } };
    const about = await sectionsOf(storeId, "ABOUT");
    await db.page.updateMany({ where: { storeId, type: "ABOUT" }, data: { sections: [...about, hours] as never } });

    await page.goto(`/dashboard/stores/${storeId}/pages/about`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    const panel = page.getByTestId("dormant-panel");
    await expect(panel).toContainText("بخش‌های غیرفعال در این قالب");
    await expect(panel).toContainText("ساعت کاری");
    await expect(page.getByTestId("recovery-panel")).toHaveCount(0); // dormant is NOT an error
    await expect(page.locator("select[name=sectionType]")).toBeEnabled(); // and does not block editing
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByText("ساعت کاری ویژه")).toHaveCount(0);
    expect((await sectionsOf(storeId, "ABOUT")).find((s) => s.id === "hours1")).toEqual(hours);

    await page.goto(`/dashboard/stores/${storeId}/pages/about`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await page.getByTestId("dormant-item").getByRole("button", { name: "حذف بخش غیرفعال" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بخش غیرفعال حذف شد." }).first()).toBeVisible({ timeout: 20_000 });
    expect((await sectionsOf(storeId, "ABOUT")).map((s) => s.id)).not.toContain("hours1");
  });

  test("the same stored section is rendered by the theme that approves it and skipped by the one that does not", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "کافه دو", "coffee");
    const hours = { id: "hours1", type: "coffee.openingHours", props: { title: "ساعت کاری ویژه", body: "شنبه: ۸ تا ۲۲", note: "" } };
    const about = await sectionsOf(storeId, "ABOUT");
    await db.page.updateMany({ where: { storeId, type: "ABOUT" }, data: { sections: [...about, hours] as never } });
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByText("ساعت کاری ویژه")).toBeVisible();
    // pin the same store to the general theme (what theme switching will do in 9B): the section becomes dormant, data unchanged
    const general = await db.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
    await db.store.update({ where: { id: storeId }, data: { templateVersionId: general.id } });
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByText("ساعت کاری ویژه")).toHaveCount(0);
    expect((await sectionsOf(storeId, "ABOUT")).find((s) => s.id === "hours1")).toEqual(hours);
    await expect(page.getByTestId("preview-banner")).toContainText("غیرفعال");
  });
});

test.describe("business category after creation", () => {
  test("changing it is metadata only: no content, color, typography or draft revision change", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه دسته", "coffee", "coffee-food");
    const before = {
      rev: (await db.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision,
      pages: JSON.stringify(await db.page.findMany({ where: { storeId }, orderBy: { type: "asc" } })),
      settings: JSON.stringify((await db.store.findUniqueOrThrow({ where: { id: storeId } })).settings),
    };
    await page.goto(`/dashboard/stores/${storeId}`);
    await waitForHydration(page, "form:has(select[name=businessCategory])");
    await page.selectOption("select[name=businessCategory]", "home-appliances");
    await page.getByRole("button", { name: "ذخیرهٔ دسته‌بندی" }).click();
    await expect(page.getByText("دسته‌بندی ذخیره شد.")).toBeVisible({ timeout: 20_000 });
    const after = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(after.businessCategory).toBe("home-appliances");
    expect(after.draftRevision).toBe(before.rev);
    expect(JSON.stringify(after.settings)).toBe(before.settings);
    expect(JSON.stringify(await db.page.findMany({ where: { storeId }, orderBy: { type: "asc" } }))).toBe(before.pages);
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("[data-template=coffee]")).toBeVisible(); // the theme did not change either
    await expect(page.getByRole("heading", { level: 1 })).toContainText("قهوه تازه"); // starter text was not re-applied
  });

  test("another user cannot change my store's category (same 404), even with a forged form", async ({ page, browser }: { page: Page; browser: Browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "خصوصی", "general");
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
    const other = await ctx.newPage();
    await signUpAndIn(other);
    const mine = await createStoreViaUi(other, "مال مهاجم", "general");
    await other.goto(`/dashboard/stores/${mine}`);
    await waitForHydration(other, "form:has(select[name=businessCategory])");
    await other.evaluate((victim) => {
      for (const el of document.querySelectorAll("form:has(select[name=businessCategory]) input[name=storeId]")) (el as HTMLInputElement).value = victim;
    }, storeId);
    await other.selectOption("select[name=businessCategory]", "fashion");
    await other.getByRole("button", { name: "ذخیرهٔ دسته‌بندی" }).click();
    await expect(other.getByRole("heading", { name: /صفحه پیدا نشد/ })).toBeVisible();
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId } })).businessCategory).toBe("general");
    await ctx.close();
  });
});

test.describe("every theme: responsive layout", () => {
  test.describe.configure({ timeout: 90_000 }); // creates a store and visits five pages per theme
  for (const theme of ["general", "coffee", "fashion"]) {
    test(`${theme}: no horizontal scrolling at 360px on any storefront page`, async ({ page }) => {
      await signUpAndIn(page);
      const storeId = await createStoreViaUi(page, `موبایل ${theme}`, theme);
      await createProductViaUi(page, storeId, { name: "یک محصول با نام بسیار بسیار طولانی برای بررسی شکستن خط در موبایل", price: "999999999", stock: "50" });
      await activate(page, storeId, "یک محصول با نام");
      const product = await db.product.findFirstOrThrow({ where: { storeId } });
      await page.setViewportSize({ width: 360, height: 740 });
      for (const path of ["", "/products", `/products/${encodeURIComponent(product.slug)}`, "/about", "/contact"]) {
        await page.goto(`/preview/${storeId}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${theme} ${path}`).toBeLessThanOrEqual(0);
      }
    });
  }
});
