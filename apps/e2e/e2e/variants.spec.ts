import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp } from "./commerce";
import { db, expect, test, waitForHydration } from "./helpers";

/**
 * Product weight, variants (colour, size) and prices linked to the dollar or gold, on the product page, against the real API.
 * The merchant types option names and values, gets every combination, sets price and stock per combination; the product then shows the
 * lowest price and the summed stock, and the product form stops sending fields the API would refuse.
 */
const AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function newProduct(page: import("@playwright/test").Page, price = 120_000, stock = 4) {
  await apiSignUp(page);
  const s = await api(page, "POST", "/stores", { name: "فروشگاه تنوع", templateKey: "general" });
  const { id: storeId } = (await s.json()) as { id: string };
  const p = await api(page, "POST", `/stores/${storeId}/products`, { name: "پیراهن آزمون", price, stockQuantity: stock });
  expect(p.status(), await p.text()).toBeLessThan(300);
  const { id: productId } = (await p.json()) as { id: string };
  return { storeId, productId, url: `/dashboard/stores/${storeId}/products/${productId}` };
}
const product = async (page: import("@playwright/test").Page, storeId: string, productId: string) => (await (await api(page, "GET", `/stores/${storeId}/products/${productId}`)).json()) as { price: number; stockQuantity: number; weightGrams: number | null; name: string };

test("weight: saved with the product, empty means unknown", async ({ page }) => {
  const { storeId, productId, url } = await newProduct(page);
  await page.goto(url);
  await waitForHydration(page, "form");
  await page.getByLabel("وزن (گرم، اختیاری)").fill("۷۵۰");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات محصول ذخیره شد.")).toBeVisible();
  expect((await product(page, storeId, productId)).weightGrams).toBe(750);
  await page.reload();
  await expect(page.getByLabel("وزن (گرم، اختیاری)")).toHaveValue("750");
  await page.getByLabel("وزن (گرم، اختیاری)").fill("");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات محصول ذخیره شد.")).toBeVisible();
  expect((await product(page, storeId, productId)).weightGrams).toBeNull();
  await page.getByLabel("وزن (گرم، اختیاری)").fill("1.5");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText(/وزن باید عدد صحیح/)).toBeVisible(); // a precise refusal, nothing saved
});

test("variants: combinations from names and values, price and stock per combination, the product follows, and can be cleared", async ({ page }) => {
  const { storeId, productId, url } = await newProduct(page, 120_000, 4);
  await page.goto(url);
  await waitForHydration(page, '[data-testid="variants-editor"] button');
  const editor = page.getByTestId("variants-editor");
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").fill("قرمز، آبی");
  await editor.getByRole("button", { name: "افزودن ویژگی" }).click();
  await editor.getByLabel("نام ویژگی ۲").fill("سایز");
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").nth(1).fill("S، M");
  await editor.getByRole("button", { name: "ساخت ترکیب‌ها" }).click();
  await expect(editor.getByTestId("variant-row")).toHaveCount(4);
  await expect(editor.getByTestId("variant-row").first()).toContainText("قرمز / S");

  // an impossible combination count is refused with the reason, before anything is sent
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").first().fill("۱،۲،۳،۴،۵،۶");
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").nth(1).fill("۱،۲،۳،۴،۵،۶");
  await editor.getByRole("button", { name: "ساخت ترکیب‌ها" }).click();
  await expect(editor.getByRole("alert")).toContainText("حداکثر ۳۰ ترکیب");
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").first().fill("قرمز، آبی");
  await editor.getByLabel("مقدارها (با ویرگول جدا کنید)").nth(1).fill("S، M");
  await editor.getByRole("button", { name: "ساخت ترکیب‌ها" }).click();

  await editor.getByLabel("قیمت قرمز / S").fill("۹۰٬۰۰۰");
  for (const n of ["قرمز / S", "قرمز / M", "آبی / S", "آبی / M"]) await editor.getByLabel(`موجودی ${n}`).fill("5");
  await editor.getByLabel("کد انبار قرمز / S").fill("RED-S");
  await editor.getByRole("button", { name: "ذخیرهٔ تنوع‌ها" }).click();
  await expect(editor.getByText("تنوع‌ها ذخیره شد.")).toBeVisible();

  const p = await product(page, storeId, productId);
  expect([p.price, p.stockQuantity]).toEqual([90_000, 20]); // the lowest price and the summed stock
  const variants = (await (await api(page, "GET", `/stores/${storeId}/products/${productId}/variants`)).json()) as { sku: string | null; price: number }[];
  expect(variants).toHaveLength(4);
  expect(variants.find((v) => v.sku === "RED-S")?.price).toBe(90_000);

  // the product form owns neither price nor stock now, and saving the rest still works (the API refuses those two fields)
  await page.reload();
  await expect(page.getByLabel("قیمت (تومان)")).toBeDisabled();
  await expect(page.getByLabel("موجودی (عدد)")).toBeDisabled();
  await page.getByLabel("نام محصول").fill("پیراهن آزمون (ویرایش)");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات محصول ذخیره شد.")).toBeVisible();
  expect((await product(page, storeId, productId)).name).toBe("پیراهن آزمون (ویرایش)");

  const axe = await new AxeBuilder({ page }).withTags(AXE).include('[data-testid="variants-editor"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // clearing returns the product to its own price and stock
  await page.getByRole("button", { name: "برداشتن همهٔ تنوع‌ها" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "برداشتن", exact: true }).click();
  await expect(page.getByText(/تنوع‌ها برداشته شد/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("قیمت (تومان)")).toBeEnabled();
  expect(((await (await api(page, "GET", `/stores/${storeId}/products/${productId}/variants`)).json()) as unknown[]).length).toBe(0);
});

test("price link: a product's price follows the dollar; a variant's price too; both can be removed", async ({ page }) => {
  await db.exchangeRate.create({ data: { code: "USD", rateToman: 60_000, source: "manual", observedAt: new Date(), status: "APPLIED" } });
  const { storeId, productId, url } = await newProduct(page, 100_000, 3);
  await page.goto(url);
  await waitForHydration(page, '[data-testid="product-price-link"] button');

  // ---- the product itself
  const card = page.getByTestId("product-price-link");
  await card.getByRole("button", { name: "اتصال قیمت" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("قیمت امروز این کالا (تومان)").fill("۶٬۰۰۰٬۰۰۰"); // 100 dollars at 60,000
  await expect(dialog.getByTestId("link-preview")).toContainText("۶٬۰۰۰٬۰۰۰ تومان");
  const axe = await new AxeBuilder({ page }).withTags(AXE).include('[role="dialog"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  await dialog.getByRole("button", { name: "اتصال قیمت" }).click();
  await expect(card.getByText("متصل به دلار")).toBeVisible();
  expect((await product(page, storeId, productId)).price).toBe(6_000_000);
  await expect(page.getByLabel("قیمت (تومان)")).toBeDisabled();

  await card.getByRole("button", { name: "برداشتن اتصال" }).click();
  await expect(card.getByRole("button", { name: "اتصال قیمت" })).toBeVisible();
  await expect(page.getByLabel("قیمت (تومان)")).toBeEnabled();

  // ---- one variant (variants exist: the product-level link card is gone, each variant has its own button)
  const put = await api(page, "PUT", `/stores/${storeId}/products/${productId}/variants`, { variants: [{ options: [{ name: "رنگ", value: "قرمز" }], price: 200_000, stockQuantity: 2 }, { options: [{ name: "رنگ", value: "آبی" }], price: 210_000, stockQuantity: 1 }] });
  expect(put.status(), await put.text()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("product-price-link")).toHaveCount(0);
  await waitForHydration(page, '[data-testid="variants-editor"] button');
  await page.getByRole("button", { name: "اتصال قیمت قرمز به دلار یا طلا" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "از مبلغ دلاری" }).click();
  await page.getByRole("dialog").getByLabel("مبلغ به دلار").fill("10");
  await expect(page.getByRole("dialog").getByTestId("link-preview")).toContainText("۶۰۰٬۰۰۰ تومان");
  await page.getByRole("dialog").getByRole("button", { name: "اتصال قیمت" }).click();
  const red = page.getByTestId("variant-row").filter({ hasText: "قرمز" });
  await expect(red.getByText("متصل به دلار")).toBeVisible();
  await expect(red.getByRole("textbox", { name: "قیمت قرمز" })).toBeDisabled();
  await expect(red.getByRole("textbox", { name: "قیمت قرمز" })).toHaveValue("600000");
  await red.getByRole("button", { name: "برداشتن اتصال" }).click();
  await expect(red.getByRole("textbox", { name: "قیمت قرمز" })).toBeEnabled();
});
