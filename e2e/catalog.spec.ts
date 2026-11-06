import type { Browser } from "@playwright/test";
import { createCategoryViaUi, createProductViaUi, createStoreViaUi, db, expect, notice, productRow, randomIp, signUpAndIn, test } from "./helpers";

test.afterAll(() => db.$disconnect());

async function newUserSession(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  await signUpAndIn(page);
  return { context, page };
}

test.describe("categories", () => {
  test("create, reject duplicates (including Arabic/Persian letter variants), rename, delete", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه دسته‌ها");
    await createCategoryViaUi(page, storeId, "علي");
    await expect(page.getByTestId("category-row")).toHaveCount(1);
    await expect(page.getByTestId("category-row")).toContainText("علی"); // stored with the Persian yeh

    await page.fill("input[name=name]", "علی");
    await page.getByRole("button", { name: "افزودن دسته" }).click();
    await expect(page.getByText("دسته‌ای با این نام قبلاً ثبت شده است")).toBeVisible();
    await expect(page.getByTestId("category-row")).toHaveCount(1);

    await page.getByRole("button", { name: "ویرایش نام" }).click();
    await page.getByLabel("نام دسته علی").fill("كتاب");
    await page.getByRole("button", { name: "ذخیره" }).click();
    await expect(page.getByText("نام دسته‌بندی تغییر کرد.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("category-row")).toContainText("کتاب");

    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await page.getByRole("button", { name: "حذف دسته" }).click();
    await expect(notice(page)).toContainText("دسته‌بندی حذف شد");
    await expect(page.getByTestId("category-row")).toHaveCount(0);
  });

  test("deleting a category that contains products needs explicit confirmation and moves (never deletes) its products", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه انتقال");
    await createCategoryViaUi(page, storeId, "چای");
    await createProductViaUi(page, storeId, { name: "چای سبز", price: "1000", category: "چای" });

    await page.goto(`/dashboard/stores/${storeId}/categories`);
    await expect(page.getByTestId("category-row")).toContainText("۱ محصول");
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    const confirmDelete = page.getByRole("button", { name: "حذف دسته" });
    await expect(confirmDelete).toBeDisabled(); // cannot delete without the explicit move confirmation
    await page.getByLabel("محصولات این دسته به «بدون دسته» منتقل شوند و دسته حذف شود").check();
    await expect(confirmDelete).toBeEnabled();
    await confirmDelete.click();
    await expect(notice(page)).toContainText("منتقل شدند");

    await page.goto(`/dashboard/stores/${storeId}/products`);
    const row = productRow(page, "چای سبز");
    await expect(row).toBeVisible();
    await expect(row).toContainText("بدون دسته");
  });

  test("the server refuses to delete a non-empty category without the confirmation field, even if the dialog is bypassed", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه دور زدن");
    await createCategoryViaUi(page, storeId, "ممنوع");
    await createProductViaUi(page, storeId, { name: "کالا", price: "5", category: "ممنوع" });
    await page.goto(`/dashboard/stores/${storeId}/categories`);
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    // submit the dialog form directly WITHOUT ticking the confirmation
    await page.evaluate(() => document.querySelector<HTMLFormElement>('form:has(input[name=categoryId])')!.requestSubmit());
    await expect(notice(page)).toContainText("این دسته محصول دارد");
    expect(await db.productCategory.count({ where: { storeId } })).toBe(1);
    expect(await db.product.count({ where: { storeId, categoryId: { not: null } } })).toBe(1);
  });
});

test.describe("products: lifecycle and display", () => {
  test("create (Persian digits), list columns, rename keeps the slug, status transitions, zero stock never changes status, delete", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه محصولات");
    await createCategoryViaUi(page, storeId, "نوشیدنی");
    await createProductViaUi(page, storeId, { name: "چاي سبز ممتاز", price: "۱۲۵۰۰", stock: "۰", category: "نوشیدنی" });

    await expect(notice(page)).toContainText("پیش‌نویس");
    const row = productRow(page, "چای سبز ممتاز"); // stored with the Persian yeh
    await expect(row).toContainText("۱۲٬۵۰۰ تومان");
    await expect(row.getByTestId("out-of-stock")).toBeVisible();
    await expect(row).toContainText("نوشیدنی");
    await expect(row).toContainText("پیش‌نویس");
    await expect(row).toContainText("/چای-سبز-ممتاز");
    const created = await db.product.findFirstOrThrow({ where: { storeId } });
    expect(created).toMatchObject({ price: 12500, stockQuantity: 0, status: "DRAFT", slug: "چای-سبز-ممتاز" });

    // activate with zero stock: allowed, and stock stays independent of status
    await row.getByRole("button", { name: "فعال‌سازی" }).click();
    await expect(notice(page)).toContainText("محصول فعال شد");
    await expect(productRow(page, "چای سبز ممتاز")).toContainText("فعال");
    await expect(productRow(page, "چای سبز ممتاز").getByTestId("out-of-stock")).toBeVisible();

    // rename: the slug (URL) must not change
    await page.goto(`/dashboard/stores/${storeId}/products/${created.id}`);
    await page.fill("input[name=name]", "اسم کاملاً جدید");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("تغییرات محصول ذخیره شد.")).toBeVisible();
    expect(await db.product.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ name: "اسم کاملاً جدید", slug: "چای-سبز-ممتاز", status: "ACTIVE" });

    // archive from the edit page; archived products can only go back to draft
    await page.getByRole("button", { name: "بایگانی" }).click();
    await expect(notice(page)).toContainText("بایگانی شد");
    await expect(page.getByRole("button", { name: "فعال‌سازی" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "بازگشت به پیش‌نویس" })).toBeVisible();
    await page.getByRole("button", { name: "بازگشت به پیش‌نویس" }).click();
    await expect(notice(page)).toContainText("پیش‌نویس");

    // delete with confirmation dialog
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("اسم کاملاً جدید");
    await page.getByRole("button", { name: "انصراف" }).click();
    expect(await db.product.count({ where: { storeId } })).toBe(1);
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await page.getByRole("button", { name: "حذف محصول" }).click();
    await expect(notice(page)).toContainText("محصول حذف شد");
    expect(await db.product.count({ where: { storeId } })).toBe(0);
  });

  test("shows validation messages in Persian and creates nothing for invalid input", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه خطا");
    await page.goto(`/dashboard/stores/${storeId}/products/new`);
    await page.fill("input[name=name]", "کالا");
    await page.fill("input[name=price]", "۱۲٫۵");
    await page.fill("input[name=stockQuantity]", "2000000");
    await page.getByRole("button", { name: "ساخت محصول" }).click();
    await expect(page.locator(".MuiAlert-message").first()).toContainText("اطلاعات واردشده را بررسی کنید");
    await expect(page.getByText("قیمت باید عدد صحیح")).toBeVisible();
    await expect(page.getByText("موجودی باید عدد صحیح")).toBeVisible();
    expect(await db.product.count({ where: { storeId } })).toBe(0);
  });

  test("slug: generated from the name, editable by hand, duplicates rejected; live price preview shows Toman", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه آدرس");
    await createProductViaUi(page, storeId, { name: "Green Tea", price: "100" });
    await createProductViaUi(page, storeId, { name: "Green Tea", price: "100" }); // same name => green-tea-2
    await createProductViaUi(page, storeId, { name: "Other", price: "100", slug: "My Custom SLUG" });
    expect((await db.product.findMany({ where: { storeId }, orderBy: { slug: "asc" } })).map((p) => p.slug)).toEqual(["green-tea", "green-tea-2", "my-custom-slug"]);

    await page.goto(`/dashboard/stores/${storeId}/products/new`);
    await page.fill("input[name=name]", "Dup");
    await page.fill("input[name=slug]", "green-tea");
    await page.fill("input[name=price]", "۱۲٬۵۰۰");
    await expect(page.getByText("۱۲٬۵۰۰ تومان")).toBeVisible(); // live preview with thousands separators and unit
    await page.getByRole("button", { name: "ساخت محصول" }).click();
    await expect(page.getByText("این آدرس قبلاً برای محصول دیگری استفاده شده است")).toBeVisible();
    expect(await db.product.count({ where: { storeId } })).toBe(3);
  });
});

test.describe("products: search, filters and pagination", () => {
  test("search is normalisation-aware, filters combine, and pagination links keep every active parameter", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه جست‌وجو");
    await createCategoryViaUi(page, storeId, "کالاها");
    const cat = await db.productCategory.findFirstOrThrow({ where: { storeId } });
    await db.product.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({
        storeId, name: `کالا ${i + 1}`, slug: `kala-${i + 1}`, price: 1000 + i, stockQuantity: i % 3, searchKey: `کالا ${i + 1}`, categoryId: cat.id,
      })),
    });
    await db.product.createMany({
      data: [
        { storeId, name: "کتاب آشپزی", slug: "ketab", price: 5, searchKey: "کتاب آشپزی" },
        { storeId, name: "100% pure honey", slug: "honey-1", price: 5, searchKey: "100% pure honey" },
        { storeId, name: "1000 pure salt", slug: "salt-1", price: 5, searchKey: "1000 pure salt" },
      ],
    });
    const rows = page.getByTestId("product-row");

    await page.goto(`/dashboard/stores/${storeId}/products`);
    await expect(rows).toHaveCount(20);
    await expect(page.getByText("نمایش ۱ تا ۲۰ از ۴۸ محصول")).toBeVisible();

    // search with an Arabic kaf finds products stored with the Persian kaf; wildcard characters are literal
    await page.fill("form[method=get] input[name=q]", "كتاب");
    await page.getByRole("button", { name: "اعمال" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("کتاب آشپزی");
    await page.fill("form[method=get] input[name=q]", "100%");
    await page.getByRole("button", { name: "اعمال" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("100% pure honey");

    // combined search + category filter; page 2 keeps both parameters
    await page.fill("form[method=get] input[name=q]", "کالا");
    await page.selectOption("select[name=category]", { label: "کالاها" });
    await page.getByRole("button", { name: "اعمال" }).click();
    await expect(rows).toHaveCount(20);
    await expect(page.getByText("از ۴۵ محصول")).toBeVisible();
    await page.getByRole("link", { name: "۲", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    const u = new URL(page.url());
    expect(u.searchParams.get("q")).toBe("کالا");
    expect(u.searchParams.get("category")).toBe(cat.id);
    await expect(rows).toHaveCount(20);
    await expect(page.locator("form[method=get] input[name=q]")).toHaveValue("کالا");

    await page.getByRole("link", { name: "۳", exact: true }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByText("نمایش ۴۱ تا ۴۵ از ۴۵ محصول")).toBeVisible();
    await expect(page.getByRole("link", { name: "بعدی" })).toHaveCount(0);
    await page.getByRole("link", { name: "قبلی" }).click();
    await expect(page).toHaveURL(/page=2/);
    expect(new URL(page.url()).searchParams.get("q")).toBe("کالا");

    // a status change keeps the search/filter/page context
    await db.product.updateMany({ where: { storeId, slug: "kala-1" }, data: { status: "DRAFT" } });
    await page.goto(`/dashboard/stores/${storeId}/products?q=${encodeURIComponent("کالا")}&page=2`);
    await rows.first().getByRole("button", { name: "فعال‌سازی" }).click();
    await expect(notice(page)).toContainText("محصول فعال شد");
    const back = new URL(page.url());
    expect(back.searchParams.get("q")).toBe("کالا");
    expect(back.searchParams.get("page")).toBe("2");

    // status filter and the empty result state
    await page.goto(`/dashboard/stores/${storeId}/products?status=ARCHIVED`);
    await expect(page.getByText("محصولی با این جست‌وجو یا فیلتر پیدا نشد.")).toBeVisible();
    await page.getByRole("link", { name: "پاک کردن فیلترها" }).click();
    await expect(rows).toHaveCount(20);

    // an out-of-range page and garbage parameters never produce an error page
    const res = await page.goto(`/dashboard/stores/${storeId}/products?page=9999&status=BOGUS&pageSize=-5`);
    expect(res!.status()).toBe(200);
    await expect(rows.first()).toBeVisible();
  });
});

test.describe("tenant isolation (two real users) for products and categories", () => {
  test("unauthenticated users are redirected for every catalog URL", async ({ request, baseURL }) => {
    for (const p of ["/dashboard/stores/x/products", "/dashboard/stores/x/products/new", "/dashboard/stores/x/products/y", "/dashboard/stores/x/categories"]) {
      const res = await request.get(`${baseURL}${p}`, { maxRedirects: 0 });
      expect(res.status(), p).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  });

  test("A gets the identical 404 for B's catalog URLs and for non-existent ones; B's data never appears", async ({ page, browser }) => {
    await signUpAndIn(page);
    const aStore = await createStoreViaUi(page, "فروشگاه الف");
    await createProductViaUi(page, aStore, { name: "محصول الف", price: "1" });
    const b = await newUserSession(browser);
    const bStore = await createStoreViaUi(b.page, "فروشگاه ب");
    await createCategoryViaUi(b.page, bStore, "دسته محرمانه");
    await createProductViaUi(b.page, bStore, { name: "محصول محرمانه", price: "2", category: "دسته محرمانه" });
    const bProd = await db.product.findFirstOrThrow({ where: { storeId: bStore } });

    const text = async (url: string) => {
      const r = await page.goto(url);
      return { status: r!.status(), body: await page.locator("body").innerText() };
    };
    const missing = await text("/dashboard/stores/cmnonexistent00000000/products");
    for (const url of [
      `/dashboard/stores/${bStore}/products`,
      `/dashboard/stores/${bStore}/products/new`,
      `/dashboard/stores/${bStore}/products/${bProd.id}`,
      `/dashboard/stores/${bStore}/categories`,
    ]) {
      const r = await text(url);
      expect(r.status, url).toBe(404);
      expect(r.body, url).toBe(missing.body);
      expect(r.body).not.toContain("محرمانه");
    }
    // B's product through A's own store id
    const viaOwn = await text(`/dashboard/stores/${aStore}/products/${bProd.id}`);
    const ownMissing = await text(`/dashboard/stores/${aStore}/products/cmnonexistent00000000`);
    expect(viaOwn.status).toBe(404);
    expect(viaOwn.body).toBe(ownMissing.body);

    // A's own lists never contain B's data
    await page.goto(`/dashboard/stores/${aStore}/products`);
    await expect(page.locator("body")).not.toContainText("محرمانه");
    await b.context.close();
  });

  test("forged form submissions from A (tampered hidden ids / injected category option) cannot touch B's data", async ({ page, browser }) => {
    await signUpAndIn(page);
    const aStore = await createStoreViaUi(page, "A-shop");
    await createCategoryViaUi(page, aStore, "دسته A");
    await createProductViaUi(page, aStore, { name: "محصول A", price: "10", category: "دسته A" });
    const aProd = await db.product.findFirstOrThrow({ where: { storeId: aStore } });
    const b = await newUserSession(browser);
    const bStore = await createStoreViaUi(b.page, "B-shop");
    await createCategoryViaUi(b.page, bStore, "دسته B");
    await createProductViaUi(b.page, bStore, { name: "محصول B", price: "20", category: "دسته B" });
    const bProd = await db.product.findFirstOrThrow({ where: { storeId: bStore } });
    const bCat = await db.productCategory.findFirstOrThrow({ where: { storeId: bStore } });
    const snapshot = async () =>
      JSON.stringify({
        store: await db.store.findUniqueOrThrow({ where: { id: bStore } }),
        products: await db.product.findMany({ where: { storeId: bStore } }),
        categories: await db.productCategory.findMany({ where: { storeId: bStore } }),
      });
    const before = await snapshot();
    const submitted = (p: typeof page, sel: string) =>
      p.evaluate((s) => Object.fromEntries(new FormData(document.querySelector<HTMLFormElement>(s)!).entries()) as Record<string, string>, sel);

    // 1) edit form: swap storeId and productId to B's, inject forged identity fields
    await page.goto(`/dashboard/stores/${aStore}/products/${aProd.id}`);
    await page.evaluate((t) => {
      const form = document.querySelector<HTMLFormElement>("form:has(input[name=price])")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = t.bStore;
      form.querySelector<HTMLInputElement>("input[name=productId]")!.value = t.bProd;
      for (const [k, v] of Object.entries({ ownerId: t.uid, userId: t.uid, status: "ARCHIVED" })) {
        const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; form.appendChild(i);
      }
      form.querySelector<HTMLInputElement>("input[name=name]")!.value = "PWNED";
    }, { bStore, bProd: bProd.id, uid: "forged-user" });
    expect(await submitted(page, "form:has(input[name=price])")).toMatchObject({ storeId: bStore, productId: bProd.id, ownerId: "forged-user", name: "PWNED" });
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await page.waitForURL(`**/dashboard/stores/${bStore}/products/${bProd.id}`);
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
    expect(await snapshot()).toBe(before);

    // 2) status button: tamper the hidden ids of a status form
    await page.goto(`/dashboard/stores/${aStore}/products`);
    await page.evaluate((t) => {
      const form = document.querySelector<HTMLFormElement>("form:has(input[name=status])")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = t.bStore;
      form.querySelector<HTMLInputElement>("input[name=productId]")!.value = t.bProd;
      form.requestSubmit();
    }, { bStore, bProd: bProd.id });
    await page.waitForURL(`**/dashboard/stores/${bStore}/products/${bProd.id}`);
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
    expect(await snapshot()).toBe(before);

    // 3) delete dialog: B's product id with confirmation
    await page.goto(`/dashboard/stores/${aStore}/products`);
    await page.getByTestId("product-row").first().getByRole("button", { name: "حذف", exact: true }).click();
    const sentDelete = await page.evaluate((t) => {
      const form = document.querySelector<HTMLFormElement>("[role=dialog] form")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = t.bStore;
      form.querySelector<HTMLInputElement>("input[name=productId]")!.value = t.bProd;
      const sent = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
      form.requestSubmit();
      return sent;
    }, { bStore, bProd: bProd.id });
    expect(sentDelete).toMatchObject({ storeId: bStore, productId: bProd.id, confirmDelete: "yes" });
    await page.waitForURL(`**/dashboard/stores/${bStore}/products/${bProd.id}`);
    expect(await snapshot()).toBe(before);

    // 4) cross-store category: inject B's category as an <option> in A's create form
    await page.goto(`/dashboard/stores/${aStore}/products/new`);
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>("select[name=categoryId]")!;
      const o = document.createElement("option"); o.value = id; o.textContent = "INJECTED"; sel.appendChild(o); sel.value = id;
    }, bCat.id);
    await page.fill("input[name=name]", "با دسته بیگانه");
    await page.fill("input[name=price]", "5");
    expect((await submitted(page, "form:has(input[name=price])"))["categoryId"]).toBe(bCat.id);
    await page.getByRole("button", { name: "ساخت محصول" }).click();
    await expect(page.getByText("دسته انتخاب‌شده معتبر نیست")).toBeVisible();
    expect(await db.product.count({ where: { storeId: aStore } })).toBe(1);

    // 5) and the same on an existing product's edit form
    await page.goto(`/dashboard/stores/${aStore}/products/${aProd.id}`);
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>("select[name=categoryId]")!;
      const o = document.createElement("option"); o.value = id; o.textContent = "INJECTED"; sel.appendChild(o); sel.value = id;
    }, bCat.id);
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("دسته انتخاب‌شده معتبر نیست")).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: aProd.id } })).categoryId).not.toBe(bCat.id);

    // 6) category delete with B's category id
    await page.goto(`/dashboard/stores/${aStore}/categories`);
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await page.evaluate((t) => {
      const form = document.querySelector<HTMLFormElement>("[role=dialog] form")!;
      form.querySelector<HTMLInputElement>("input[name=storeId]")!.value = t.bStore;
      form.querySelector<HTMLInputElement>("input[name=categoryId]")!.value = t.bCat;
      const cb = document.createElement("input"); cb.type = "hidden"; cb.name = "moveProducts"; cb.value = "on"; form.appendChild(cb);
      form.requestSubmit();
    }, { bStore, bCat: bCat.id });
    await page.waitForURL(`**/dashboard/stores/${bStore}/categories/${bCat.id}`);
    expect(await snapshot()).toBe(before);

    // B still sees everything
    await b.page.goto(`/dashboard/stores/${bStore}/products`);
    await expect(productRow(b.page, "محصول B")).toBeVisible();
    await b.context.close();
  });
});

test.describe("UI polish", () => {
  test("desktop: store forms are centred (no right-edge hugging) and the colour picker works", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه رنگ");
    const form = page.locator("form:has(input[name=primaryColor])");
    const box = (await form.boundingBox())!;
    const leftGap = box.x;
    const rightGap = 1280 - (box.x + box.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(40);

    // hex field + native picker stay in sync; invalid hex is flagged; saving persists the colour
    const hex = page.locator("input[name=primaryColor]");
    await page.locator("input[type=color]").fill("#336699");
    await expect(hex).toHaveValue("#336699");
    await hex.fill("#12");
    await expect(page.getByText("رنگ را به‌صورت #RRGGBB وارد کنید")).toBeVisible();
    await hex.fill("#AABBCC");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("تغییرات ذخیره شد.")).toBeVisible();
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId } })).settings).toMatchObject({ primaryColor: "#AABBCC" });
  });

  test("mobile: product list, form and categories never overflow horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه موبایل با یک نام نسبتاً طولانی برای بررسی شکستن خط");
    await createCategoryViaUi(page, storeId, "دسته‌ای با نام طولانی برای بررسی سرریز در نمایش موبایل");
    await createProductViaUi(page, storeId, { name: "محصولی با نام بسیار طولانی که باید در صفحه موبایل بشکند و سرریز نکند", price: "1000000000", stock: "0", category: "دسته‌ای با نام طولانی برای بررسی سرریز در نمایش موبایل" });
    for (const url of [`/dashboard/stores/${storeId}`, `/dashboard/stores/${storeId}/products`, `/dashboard/stores/${storeId}/products/new`, `/dashboard/stores/${storeId}/categories`]) {
      await page.goto(url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, url).toBeLessThanOrEqual(1);
    }
    await page.goto(`/dashboard/stores/${storeId}/products`);
    await expect(page.getByTestId("product-row")).toContainText("۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
  });
});
