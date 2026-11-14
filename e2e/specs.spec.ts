import type { Page } from "@playwright/test";
import { createProductViaUi, createStoreViaUi, db, expect, productRow, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());
test.describe.configure({ timeout: 120_000 });

const THEMES = ["general", "coffee", "fashion", "appliances"] as const;
const SPECS = [
  { label: "برند", value: "الف" },
  { label: "ظرفیت", value: "۷ کیلوگرم" },
  { label: "توان مصرفی", value: "۲۰۰۰ وات" },
  { label: "رنگ", value: "سفید" },
];
const storedSpecs = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).specs;
const productIdOf = async (storeId: string, name: string) => (await db.product.findFirstOrThrow({ where: { storeId, name } })).id;
const pointTheme = async (storeId: string, key: string) => {
  const tv = await db.templateVersion.findFirstOrThrow({ where: { template: { key } } });
  await db.store.update({ where: { id: storeId }, data: { templateVersionId: tv.id } });
};
const activate = async (page: Page, storeId: string, name: string) => {
  await page.goto(`/dashboard/stores/${storeId}/products`);
  await productRow(page, name).getByRole("button", { name: "فعال‌سازی" }).click();
  await page.waitForURL(/notice=status-activated/); // the status change has committed (a redirect follows success)
  await expect(productRow(page, name)).toContainText("فعال");
};
const save = async (page: Page) => {
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "تغییرات محصول ذخیره شد." }).first()).toBeVisible({ timeout: 20_000 });
};

test.describe("product specifications: editing", () => {
  test("a home-appliances store: the category suggests the appliances theme, the preset adds label rows, rows without a value are skipped", async ({ page }) => {
    await signUpAndIn(page);
    await page.goto("/dashboard/stores/new");
    await waitForHydration(page, "form:has(input[name=templateKey])");
    await page.locator("[data-category-key=home-appliances] button").click();
    await expect(page.locator("input[name=templateKey]")).toHaveValue("appliances");
    const storeId = await createStoreViaUi(page, "لوازم خانگی من", "appliances", "home-appliances");
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { templateVersion: { include: { template: true } } } })).templateVersion.template.key).toBe("appliances");

    await createProductViaUi(page, storeId, { name: "ماشین لباسشویی", price: "25000000", stock: "4" });
    const id = await productIdOf(storeId, "ماشین لباسشویی");
    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await waitForHydration(page, "[data-testid=specs-editor] select");
    await page.locator("[data-testid=spec-preset] select").selectOption({ label: "لوازم خانگی" });
    await expect(page.getByTestId("spec-row")).toHaveCount(9);
    const rows = page.getByTestId("spec-row");
    await rows.nth(0).locator("input[name=specValue]").fill("سامسونگ");
    await rows.nth(4).locator("input[name=specValue]").fill("۹ کیلوگرم");
    await page.getByTestId("spec-add").click();
    await rows.nth(9).locator("input[name=specLabel]").fill("نوع موتور");
    await rows.nth(9).locator("input[name=specValue]").fill("اینورتر");
    await save(page);
    // only the filled rows were stored (the other seven preset rows had no value and were skipped), in order
    expect(await storedSpecs(id)).toEqual([
      { label: "برند", value: "سامسونگ" },
      { label: "ظرفیت", value: "۹ کیلوگرم" },
      { label: "نوع موتور", value: "اینورتر" },
    ]);
  });

  test("presets are optional suggestions: the appliance preset is available in a coffee store, and free labels work without any preset", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "کافه", "coffee", "coffee-food");
    await page.goto(`/dashboard/stores/${storeId}/products/new`);
    await waitForHydration(page, "[data-testid=specs-editor] select");
    const options = await page.locator("[data-testid=spec-preset] select option").allTextContents();
    expect(options).toEqual(expect.arrayContaining(["لوازم خانگی", "مشخصات عمومی"])); // every preset, whatever the category
    await page.getByTestId("spec-add").click();
    await page.getByTestId("spec-row").first().locator("input[name=specLabel]").fill("نوع دانه");
    await page.getByTestId("spec-row").first().locator("input[name=specValue]").fill("عربیکا");
    await page.fill("input[name=name]", "قهوه");
    await page.fill("input[name=price]", "100000");
    await page.getByRole("button", { name: "ساخت محصول" }).click();
    await page.waitForURL(/products(\?|$)/);
    expect(await storedSpecs(await productIdOf(storeId, "قهوه"))).toEqual([{ label: "نوع دانه", value: "عربیکا" }]);
  });

  test("invalid stored specs: reported, preserved when other fields are edited, and changed only by an explicit clear or replace", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "نامعتبر", "appliances");
    await createProductViaUi(page, storeId, { name: "کتری", price: "500000", stock: "2" });
    const id = await productIdOf(storeId, "کتری");
    await activate(page, storeId, "کتری");
    const bad = [{ label: "", value: "x" }, { label: "ok", value: "fine", extra: true }];
    await db.$executeRaw`UPDATE "Product" SET "specs" = ${JSON.stringify(bad)}::jsonb WHERE id = ${id}`;

    await page.goto(`/dashboard/stores/${storeId}/products`);
    await expect(productRow(page, "کتری").getByTestId("specs-invalid-chip")).toBeVisible();

    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await waitForHydration(page, "[data-testid=specs-editor]");
    await expect(page.getByTestId("specs-invalid")).toBeVisible();
    await expect(page.getByTestId("specs-invalid-preview")).toContainText("extra");
    // editing an unrelated field with the default ("keep") choice does not touch the invalid value
    await page.fill("input[name=name]", "کتری برقی");
    await save(page);
    expect(await storedSpecs(id)).toEqual(bad);
    expect((await db.product.findUniqueOrThrow({ where: { id } })).name).toBe("کتری برقی");

    // the preview tells the owner, and shows the product without specifications
    await page.goto(`/preview/${storeId}`);
    await expect(page.getByTestId("preview-note-invalid-specs")).toBeVisible();
    await page.goto(`/preview/${storeId}/products/${(await db.product.findUniqueOrThrow({ where: { id } })).slug}`);
    await expect(page.getByTestId("product-specs")).toHaveCount(0);

    // explicit clear
    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await waitForHydration(page, "[data-testid=specs-editor]");
    await page.getByTestId("specs-clear").click();
    await expect(page.getByTestId("specs-clear-note")).toBeVisible();
    await save(page);
    expect(await storedSpecs(id)).toEqual([]);
    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await expect(page.getByTestId("specs-invalid")).toHaveCount(0);

    // explicit replace of another invalid value
    await db.$executeRaw`UPDATE "Product" SET "specs" = ${JSON.stringify(bad)}::jsonb WHERE id = ${id}`;
    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await waitForHydration(page, "[data-testid=specs-editor]");
    await page.getByTestId("specs-replace").click();
    await page.getByTestId("spec-add").click();
    await page.getByTestId("spec-row").first().locator("input[name=specLabel]").fill("توان");
    await page.getByTestId("spec-row").first().locator("input[name=specValue]").fill("۱۸۰۰ وات");
    await save(page);
    expect(await storedSpecs(id)).toEqual([{ label: "توان", value: "۱۸۰۰ وات" }]);
  });

  test("validation errors are shown and nothing is saved (a row with a value but no label)", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "اعتبارسنجی", "general");
    await createProductViaUi(page, storeId, { name: "جاروبرقی", price: "100", stock: "1" });
    const id = await productIdOf(storeId, "جاروبرقی");
    await page.goto(`/dashboard/stores/${storeId}/products/${id}`);
    await waitForHydration(page, "[data-testid=specs-editor]");
    await page.getByTestId("spec-add").click();
    await page.getByTestId("spec-row").first().locator("input[name=specValue]").fill("مقدار بدون نام");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "نام ویژگی را وارد کنید" })).toBeVisible({ timeout: 20_000 });
    expect(await storedSpecs(id)).toEqual([]);
  });
});

test.describe("product specifications: storefront rendering in all four themes", () => {
  test("every theme shows at most two rows on cards and all rows on the detail page, as escaped text; empty specs render nothing", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "همه قالب‌ها", "general");
    await createProductViaUi(page, storeId, { name: "تستر", price: "900000", stock: "5" });
    await createProductViaUi(page, storeId, { name: "بدون مشخصات", price: "100000", stock: "5" });
    const id = await productIdOf(storeId, "تستر");
    const evil = "<script>window.__pwned=1</script>";
    await db.product.update({ where: { id }, data: { specs: [...SPECS, { label: "xss", value: evil }] } });
    await activate(page, storeId, "تستر");
    await activate(page, storeId, "بدون مشخصات");
    const slug = (await db.product.findUniqueOrThrow({ where: { id } })).slug;
    const plainSlug = (await db.product.findFirstOrThrow({ where: { storeId, name: "بدون مشخصات" } })).slug;

    for (const theme of THEMES) {
      await pointTheme(storeId, theme);
      // listing: first two rows only, and only the product that has specs shows a spec list
      await page.goto(`/preview/${storeId}/products`);
      await expect(page.locator(`[data-template=${theme}]`), theme).toBeVisible();
      const cardSpecs = page.getByTestId("card-specs");
      await expect(cardSpecs, theme).toHaveCount(1);
      await expect(cardSpecs.locator("dt")).toHaveCount(2);
      await expect(cardSpecs).toContainText("برند");
      await expect(cardSpecs).toContainText("ظرفیت");
      await expect(cardSpecs).not.toContainText("توان مصرفی");
      // detail: every row, escaped
      await page.goto(`/preview/${storeId}/products/${encodeURIComponent(slug)}`);
      const specs = page.getByTestId("product-specs");
      await expect(specs, theme).toBeVisible();
      await expect(specs.locator("dt")).toHaveCount(5);
      await expect(specs).toContainText("۲۰۰۰ وات");
      await expect(specs).toContainText(evil); // visible as TEXT
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), theme).toBeUndefined();
      expect(await page.locator("script", { hasText: "__pwned" }).count(), theme).toBe(0);
      // a product without specs: no block at all
      await page.goto(`/preview/${storeId}/products/${encodeURIComponent(plainSlug)}`);
      await expect(page.getByTestId("product-specs"), theme).toHaveCount(0);
      await expect(page.getByText("مشخصات فنی"), theme).toHaveCount(0);
    }
  });

  test("specs survive switching the theme through the dashboard (appliances -> general -> appliances)", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "تغییر قالب", "appliances", "home-appliances");
    await createProductViaUi(page, storeId, { name: "یخچال", price: "30000000", stock: "2" });
    const id = await productIdOf(storeId, "یخچال");
    await db.product.update({ where: { id }, data: { specs: SPECS } });
    await activate(page, storeId, "یخچال");
    const slug = (await db.product.findUniqueOrThrow({ where: { id } })).slug;
    const before = await storedSpecs(id);
    for (const target of ["general", "appliances"]) {
      await page.goto(`/dashboard/stores/${storeId}/appearance`);
      await page.locator(`[data-testid=theme-card][data-theme-key=${target}]`).getByTestId("theme-check-link").click();
      await waitForHydration(page, "[data-testid=theme-switch-panel] form");
      await page.getByTestId("switch-theme-submit").click();
      await expect(page.getByTestId("switch-success")).toBeVisible({ timeout: 20_000 });
      expect(await storedSpecs(id)).toEqual(before);
      await page.goto(`/preview/${storeId}/products/${encodeURIComponent(slug)}`);
      await expect(page.locator(`[data-template=${target}]`)).toBeVisible();
      await expect(page.getByTestId("product-specs").locator("dt")).toHaveCount(4);
    }
  });
});

test.describe("the appliances theme", () => {
  test("renders every page with its own design and offers the service-info section only where approved", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "لوازم", "appliances");
    for (const path of ["", "/products", "/about", "/contact"]) {
      const res = await page.goto(`/preview/${storeId}${path}`);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator("[data-template=appliances]"), path).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
    await page.goto(`/dashboard/stores/${storeId}/pages/home`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await waitForHydration(page, "select[name=sectionType]");
    await page.locator("select[name=sectionType]").selectOption({ label: "گارانتی و خدمات" });
    await page.getByRole("button", { name: "افزودن", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بخش اضافه شد." }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`/preview/${storeId}`);
    await expect(page.getByRole("heading", { name: "گارانتی و خدمات پس از فروش" })).toBeVisible();
    await expect(page.getByText("ارسال به سراسر کشور")).toBeVisible();
    // not offered on the products page
    await page.goto(`/dashboard/stores/${storeId}/pages/products`);
    await waitForHydration(page, "[data-testid=page-editor] form");
    await expect(page.locator("select[name=sectionType] option", { hasText: "گارانتی و خدمات" })).toHaveCount(0);
  });
});
