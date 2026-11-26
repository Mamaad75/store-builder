import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

/** Price and stock changed right in the product list; a number owned by variants or a price link is not editable there. */
test("quick edit: price and stock in the list, refusals explained, locked when something else owns the number", async ({ page }) => {
  await apiSignUp(page);
  const s = await api(page, "POST", "/stores", { name: "فروشگاه ویرایش سریع", templateKey: "general" });
  const { id: storeId } = (await s.json()) as { id: string };
  const mk = async (name: string, price: number, stock: number) => ((await (await api(page, "POST", `/stores/${storeId}/products`, { name, price, stockQuantity: stock })).json()) as { id: string }).id;
  const plain = await mk("چای ساده", 100_000, 5);
  const withVariants = await mk("پیراهن تنوع‌دار", 200_000, 0);
  expect((await api(page, "PUT", `/stores/${storeId}/products/${withVariants}/variants`, { variants: [{ options: [{ name: "سایز", value: "M" }], price: 250_000, stockQuantity: 3 }] })).status()).toBe(200);

  await page.goto(`/dashboard/stores/${storeId}/products`);
  await waitForHydration(page, '[data-testid="product-row"] button');
  const row = page.getByTestId("product-row").filter({ hasText: "چای ساده" });

  // price: a refusal first (nothing saved), then a Persian-digit value that is saved
  await row.getByRole("button", { name: /ویرایش سریع قیمت/ }).click();
  await row.getByRole("textbox", { name: /قیمت «چای ساده»/ }).fill("abc");
  await row.getByRole("button", { name: /ذخیرهٔ قیمت/ }).click();
  await expect(row.getByText("قیمت را به تومان و به‌صورت عدد صحیح وارد کنید.")).toBeVisible();
  await row.getByRole("textbox", { name: /قیمت «چای ساده»/ }).fill("۱۲۵٬۰۰۰");
  await row.getByRole("button", { name: /ذخیرهٔ قیمت/ }).click();
  await expect(row).toContainText("۱۲۵٬۰۰۰ تومان");
  expect(((await (await api(page, "GET", `/stores/${storeId}/products/${plain}`)).json()) as { price: number }).price).toBe(125_000);

  // stock: Escape cancels, Enter saves
  await row.getByRole("button", { name: /ویرایش سریع موجودی/ }).click();
  await row.getByRole("textbox", { name: /موجودی «چای ساده»/ }).fill("99");
  await page.keyboard.press("Escape");
  expect(((await (await api(page, "GET", `/stores/${storeId}/products/${plain}`)).json()) as { stockQuantity: number }).stockQuantity).toBe(5);
  await row.getByRole("button", { name: /ویرایش سریع موجودی/ }).click();
  await row.getByRole("textbox", { name: /موجودی «چای ساده»/ }).fill("۱۲");
  await page.keyboard.press("Enter");
  await expect.poll(async () => ((await (await api(page, "GET", `/stores/${storeId}/products/${plain}`)).json()) as { stockQuantity: number }).stockQuantity).toBe(12);

  // a product with variants: the numbers come from the variants, no pencil, the reason is shown
  const locked = page.getByTestId("product-row").filter({ hasText: "پیراهن تنوع‌دار" });
  await expect(locked.getByTestId("locked-price")).toContainText("از تنوع‌ها");
  await expect(locked.getByTestId("locked-stockQuantity")).toContainText("جمع تنوع‌ها");
  await expect(locked.getByRole("button", { name: /ویرایش سریع/ })).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[aria-label="فهرست محصولات"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
});
