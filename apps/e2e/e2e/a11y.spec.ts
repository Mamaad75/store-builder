import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createProductViaUi, createStoreViaUi, db, expect, signUpAndIn, test } from "./helpers";

/**
 * Automated accessibility checks (M3 audit, docs/audit-m3-accessibility.md): axe-core with the WCAG 2.0/2.1/2.2 A and AA rule sets on
 * the platform pages, the dashboard and every storefront theme, on a desktop and a phone width. ANY violation fails the test, so a
 * regression of an audited fix (or a new problem) is caught in CI. Also: no horizontal scrolling at 320 px.
 */
test.afterAll(() => db.$disconnect());

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const WIDTHS = [1280, 375];

async function expectAccessible(page: Page, label: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const summary = violations.map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
    expect(summary, `${label} @ ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: horizontal scrolling at 320px`).toBeLessThanOrEqual(0);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test("platform pages: landing, sign-in, registration, password reset request, legal, 404", async ({ page }) => {
    const pages: [string, string][] = [["landing", "/"], ["login", "/login"], ["register", "/register"], ["terms", "/terms"], ["404", "/no-such-page"]];
    for (const [label, path] of pages) {
      await page.goto(path);
      await expectAccessible(page, label);
    }
  });

  test("dashboard pages, including the page editor and the product form", async ({ page }) => {
    await signUpAndIn(page);
    await expectAccessible(page, "dashboard");
    const storeId = await createStoreViaUi(page, "فروشگاه دسترس‌پذیر");
    const tabs: [string, string][] = [["store", ""], ["products", "/products"], ["product form", "/products/new"], ["categories", "/categories"], ["pages", "/pages"], ["page editor", "/pages/HOME"], ["appearance", "/appearance"], ["publish", "/publish"]];
    for (const [label, sub] of tabs) {
      await page.goto(`/dashboard/stores/${storeId}${sub}`);
      await expectAccessible(page, label);
    }
    await page.goto("/dashboard/account");
    await expectAccessible(page, "account");
  });

  for (const theme of ["bazaar", "circuit", "sormeh", "dookht", "arcade", "sofreh", "golkhaneh", "khaneh", "general", "coffee", "fashion", "appliances"] as const) {
    test(`storefront theme "${theme}" with a LIGHT brand colour and an active product (preview)`, async ({ page }) => {
      await signUpAndIn(page);
      const storeId = await createStoreViaUi(page, `فروشگاه ${theme}`, theme);
      await createProductViaUi(page, storeId, { name: "محصول نمونه", price: "125000", stock: "3" });
      // A light brand colour is the hard case for contrast (audit finding 1: 1.5:1 before the fix in the appliances theme).
      const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
      await db.store.update({ where: { id: storeId }, data: { settings: { ...(store.settings as object), primaryColor: "#facc15" } } });
      await db.product.updateMany({ where: { storeId }, data: { status: "ACTIVE" } });
      const product = await db.product.findFirstOrThrow({ where: { storeId } });
      const routes: [string, string][] = [["home", ""], ["products", "/products"], ["product", `/products/${encodeURIComponent(product.slug)}`], ["about", "/about"], ["contact", "/contact"]];
      for (const [label, path] of routes) {
        await page.goto(`/preview/${storeId}${path}`);
        await expect(page.locator("main").first()).toBeVisible();
        await expectAccessible(page, `${theme} ${label}`);
      }
    });
  }
});
