import { randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "../playwright.config";

export const db = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

export const PASSWORD = "password123";
export const GENERIC_LOGIN_ERROR = "ایمیل یا رمز عبور نادرست است.";
export const RATE_LIMIT_TEXT = "بیش از حد";

export const uniqueEmail = () => `user-${randomBytes(6).toString("hex")}@example.com`;
export const randomIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0]! % 250)}`;

/**
 * Resolves once React has hydrated the element matching `selector` (React attaches internal
 * `__reactProps$` / `__reactFiber$` properties to host nodes during hydration). Interacting with
 * controlled inputs or tampering with the DOM *before* hydration is a race: hydration re-applies
 * the server-rendered defaults and discards the changes (seen on slow CI runners).
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
  }, selector);
}

/** Every test acts from its own client IP (as a trusted proxy would report it) => isolated rate-limit buckets. */
export const test = base.extend<{ ip: string }>({
  ip: async ({}, provide) => provide(randomIp()),
  // Optional: E2E_CPU_THROTTLE=6 slows the main page's CPU 6x to expose timing races (e.g. hydration).
  page: async ({ page }, provide) => {
    const rate = Number(process.env.E2E_CPU_THROTTLE ?? "1");
    if (rate > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate });
    await provide(page);
  },
  context: async ({ context, ip }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    await provide(context);
  },
});
export { expect };

export async function register(page: Page, email: string, name = "علی", password = PASSWORD) {
  await page.goto("/register");
  await page.fill("input[name=name]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
}

export async function createUser(page: Page, email = uniqueEmail()) {
  await register(page, email);
  await page.waitForURL(/\/login\?registered=1/);
  return email;
}

export async function loginAndWaitForDashboard(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL(/\/dashboard/);
}

export const formAlert = (page: Page) => page.locator(".MuiAlert-message");

/** Registers a user and signs in; returns the email. */
export async function signUpAndIn(page: Page): Promise<string> {
  const email = await createUser(page);
  await loginAndWaitForDashboard(page, email);
  return email;
}

/** Creates a store through the UI and returns its id. */
export async function createStoreViaUi(page: Page, name: string, templateName?: string): Promise<string> {
  await page.goto("/dashboard/stores/new");
  await waitForHydration(page, "form:has(input[name=templateKey])");
  await page.fill("input[name=name]", name);
  if (templateName) await page.getByText(templateName, { exact: true }).click();
  await page.getByRole("button", { name: "ساخت فروشگاه" }).click();
  await page.waitForURL(/\/dashboard\/stores\/(?!new$)[^/]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Creates a category through the UI (store's "categories" tab). */
export async function createCategoryViaUi(page: Page, storeId: string, name: string) {
  await page.goto(`/dashboard/stores/${storeId}/categories`);
  await waitForHydration(page, "form:has(input[name=storeId])");
  await page.fill("input[name=name]", name);
  await page.getByRole("button", { name: "افزودن دسته" }).click();
  await expect(page.getByText("دسته‌بندی ساخته شد.")).toBeVisible();
}

/** Creates a product through the UI form; the new product is always a DRAFT. */
export async function createProductViaUi(
  page: Page,
  storeId: string,
  p: { name: string; price: string; stock?: string; category?: string; slug?: string },
) {
  await page.goto(`/dashboard/stores/${storeId}/products/new`);
  await waitForHydration(page, "form:has(input[name=price])");
  await page.fill("input[name=name]", p.name);
  if (p.slug) await page.fill("input[name=slug]", p.slug);
  await page.fill("input[name=price]", p.price);
  await page.fill("input[name=stockQuantity]", p.stock ?? "1");
  if (p.category) await page.selectOption("select[name=categoryId]", { label: p.category });
  await page.getByRole("button", { name: "ساخت محصول" }).click();
  await page.waitForURL(/\/products(\?|$)/);
}

export const productRow = (page: Page, name: string) => page.getByTestId("product-row").filter({ hasText: name });
export const notice = (page: Page) => page.getByRole("status");
