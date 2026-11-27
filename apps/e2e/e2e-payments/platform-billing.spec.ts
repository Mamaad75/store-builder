import { AxeBuilder } from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { FAKE_ZARINPAL_URL, PAY_DATABASE_URL, TEST_ZARINPAL_MERCHANT } from "../playwright.payments.config";
import { api, apiSignUp, makeSuperAdmin, shopper } from "../e2e/commerce";
import { expect, test, waitForHydration } from "../e2e/helpers";

/**
 * A store paying the PLATFORM through the gateway (plans and wallet top-up) on the isolated payments stack: loopback fake Zarinpal, test merchant id.
 * Browser plumbing as in online.spec.ts: the production web build sends the browser only to real gateway hosts, so the test shows it the real
 * sandbox address and serves that from the fake.
 */
const payDb = new PrismaClient({ datasources: { db: { url: PAY_DATABASE_URL } } });
const SANDBOX = "https://sandbox.zarinpal.com";
test.afterAll(async () => payDb.$disconnect());

async function routeGateway(page: Page): Promise<void> {
  await page.route(/\/billing\/(pay|topup)$/, async (route: Route) => {
    const res = await route.fetch();
    if (res.status() !== 200) return route.fulfill({ response: res });
    const body = (await res.json()) as { url?: string };
    expect(body.url?.startsWith(`${FAKE_ZARINPAL_URL}/pg/StartPay/S`), JSON.stringify(body)).toBe(true);
    await route.fulfill({ response: res, json: { ...body, url: body.url!.replace(FAKE_ZARINPAL_URL, SANDBOX) } });
  });
  await page.route(`${SANDBOX}/pg/StartPay/**`, async (route: Route) => {
    const res = await route.fetch({ url: route.request().url().replace(SANDBOX, FAKE_ZARINPAL_URL), maxRedirects: 0 });
    const location = res.headers()["location"];
    if (location) await route.fulfill({ status: 302, headers: { location } });
    else await route.fulfill({ response: res });
  });
}
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

test("a store buys a plan and charges its wallet through the gateway; a cancelled payment changes nothing", async ({ page, browser }) => {
  // staff: the platform's gateway (switch + merchant id) and a plan
  const { context: staffCtx, page: staff } = await shopper(browser);
  await makeSuperAdmin(staff, payDb);
  expect((await api(staff, "PATCH", "/v1/platform/settings/payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: true })).status()).toBe(200);
  expect((await api(staff, "POST", "/v1/platform/secrets/payment.zarinpal.merchant_id", { value: TEST_ZARINPAL_MERCHANT })).status()).toBe(204);
  const plan = await api(staff, "POST", "/v1/platform/plans", { name: "طلایی", priceToman: 200_000, durationDays: 30, maxProducts: 100, maxStaff: 2 });
  expect(plan.status(), await plan.text()).toBe(201);

  // the seller
  await apiSignUp(page);
  const store = (await (await api(page, "POST", "/stores", { name: "فروشگاه پرداخت", templateKey: "bazaar" })).json()) as { id: string };
  await routeGateway(page);

  // top up the wallet first: 50,000 toman, cancelled at the gateway
  await page.goto(`/dashboard/stores/${store.id}/wallet`);
  await waitForHydration(page, "form button[type=submit]");
  await page.getByLabel("مبلغ شارژ (تومان)").fill("۵۰٬۰۰۰");
  await page.getByRole("button", { name: "رفتن به درگاه پرداخت" }).click();
  await page.waitForURL(/sandbox\.zarinpal\.com\/pg\/StartPay\/S/);
  await page.locator("#cancel").click();
  await expect(page.getByTestId("payment-return")).toHaveAttribute("data-outcome", "failed");
  await expect(page.getByText("انجام نشد")).toBeVisible();

  // ... and then really paid
  await page.goto(`/dashboard/stores/${store.id}/wallet`);
  await waitForHydration(page, "form button[type=submit]");
  await page.getByLabel("مبلغ شارژ (تومان)").fill("50000");
  await page.getByRole("button", { name: "رفتن به درگاه پرداخت" }).click();
  await page.waitForURL(/sandbox\.zarinpal\.com\/pg\/StartPay\/S/);
  await page.locator("#pay").click();
  await expect(page.getByTestId("payment-return")).toHaveAttribute("data-outcome", "paid");
  await expect(page.getByTestId("payment-return")).toContainText("اضافه شد");
  expect((await axe(page)).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
  await page.goto(`/dashboard/stores/${store.id}/wallet`);
  await expect(page.getByTestId("wallet-balance")).toHaveText("۵۰٬۰۰۰ تومان");

  // buy the plan: 50,000 from the wallet, 150,000 at the gateway
  await page.goto(`/dashboard/stores/${store.id}/billing`);
  await page.getByRole("button", { name: "خرید پلن طلایی" }).click();
  await expect(page.getByTestId("checkout-cash")).toHaveText("پرداخت از درگاه: ۱۵۰٬۰۰۰ تومان");
  expect((await axe(page)).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
  await page.getByRole("button", { name: "رفتن به درگاه پرداخت" }).click();
  await page.waitForURL(/sandbox\.zarinpal\.com\/pg\/StartPay\/S/);
  await expect(page.locator("#amount")).toHaveText("1500000"); // rial
  await page.locator("#pay").click();
  await expect(page.getByTestId("payment-return")).toHaveAttribute("data-outcome", "paid");
  await expect(page.getByTestId("payment-return")).toContainText("اشتراک شما فعال است");
  await page.goto(`/dashboard/stores/${store.id}/billing`);
  await expect(page.getByTestId("subscription-card")).toContainText("طلایی");
  await expect(page.getByTestId("subscription-card")).toContainText("فعال");
  await expect(page.getByTestId("limits-card")).toContainText("از ۱۰۰");
  await expect(page.getByTestId("purchase-row")).toContainText("۱۵۰٬۰۰۰ تومان");
  expect(await page.getByTestId("payment-row").count()).toBe(3); // the cancelled top-up, the top-up, the plan
  await page.goto(`/dashboard/stores/${store.id}/wallet`);
  await expect(page.getByTestId("wallet-balance")).toHaveText("۰ تومان");
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await staffCtx.close();
});
