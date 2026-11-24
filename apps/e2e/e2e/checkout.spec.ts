import { api, apiSignUp, buyOne, createLiveStore, fillCheckout, makeSuperAdmin, placeButton, placeOrder, pngBytes, shopper, storeRequest } from "./commerce";
import { db, expect, test } from "./helpers";

/**
 * M1 (MVP roadmap): the purchase journeys end to end in the browser — shopper on the store's subdomain, merchant in the dashboard — on the
 * production build. Online payment is covered by payments.spec.ts on an isolated test stack (D-E2E-PAY).
 */
test.afterAll(() => db.$disconnect());

const orderOf = (storeId: string) => db.order.findFirstOrThrow({ where: { storeId }, orderBy: { createdAt: "desc" } });
const stockOf = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

test("cash on delivery: shopper orders, merchant confirms, ships and delivers; stock leaves once", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page);
  const { context, page: shop } = await shopper(browser);
  const orderUrl = await buyOne(shop, s, "COD");
  await expect(shop.getByText("سفارش شما ثبت شد")).toBeVisible();
  await expect(shop.getByText("ثبت‌شده").first()).toBeVisible();
  await expect(shop.getByText("۱۵۰٬۰۰۰ تومان").first()).toBeVisible(); // 120,000 + 30,000 shipping
  expect(await stockOf(s.productId)).toBe(9);

  const order = await orderOf(s.storeId);
  expect([order.paymentMethod, order.status, Number(order.total)]).toEqual(["COD", "PLACED", 150_000]);
  await page.goto(`/dashboard/stores/${s.storeId}/orders/${order.id}`);
  for (const [action, label] of [["تأیید سفارش", "تأییدشده"], ["ثبت ارسال", "ارسال‌شده"], ["ثبت تحویل", "تحویل‌شده"]] as const) {
    await page.getByRole("button", { name: action }).click();
    await expect(page.getByText(label).first()).toBeVisible();
  }
  expect((await orderOf(s.storeId)).status).toBe("DELIVERED");

  await shop.goto(orderUrl);
  await expect(shop.getByText("تحویل‌شده").first()).toBeVisible();
  expect(await stockOf(s.productId)).toBe(9); // consumed once, never twice
  await context.close();
});

test("card-to-card: card shown, receipt sent, merchant approves, order placed; another store's host cannot open the order", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { bankCard: true });
  const other = await createLiveStore(page);
  const { context, page: shop } = await shopper(browser);
  const orderUrl = await buyOne(shop, s, "CARD_TRANSFER");
  await expect(shop.getByText("6037-9912-3456-7893")).toBeVisible();
  await expect(shop.getByText("در انتظار پرداخت").first()).toBeVisible();

  await shop.getByLabel("تصویر رسید (عکس یا اسکرین‌شات، حداکثر ۵ مگابایت)").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: pngBytes() });
  await shop.getByLabel("شماره‌ی پیگیری / ارجاع").fill("123456789");
  await shop.getByLabel("۴ رقم آخر کارت پرداخت‌کننده").fill("5995");
  await shop.getByRole("button", { name: "ارسال رسید" }).click();
  await expect(shop.getByText("رسید شما دریافت شد")).toBeVisible();

  // the order link only works on its own store's host
  const token = orderUrl.split("/orders/")[1]!;
  const foreign = await storeRequest(shop, other.label, `/api/shop/checkout/orders/${token}`);
  expect(foreign.status()).toBe(404);

  const order = await orderOf(s.storeId);
  page.on("dialog", (d) => void d.accept());
  await page.goto(`/dashboard/stores/${s.storeId}/orders/${order.id}`);
  await page.getByRole("button", { name: "تأیید واریز و ثبت سفارش" }).click();
  await expect.poll(async () => (await orderOf(s.storeId)).status).toBe("PLACED");

  await shop.goto(orderUrl);
  await expect(shop.getByText("ثبت‌شده").first()).toBeVisible();
  await context.close();
});

test("discount code: an unknown code blocks ordering; a valid code is applied and kept on the order", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page);
  expect((await api(page, "POST", `/stores/${s.storeId}/discounts`, { code: "YALDA10", type: "PERCENT", value: 10 })).status()).toBe(201);
  const { context, page: shop } = await shopper(browser);
  await fillCheckout(shop, s, "COD");

  await shop.getByLabel("کد تخفیف").fill("NOPE99");
  await shop.getByRole("button", { name: "اعمال" }).click();
  await expect(shop.getByText("این کد تخفیف معتبر نیست.")).toBeVisible();

  await shop.getByLabel("کد تخفیف").fill("yalda10");
  await shop.getByRole("button", { name: "اعمال" }).click();
  await expect(shop.getByText("کد YALDA10 اعمال شد.")).toBeVisible();
  await expect(shop.getByText("۱۳۸٬۰۰۰ تومان").first()).toBeVisible(); // 120,000 - 12,000 + 30,000
  await expect(placeButton(shop, "COD")).toBeEnabled();
  await placeOrder(shop, "COD");

  const order = await orderOf(s.storeId);
  expect([order.discountCode, Number(order.discountAmount), Number(order.total)]).toEqual(["YALDA10", 12_000, 138_000]);
  await context.close();
});

test("offline stores: shoppers keep their order pages; a suspended store hides its card numbers", async ({ page, browser }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page, { bankCard: true });
  const { context, page: shop } = await shopper(browser);
  const codUrl = await buyOne(shop, s, "COD");
  const cardUrl = await buyOne(shop, s, "CARD_TRANSFER");

  // the merchant unpublishes: storefront gone, order pages stay, card details still shown (the merchant chose to close)
  expect((await api(page, "POST", `/stores/${s.storeId}/unpublish`)).status()).toBe(204);
  expect((await storeRequest(shop, s.label, "/")).status()).toBe(404);
  await shop.goto(codUrl);
  await expect(shop.getByText("این فروشگاه در حال حاضر سفارش جدید نمی‌پذیرد")).toBeVisible();
  await shop.goto(cardUrl);
  await expect(shop.getByText("6037-9912-3456-7893")).toBeVisible();

  // the platform suspends the store: order pages stay, card numbers and receipt upload disappear, no reason is shown
  const { context: adminCtx, page: admin } = await shopper(browser);
  await makeSuperAdmin(admin);
  const r = await api(admin, "POST", `/v1/platform/stores/${s.storeId}/suspend`, { reason: "FRAUD", publicMessage: "بررسی", internalNote: "e2e-internal-note" });
  expect(r.status()).toBe(204);
  await shop.goto(cardUrl);
  await expect(shop.getByText("این فروشگاه در حال حاضر پرداخت نمی‌پذیرد").first()).toBeVisible();
  await expect(shop.getByText("6037-9912-3456-7893")).toHaveCount(0);
  await expect(shop.getByRole("button", { name: "ارسال رسید" })).toHaveCount(0);
  const html = await shop.content();
  expect(html).not.toContain("e2e-internal-note");
  expect(html).not.toContain("معلق");
  await shop.goto(codUrl);
  await expect(shop.getByText("سفارش شماره")).toBeVisible();
  await context.close();
  await adminCtx.close();
});
