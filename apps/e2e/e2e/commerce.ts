import { deflateSync } from "node:zlib";
import { test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { PASSWORD, db, expect, randomIp, uniqueUsername, waitForHydration } from "./helpers";

/**
 * M1 (MVP roadmap): commerce fixtures. A merchant and a published store are set up through the REAL API (the same routes the dashboard
 * uses), so the specs spend their time on the shopper and merchant journeys in the browser. The database is only READ by the specs, except
 * for granting a platform admin (no HTTP route grants the first one by design).
 */
// The stack is the running project's: "chromium" → the main stack (3100), "payments" → the isolated payments stack (3200, D-E2E-PAY).
const baseUrl = () => new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
const port = () => Number(baseUrl().port);
const platform = () => baseUrl().origin;
export const storeUrl = (label: string, path = "/") => `http://${label}.localhost:${port()}${path}`;

export interface LiveStore {
  storeId: string;
  label: string;
  productId: string;
  productSlug: string;
  productName: string;
  price: number;
}

/** A JSON call to the API through the web app's /api proxy, as the signed-in user of `page`'s context (the platform origin is required). */
export async function api(page: Page, method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<APIResponse> {
  return page.request.fetch(`${platform()}/api${path}`, {
    method,
    headers: { origin: platform(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
}

async function ok(r: APIResponse, what: string): Promise<unknown> {
  if (!r.ok()) throw new Error(`${what}: HTTP ${r.status()} ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** Registers and signs in a fresh account in `page`'s context (session cookie on the platform host). Returns the username. */
export async function apiSignUp(page: Page, name = "فروشنده‌ی آزمون"): Promise<string> {
  const username = uniqueUsername();
  await ok(await api(page, "POST", "/auth/register", { name, username, password: PASSWORD }), "register");
  await ok(await api(page, "POST", "/auth/login", { username, password: PASSWORD }), "login");
  return username;
}

/** A published store with one active product (stock 10), a flat shipping method with cash on delivery, and a subdomain. */
export async function createLiveStore(page: Page, o: { price?: number; stock?: number; bankCard?: boolean } = {}): Promise<LiveStore> {
  const label = `shop${Math.random().toString(36).slice(2, 9)}`;
  const productName = "چای آزمون";
  const price = o.price ?? 120_000;
  const store = (await ok(await api(page, "POST", "/stores", { name: `فروشگاه ${label}`, templateKey: "general" }), "create store")) as { id: string };
  const product = (await ok(await api(page, "POST", `/stores/${store.id}/products`, { name: productName, price, stockQuantity: o.stock ?? 10 }), "create product")) as { id: string; slug: string };
  await ok(await api(page, "POST", `/stores/${store.id}/products/${product.id}/status`, { status: "ACTIVE" }), "activate product");
  await ok(await api(page, "PUT", `/stores/${store.id}/shipping-methods`, { methods: [{ name: "پیک", kind: "FLAT", price: 30_000, cashOnDelivery: { enabled: true } }] }), "shipping");
  if (o.bankCard) await ok(await api(page, "PUT", `/stores/${store.id}/bank-cards`, { cards: [{ cardNumber: "6037991234567893", holderName: "علی رضایی" }] }), "bank card");
  await ok(await api(page, "POST", `/stores/${store.id}/subdomain`, { label }), "subdomain");
  const state = (await ok(await api(page, "GET", `/stores/${store.id}/publish`), "publish state")) as { draftRevision?: number; draft?: { revision?: number } };
  await ok(await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision }), "publish");
  return { storeId: store.id, label, productId: product.id, productSlug: product.slug, productName, price };
}

/** A shopper: a fresh browser context (no merchant cookies) with its own client address. */
export async function shopper(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, locale: "fa-IR" });
  return { context, page: await context.newPage() };
}

/** Product page → add to cart → checkout → address → shipping → payment method (nothing placed yet). */
export type CheckoutMethod = "COD" | "CARD_TRANSFER" | "ZARINPAL";

export async function fillCheckout(page: Page, s: LiveStore, method: CheckoutMethod): Promise<void> {
  await page.goto(storeUrl(s.label, `/products/${s.productSlug}`));
  await waitForHydration(page, "form[aria-label^='خرید'] button[type=submit]");
  await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
  // the add committed: the slide-in cart opens, and it leads on to checkout
  await page.getByRole("dialog", { name: "سبد خرید" }).getByRole("link", { name: "ادامه‌ی خرید" }).click();
  await page.waitForURL(/\/checkout$/);
  await waitForHydration(page, "textarea");
  await page.getByLabel("نام و نام خانوادگی گیرنده").fill("مریم احمدی");
  await page.getByLabel("موبایل", { exact: true }).fill("09121234567");
  await page.locator("label", { hasText: "استان" }).locator("select").selectOption("tehran");
  await page.getByRole("combobox", { name: "شهر", exact: true }).fill("تهران");
  await page.getByLabel("کد پستی (۱۰ رقم)").fill("1384567891");
  await page.getByLabel("نشانی کامل (خیابان، کوچه، پلاک، واحد)").fill("خیابان ولیعصر، کوچه‌ی ۵، پلاک ۸");
  await page.getByRole("button", { name: "نمایش روش‌های ارسال" }).click();
  await page.getByRole("radio", { name: /پیک/ }).check();
  if (method === "CARD_TRANSFER") await page.getByRole("radio", { name: /کارت به کارت/ }).check();
  else if (method === "ZARINPAL") await page.getByRole("radio", { name: /زرین‌پال/ }).check();
  else {
    // A store that only takes cash on delivery shows a note instead of a choice.
    const cod = page.getByRole("radio", { name: /پرداخت در محل/ });
    if (await cod.count()) await cod.check();
    else await expect(page.getByText("پرداخت در محل (هنگام تحویل).")).toBeVisible();
  }
}

/** A raw request to a store host from the test process (Node cannot resolve *.localhost; the Host header decides the store). */
export function storeRequest(page: Page, label: string, path: string): Promise<APIResponse> {
  return page.request.get(`http://127.0.0.1:${port()}${path}`, { headers: { host: `${label}.localhost:${port()}` }, maxRedirects: 0, failOnStatusCode: false });
}

export const placeButton = (page: Page, method: CheckoutMethod) =>
  page.getByRole("button", { name: method === "ZARINPAL" ? "ثبت سفارش و پرداخت" : method === "CARD_TRANSFER" ? "ثبت سفارش و دریافت شماره کارت" : "ثبت سفارش", exact: true });

/** Places the filled checkout; returns the order page URL (it holds the access token). */
export async function placeOrder(page: Page, method: "COD" | "CARD_TRANSFER"): Promise<string> {
  await expect(placeButton(page, method)).toBeEnabled();
  await placeButton(page, method).click();
  await page.waitForURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return page.url();
}

export async function buyOne(page: Page, s: LiveStore, method: "COD" | "CARD_TRANSFER"): Promise<string> {
  await fillCheckout(page, s, method);
  return placeOrder(page, method);
}

/** A small valid PNG (solid colour), built without image libraries: enough for the receipt pipeline (it re-encodes). */
export function pngBytes(w = 64, h = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Grants SUPER_ADMIN to a freshly registered account (no HTTP route can grant the first one; the server command does the same). */
export async function makeSuperAdmin(page: Page, client: PrismaClient = db): Promise<void> {
  const username = await apiSignUp(page, "مدیر پلتفرم");
  const user = await client.user.findUniqueOrThrow({ where: { username } });
  await client.platformAdmin.create({ data: { userId: user.id } });
}
