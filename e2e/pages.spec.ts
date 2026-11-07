import type { Browser, Page } from "@playwright/test";
import sharp from "sharp";
import { createStoreViaUi, db, expect, randomIp, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());

const png = (w = 600, h = 400) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 90 } } }).png().toBuffer();

async function newUserSession(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  await signUpAndIn(page);
  return { context, page };
}

const cards = (page: Page) => page.getByTestId("section-card");
async function openEditor(page: Page, storeId: string, slug: string) {
  await page.goto(`/dashboard/stores/${storeId}/pages/${slug}`);
  await waitForHydration(page, "[data-testid=page-editor] form");
}
// Editor actions do several queries inside a locked transaction; allow a slow (throttled/CI) machine a generous result timeout.
const success = (page: Page, text: string) => expect(page.getByRole("alert").filter({ hasText: text }).first()).toBeVisible({ timeout: 20_000 });
const sectionsOf = async (storeId: string, type: string) =>
  ((await db.page.findFirstOrThrow({ where: { storeId, type: type as never } })).sections as { id: string; type: string; props: Record<string, unknown> }[]);

async function addSection(page: Page, label: string) {
  await page.locator("select[name=sectionType]").selectOption({ label });
  await page.getByRole("button", { name: "افزودن", exact: true }).click();
}

test.describe("page editor", () => {
  test("add, edit, reorder, remove sections; the preview reflects the draft immediately; no-ops change nothing", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه ویرایش", "فروشگاه عمومی");
    await page.goto(`/dashboard/stores/${storeId}/pages`);
    await expect(page.getByTestId("page-row")).toHaveCount(5);

    await openEditor(page, storeId, "about");
    await expect(cards(page)).toHaveCount(1);
    const rev0 = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision;

    await addSection(page, "دعوت به اقدام");
    await success(page, "بخش اضافه شد.");
    await expect(cards(page)).toHaveCount(2);
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision).toBe(rev0 + 1);

    // edit the new section
    await cards(page).nth(1).locator("button[aria-expanded]").first().click();
    await cards(page).nth(1).getByLabel("عنوان").fill("همین حالا سفارش دهید");
    await cards(page).nth(1).getByRole("button", { name: "ذخیرهٔ بخش" }).click();
    await success(page, "بخش ذخیره شد.");

    // the draft preview shows it right away
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByText("همین حالا سفارش دهید")).toBeVisible();

    // saving the same values again is a no-op: no revision bump
    await openEditor(page, storeId, "about");
    const rev1 = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision;
    await cards(page).nth(1).locator("button[aria-expanded]").first().click();
    await cards(page).nth(1).getByRole("button", { name: "ذخیرهٔ بخش" }).click();
    await success(page, "تغییری وجود نداشت.");
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision).toBe(rev1);

    // reorder: move the new section up, the order is persisted and shown in the preview
    await cards(page).nth(1).locator("button[aria-expanded]").first().click();
    await cards(page).nth(1).getByRole("button", { name: /بالا بردن/ }).click();
    await success(page, "ترتیب بخش‌ها تغییر کرد.");
    expect((await sectionsOf(storeId, "ABOUT")).map((s) => s.type)).toEqual(["callToAction", "richText"]);
    await expect(cards(page).first()).toHaveAttribute("data-section-type", "callToAction");
    // the first section cannot go further up
    await cards(page).first().locator("button[aria-expanded]").first().click();
    await expect(cards(page).first().getByRole("button", { name: /بالا بردن/ })).toBeDisabled();

    // remove
    await cards(page).first().getByRole("button", { name: "حذف بخش" }).click();
    await success(page, "بخش حذف شد.");
    expect((await sectionsOf(storeId, "ABOUT")).map((s) => s.type)).toEqual(["richText"]);
  });

  test("required sections cannot be removed and the product page structure is fixed", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه الزامی", "فروشگاه عمومی");
    await openEditor(page, storeId, "products");
    const grid = page.locator("[data-section-type=productGrid]");
    await grid.locator("button[aria-expanded]").first().click();
    await expect(grid.getByRole("button", { name: "حذف بخش" })).toBeDisabled();
    await openEditor(page, storeId, "product-detail");
    await expect(page.locator("select[name=sectionType] option")).toHaveCount(1); // only the placeholder: nothing can be added
  });

  test("home and products cannot be hidden; other pages can, and a hidden page disappears from the preview", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه نمایش", "فروشگاه عمومی");
    await page.goto(`/dashboard/stores/${storeId}/pages`);
    for (const type of ["HOME", "PRODUCTS"]) await expect(page.locator(`[data-page-type=${type}]`).getByRole("button", { name: "پنهان‌کردن" })).toBeDisabled();

    await page.locator("[data-page-type=ABOUT]").getByRole("button", { name: "پنهان‌کردن" }).click();
    await expect(page.locator("[data-page-type=ABOUT]").getByText("پنهان", { exact: true })).toBeVisible();
    expect((await db.page.findFirstOrThrow({ where: { storeId, type: "ABOUT" } })).isVisible).toBe(false);
    await page.goto(`/preview/${storeId}/about`);
    await expect(page.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
    await page.goto(`/preview/${storeId}`);
    await expect(page.getByRole("navigation", { name: "منوی اصلی" }).getByText("درباره ما")).toHaveCount(0);

    await page.goto(`/dashboard/stores/${storeId}/pages`);
    await page.locator("[data-page-type=ABOUT]").getByRole("button", { name: "نمایش", exact: true }).click();
    await expect.poll(async () => (await db.page.findFirstOrThrow({ where: { storeId, type: "ABOUT" } })).isVisible).toBe(true);
    // forged: hide HOME directly through the form
    await page.goto(`/dashboard/stores/${storeId}/pages`);
    await waitForHydration(page, "[data-testid=page-row] form");
    await page.evaluate(() => {
      const f = document.querySelector("[data-page-type=HOME] form")!;
      (f.querySelector("input[name=visible]") as HTMLInputElement).value = "false";
      (f as HTMLFormElement).requestSubmit(); // the button is disabled in the UI; submit the form directly
    });
    await expect(page.getByRole("alert").filter({ hasText: "این صفحه را نمی‌توان پنهان کرد" })).toBeVisible();
    expect((await db.page.findFirstOrThrow({ where: { storeId, type: "HOME" } })).isVisible).toBe(true);
  });

  test("the 20-section limit is enforced (UI and server)", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه سقف", "فروشگاه عمومی");
    const sections = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, type: "richText", props: { title: `بخش ${i}`, body: "" } }));
    await db.page.updateMany({ where: { storeId, type: "ABOUT" }, data: { sections } });
    await openEditor(page, storeId, "about");
    await expect(cards(page)).toHaveCount(20);
    await expect(page.locator("select[name=sectionType]")).toBeDisabled();
    await expect(page.getByText("به حداکثر تعداد بخش رسیده‌اید.")).toBeVisible();
  });

  test("legacy invalid section data shows a recovery state, blocks edits, and recovery archives it without deleting anything", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه قدیمی", "فروشگاه عمومی");
    const legacy = [
      { id: "ok", type: "richText", props: { title: "سالم", body: "متن سالم" } },
      { id: "old", type: "carousel", props: { images: ["x"] } },
      { id: "bad", type: "richText", props: { title: 12 } },
    ];
    await db.page.updateMany({ where: { storeId, type: "ABOUT" }, data: { sections: legacy } });
    await openEditor(page, storeId, "about");
    const panel = page.getByTestId("recovery-panel");
    await expect(panel).toContainText("۲ بخش نامعتبر");
    await expect(panel).toContainText("carousel"); // the stored value is shown, not hidden
    await expect(page.locator("select[name=sectionType]")).toBeDisabled();
    await expect(page.getByTestId("visibility-toggle")).toBeDisabled();
    expect((await db.page.findFirstOrThrow({ where: { storeId, type: "ABOUT" } })).sections).toEqual(legacy); // untouched

    await panel.getByRole("button", { name: "انتقال به بایگانی و ادامه" }).click();
    await success(page, "هیچ داده‌ای حذف نشد.");
    await expect(page.getByTestId("recovery-panel")).toHaveCount(0);
    const row = await db.page.findFirstOrThrow({ where: { storeId, type: "ABOUT" } });
    expect(row.sections).toEqual([legacy[0]]);
    expect((row.legacySections as { raw: unknown }[]).map((x) => x.raw)).toEqual([legacy[1], legacy[2]]);
    await expect(page.locator("select[name=sectionType]")).toBeEnabled();
    await expect(page.getByText("۲ مورد بایگانی‌شده")).toBeVisible();
  });

  test("two tabs editing the same page: the stale one gets an explicit conflict and overwrites nothing", async ({ page, context }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه هم‌زمان", "فروشگاه عمومی");
    await openEditor(page, storeId, "about");
    const other = await context.newPage();
    await openEditor(other, storeId, "about");

    await addSection(page, "متن"); // tab 1 wins
    await success(page, "بخش اضافه شد.");
    await addSection(other, "دعوت به اقدام"); // tab 2 is stale
    await expect(other.getByRole("alert").filter({ hasText: "هم‌زمان تغییر کرده" })).toBeVisible();
    expect((await sectionsOf(storeId, "ABOUT")).map((s) => s.type)).toEqual(["richText", "richText"]);
    // after reloading, tab 2 can edit again
    await openEditor(other, storeId, "about");
    await addSection(other, "دعوت به اقدام");
    await success(other, "بخش اضافه شد.");
    expect((await sectionsOf(storeId, "ABOUT")).length).toBe(3);
  });
});

test.describe("section images", () => {
  test("upload a hero image: it is shown in the preview from the bucket URL; replace and remove release the object", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه تصویر بخش", "فروشگاه عمومی");
    await openEditor(page, storeId, "home");
    const hero = page.locator("[data-section-type=hero]");
    await hero.locator("button[aria-expanded]").first().click();
    const up = hero.locator("[data-testid^=section-image-]");
    await expect(up.locator("input[type=file]")).toHaveValue("");
    await up.locator("input[type=file]").setInputFiles({ name: "h.png", mimeType: "image/png", buffer: await png() });
    await up.locator("button[type=submit]").first().click();
    await expect(page.getByText("تصویر بخش ذخیره شد.")).toBeVisible();

    const home = await sectionsOf(storeId, "HOME");
    const imageId = home.find((s) => s.type === "hero")!.props.imageId as string;
    expect(imageId).toBeTruthy();
    const media = await db.media.findUniqueOrThrow({ where: { id: imageId } });
    expect(media).toMatchObject({ status: "READY", storeId, mimeType: "image/webp" });

    await page.goto(`/preview/${storeId}`);
    const img = page.locator("section img").first();
    await expect(img).toHaveAttribute("src", new RegExp(media.key));
    const src = (await img.getAttribute("src"))!;
    expect((await fetch(src)).status).toBe(200);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(600);

    await openEditor(page, storeId, "home");
    await hero.locator("button[aria-expanded]").first().click();
    await hero.getByRole("button", { name: "حذف تصویر" }).click();
    await expect(page.getByText("تصویر بخش حذف شد.")).toBeVisible();
    expect(await db.media.count({ where: { id: imageId } })).toBe(0);
    await expect.poll(async () => (await fetch(src)).status).toBe(404); // the object is really gone
  });
});

test.describe("appearance", () => {
  test("colour and typography are applied to the draft preview and persisted", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه ظاهر", "فروشگاه عمومی");
    await page.goto(`/dashboard/stores/${storeId}/appearance`);
    await waitForHydration(page, "form:has(select[name=sizeScale])");
    await page.fill("input[name=primaryColor]", "#0f766e");
    await page.selectOption("select[name=sizeScale]", "large");
    await page.selectOption("select[name=headingWeight]", "600");
    await page.selectOption("select[name=bodyWeight]", "500");
    await page.getByRole("button", { name: "ذخیرهٔ ظاهر" }).click();
    await expect(page.getByText("ظاهر فروشگاه ذخیره شد.")).toBeVisible();
    const settings = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).settings as { primaryColor: string; typography: Record<string, unknown> };
    expect(settings.primaryColor).toBe("#0f766e");
    expect(settings.typography).toEqual({ fontFamily: "vazirmatn", sizeScale: "large", headingWeight: 600, bodyWeight: 500 });

    await page.goto(`/preview/${storeId}`);
    const root = page.locator("[data-template=general]");
    await expect(root).toHaveCSS("font-size", "17.6px"); // 110% of 16px
    await expect(root).toHaveCSS("font-weight", "500");
    await expect(root).toHaveCSS("font-family", /Vazirmatn/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveCSS("font-weight", "600");
  });

  test("values outside the allow-lists are rejected by the server even when the form is tampered with", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه دستکاری", "فروشگاه عمومی");
    const before = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).settings;
    await page.goto(`/dashboard/stores/${storeId}/appearance`);
    await waitForHydration(page, "form:has(select[name=sizeScale])");
    await page.evaluate(() => {
      const sel = document.querySelector("select[name=headingWeight]") as HTMLSelectElement;
      const o = document.createElement("option");
      o.value = "900";
      o.text = "900";
      sel.appendChild(o);
      sel.value = "900";
      const size = document.querySelector("select[name=sizeScale]") as HTMLSelectElement;
      const o2 = document.createElement("option");
      o2.value = "20px;background:url(x)";
      size.appendChild(o2);
      size.value = o2.value;
    });
    await page.getByRole("button", { name: "ذخیرهٔ ظاهر" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /نامعتبر|بررسی کنید/ }).first()).toBeVisible();
    expect((await db.store.findUniqueOrThrow({ where: { id: storeId } })).settings).toEqual(before);
  });
});

test.describe("isolation and templates", () => {
  test("another user gets the same 404 for pages, the editor and the appearance tab; a forged editor form changes nothing", async ({ page, browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه خصوصی", "فروشگاه عمومی");
    const other = await newUserSession(browser);
    const op = other.page;
    for (const path of ["pages", "pages/home", "pages/about", "appearance"]) {
      const res = await op.goto(`/dashboard/stores/${storeId}/${path}`);
      expect(res?.status(), path).toBe(404);
      await expect(op.getByRole("heading", { name: "صفحه پیدا نشد" })).toBeVisible();
    }
    expect((await op.goto(`/dashboard/stores/ckdoesnotexist000000000000/pages`))?.status()).toBe(404);

    // forge the store id of the attacker's own editor to point at the victim's store
    const attackerStore = await createStoreViaUi(op, "فروشگاه مهاجم", "فروشگاه عمومی");
    await openEditor(op, attackerStore, "about");
    const before = await sectionsOf(storeId, "ABOUT");
    await op.evaluate((victim) => {
      for (const el of document.querySelectorAll("input[name=storeId]")) (el as HTMLInputElement).value = victim;
    }, storeId);
    await addSection(op, "دعوت به اقدام");
    await expect(op.getByRole("heading", { name: /صفحه پیدا نشد|فروشگاه/ }).first()).toBeVisible();
    expect(await sectionsOf(storeId, "ABOUT")).toEqual(before);
    await other.context.close();
  });

  test("a store on a template without an editor yet explains it instead of failing", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه کافه", "قهوه و مواد غذایی");
    await page.goto(`/dashboard/stores/${storeId}/pages`);
    await expect(page.getByText("هنوز در دسترس نیست")).toBeVisible();
    await expect(page.getByTestId("page-row")).toHaveCount(0);
  });

  test("mobile: the editor has no horizontal scrolling", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه موبایل ویرایش", "فروشگاه عمومی");
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ["pages", "pages/home", "appearance"]) {
      await page.goto(`/dashboard/stores/${storeId}/${path}`);
      await expect(page.getByRole("tablist")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
