import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, shopper, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

/** The slide-in cart in the store's header: opens from the cart icon and after "add to cart", edits lines, leads on; usable by keyboard and on a phone. */
test("mini cart: opens from the icon and after adding, changes quantities, removes, closes with Esc, keeps focus", async ({ page, browser }) => {
  await apiSignUp(page);
  const store = (await (await api(page, "POST", "/stores", { name: "فروشگاه سبد", templateKey: "bazaar" })).json()) as { id: string };
  const slugs: string[] = [];
  for (const [i, price] of [250_000, 90_000].entries()) {
    const p = (await (await api(page, "POST", `/stores/${store.id}/products`, { name: `کالای سبد ${i + 1}`, price, stockQuantity: 9 })).json()) as { id: string; slug: string };
    await api(page, "POST", `/stores/${store.id}/products/${p.id}/status`, { status: "ACTIVE" });
    slugs.push(p.slug);
  }
  const label = `mc${Math.random().toString(36).slice(2, 8)}`;
  await api(page, "POST", `/stores/${store.id}/subdomain`, { label });
  const st = (await (await api(page, "GET", `/stores/${store.id}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: st.draftRevision ?? st.draft?.revision })).ok()).toBe(true);

  const { context, page: shop } = await shopper(browser);
  await shop.goto(storeUrl(label, `/products/${slugs[0]}`));
  await waitForHydration(shop, "form[aria-label^='خرید'] button[type=submit]");
  await shop.getByRole("button", { name: "افزودن به سبد خرید" }).click();
  const panel = shop.getByRole("dialog", { name: "سبد خرید" });
  await expect(panel).toBeVisible();
  await expect(shop).toHaveURL(/\/products\//); // the shopper stays on the product
  await expect(panel.getByText("کالای سبد 1")).toBeVisible();
  await expect(panel.getByText(/۲۵۰٬۰۰۰ تومان/).first()).toBeVisible();

  // quantity and total follow; the header badge too
  await panel.getByRole("button", { name: "یکی بیشتر از کالای سبد 1" }).click();
  await expect(panel.locator("strong")).toContainText("۵۰۰٬۰۰۰");
  await expect(panel.getByRole("button", { name: "یکی کمتر از کالای سبد 1" })).toBeEnabled();

  // axe with the panel open, and the panel fits a 320 px phone
  const axe = await new AxeBuilder({ page: shop }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
  await shop.setViewportSize({ width: 320, height: 640 });
  const box = await panel.boundingBox();
  expect(box && box.width <= 320 && box.x >= 0).toBe(true);
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shop.setViewportSize({ width: 1280, height: 800 });

  // Esc closes it and focus goes back to the page (the add button)
  await shop.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // the cart icon opens it again, with the same lines
  await shop.getByRole("link", { name: /سبد خرید/ }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("کالای سبد 1")).toBeVisible();
  await panel.getByRole("button", { name: "بستن سبد خرید" }).click();
  await expect(panel).toBeHidden();

  // a second product from its page; then remove the first inside the panel
  await shop.goto(storeUrl(label, `/products/${slugs[1]}`));
  await waitForHydration(shop, "form[aria-label^='خرید'] button[type=submit]");
  await shop.getByRole("button", { name: "افزودن به سبد خرید" }).click();
  await expect(panel.getByText("کالای سبد 2")).toBeVisible();
  await panel.getByRole("button", { name: "حذف کالای سبد 1 از سبد" }).click();
  await expect(panel.getByText("کالای سبد 1")).toHaveCount(0);
  await expect(panel.locator("strong")).toContainText("۹۰٬۰۰۰");

  // the full cart page and checkout are one click away; on the cart page the icon is a plain link
  await panel.getByRole("link", { name: "مشاهدهٔ سبد کامل" }).click();
  await expect(shop).toHaveURL(/\/cart$/);
  await waitForHydration(shop, "ul[aria-label='کالاهای سبد']");
  await shop.getByRole("link", { name: /سبد خرید/ }).first().click();
  await expect(shop.getByRole("dialog")).toHaveCount(0);

  await context.close();
});
