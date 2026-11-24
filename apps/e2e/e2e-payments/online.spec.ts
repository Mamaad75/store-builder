import type { Page, Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { FAKE_ZARINPAL_URL, PAY_DATABASE_URL, TEST_ZARINPAL_MERCHANT } from "../playwright.payments.config";
import { api, apiSignUp, createLiveStore, fillCheckout, makeSuperAdmin, placeButton, shopper, storeUrl, type LiveStore } from "../e2e/commerce";
import { expect, test } from "../e2e/helpers";

/**
 * M1-7 (MVP roadmap; D-E2E-PAY §12.1): an online (Zarinpal) purchase end to end on the ISOLATED payments stack: a NODE_ENV=test API on its
 * own "_e2e" database, a loopback fake gateway (src/fake-zarinpal.mjs) with one fixed test merchant id, test-only master keys.
 *
 * The one piece of browser plumbing: the web app is a PRODUCTION build, so it sends the browser only to the real gateway hosts
 * (client/shop.ts goToGateway) and refuses a loopback one. The test therefore shows the browser the real sandbox address
 * (https://sandbox.zarinpal.com/pg/StartPay/<authority>) and serves that address from the fake gateway, in place of DNS and TLS. The
 * web app's gateway allow-list runs unchanged; the server-to-server calls (request, verify) go to the fake through ZARINPAL_DEV_BASE_URL.
 */
const payDb = new PrismaClient({ datasources: { db: { url: PAY_DATABASE_URL } } });
const SANDBOX = "https://sandbox.zarinpal.com";

test.afterAll(async () => payDb.$disconnect());

/** The platform switch (SUPER_ADMIN, test database only) and the store's merchant id (secret, encrypted with the test-only key). */
async function onlineStore(page: Page, admin: Page): Promise<LiveStore> {
  await apiSignUp(page);
  const s = await createLiveStore(page);
  const set = await api(page, "PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: TEST_ZARINPAL_MERCHANT });
  expect(set.status()).toBe(204);
  await makeSuperAdmin(admin, payDb);
  const r = await api(admin, "PATCH", "/v1/platform/settings/payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: true });
  expect(r.status(), await r.text()).toBe(200);
  return s;
}

/** Browser-only: show the real sandbox address, serve it from the loopback fake (see the note above). */
async function routeGateway(page: Page): Promise<void> {
  await page.route(/\/api\/shop\/checkout\/orders\/[^/]+\/pay$/, async (route: Route) => {
    // Node (which runs route.fetch) cannot resolve *.localhost: same request to 127.0.0.1 with the store's Host header and the browser's cookies.
    const u = new URL(route.request().url());
    const headers = { ...(await route.request().allHeaders()), host: u.host };
    const res = await route.fetch({ url: `http://127.0.0.1:${u.port}${u.pathname}${u.search}`, headers });
    const body = (await res.json()) as { url?: string };
    expect(body.url?.startsWith(`${FAKE_ZARINPAL_URL}/pg/StartPay/S`), `${res.status()} ${JSON.stringify(body)}`).toBe(true); // the API asked the fake for a SANDBOX session
    await route.fulfill({ response: res, json: { ...body, url: body.url!.replace(FAKE_ZARINPAL_URL, SANDBOX) } });
  });
  await page.route(`${SANDBOX}/pg/StartPay/**`, async (route: Route) => {
    const res = await route.fetch({ url: route.request().url().replace(SANDBOX, FAKE_ZARINPAL_URL), maxRedirects: 0 });
    const location = res.headers()["location"];
    if (location) await route.fulfill({ status: 302, headers: { location } });
    else await route.fulfill({ response: res });
  });
}

async function startOnlinePurchase(page: Page, s: LiveStore): Promise<string> {
  await routeGateway(page);
  await fillCheckout(page, s, "ZARINPAL");
  await expect(placeButton(page, "ZARINPAL")).toBeEnabled();
  await placeButton(page, "ZARINPAL").click();
  await page.waitForURL(/^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\/S[0-9A-Za-z]{35}$/);
  return page.url().split("/").pop()!;
}

test("online payment: gateway → verified on return → order placed, stock kept, merchant sees it paid", async ({ page, browser }) => {
  const { context: adminCtx, page: admin } = await shopper(browser);
  const s = await onlineStore(page, admin);
  const { context, page: buyer } = await shopper(browser);

  const authority = await startOnlinePurchase(buyer, s);
  // The amount sent to the gateway is the server's total in RIAL: (120,000 + 30,000 shipping) × 10.
  await expect(buyer.locator("#amount")).toHaveText("1500000");
  const order = await payDb.order.findFirstOrThrow({ where: { storeId: s.storeId } });
  expect(order.status).toBe("AWAITING_PAYMENT"); // not paid before the gateway is verified
  expect((await payDb.payment.findUniqueOrThrow({ where: { authority } })).status).not.toBe("PAID");

  await buyer.getByRole("link", { name: "پرداخت آزمایشی" }).click();
  await buyer.waitForURL(/\/orders\/[A-Za-z0-9_-]{43}$/); // the return page verified server-side, then opened the order
  await expect(buyer.getByText("وضعیت: ثبت‌شده")).toBeVisible();
  await expect(buyer.getByText(/پرداخت‌شده — کد پیگیری 201/)).toBeVisible();

  const paid = await payDb.payment.findUniqueOrThrow({ where: { authority } });
  expect([paid.status, paid.refId, paid.sandbox]).toEqual(["PAID", "201", true]);
  expect((await payDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PLACED");
  expect((await payDb.product.findUniqueOrThrow({ where: { id: s.productId } })).stockQuantity).toBe(9);

  await page.goto(`/dashboard/stores/${s.storeId}/orders/${order.id}`);
  await expect(page.getByText("ثبت‌شده", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/201/).first()).toBeVisible(); // the gateway reference
  await context.close();
  await adminCtx.close();
});

test("online payment: cancelled at the gateway, or a forged Status=OK return, never places the order", async ({ page, browser }) => {
  const { context: adminCtx, page: admin } = await shopper(browser);
  const s = await onlineStore(page, admin);
  const { context, page: buyer } = await shopper(browser);

  const authority = await startOnlinePurchase(buyer, s);
  await buyer.getByRole("link", { name: "انصراف" }).click();
  await buyer.waitForURL(/\/checkout\/payment\/return\?/);
  await expect(buyer.getByText(/پرداخت انجام نشد/)).toBeVisible();

  // A forged return claiming success: Status=OK only triggers a server-side verify, which the gateway answers "not paid" (-51).
  await buyer.goto(storeUrl(s.label, `/checkout/payment/return?Authority=${authority}&Status=OK`));
  await expect(buyer.getByRole("status")).not.toHaveText(/در حال تأیید پرداخت/);
  await expect(buyer.getByText("پرداخت شما با موفقیت انجام و سفارش ثبت شد.")).toHaveCount(0);

  const order = await payDb.order.findFirstOrThrow({ where: { storeId: s.storeId } });
  expect(order.status).toBe("AWAITING_PAYMENT");
  expect((await payDb.payment.findUniqueOrThrow({ where: { authority } })).status).not.toBe("PAID");
  await context.close();
  await adminCtx.close();
});
