import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { domainErrorMessage } from "@store-builder/shared/errors/registry";
import { send } from "./http";
import type { z } from "zod";
import type { cartViewDto, checkoutSummaryDto, placedOrderDto, shopperOrderDto } from "@store-builder/shared/api/schemas";

/**
 * The storefront's door to its own store's shopper routes (phases 3.3/3.4): same-origin `/api/shop/*` on the STORE host, which the web
 * proxy forwards to the API for the store named by the host. The cart and customer cookies are host-only cookies of this store.
 */
export type CartView = z.infer<typeof cartViewDto>;
export type CheckoutSummary = z.infer<typeof checkoutSummaryDto>;
export type PlacedOrder = z.infer<typeof placedOrderDto>;
export type ShopperOrder = z.infer<typeof shopperOrderDto>;

export const getCart = () => send<CartView>("GET", "/api/shop/cart");
export const addToCart = (productId: string, variantId: string | null, quantity: number) => send<CartView>("POST", "/api/shop/cart/items", { body: { productId, variantId, quantity } });
export const setCartLine = (productId: string, variantId: string | null, quantity: number) => send<CartView>("PUT", "/api/shop/cart/items", { body: { productId, variantId, quantity } });
export const quote = (body: unknown) => send<CheckoutSummary>("POST", "/api/shop/checkout/quote", { body });
export const placeOrder = (body: unknown) => send<PlacedOrder>("POST", "/api/shop/checkout/orders", { body });
export const getOrder = (token: string) => send<ShopperOrder>("GET", `/api/shop/checkout/orders/${encodeURIComponent(token)}`);
// Phase 3.5: online payment (Zarinpal). The answer's url is the gateway page; the return page sends back only Authority and Status.
export const paymentMethods = () => send<{ cod: boolean; online: boolean; gateways: ("ZARINPAL" | "AQAYEPARDAKHT")[]; cardTransfer: boolean }>("GET", "/api/shop/checkout/payment-methods");
// D35b-1: a card-to-card receipt: the image as the raw body; the tracking number and the payer card's last 4 digits in headers (never in
// the URL, which proxies log), percent-encoded so Persian digits survive.
type ReceiptFields = { trackingCode: string; payerCardLast4: string };
const receiptHeaders = (f: ReceiptFields) => ({ "x-receipt-tracking-code": encodeURIComponent(f.trackingCode), "x-receipt-payer-last4": encodeURIComponent(f.payerCardLast4) });
export const sendReceipt = (token: string, image: Blob, f: ReceiptFields) =>
  send("POST", `/api/shop/checkout/orders/${encodeURIComponent(token)}/receipt`, { raw: image, headers: receiptHeaders(f) });
export const sendMyReceipt = (id: string, image: Blob, f: ReceiptFields) =>
  send("POST", `/api/shop/customer/orders/${encodeURIComponent(id)}/receipt`, { raw: image, headers: receiptHeaders(f) });
export const payOrder = (token: string) => send<{ url: string }>("POST", `/api/shop/checkout/orders/${encodeURIComponent(token)}/pay`);
export const payMyOrder = (id: string) => send<{ url: string }>("POST", `/api/shop/customer/orders/${encodeURIComponent(id)}/pay`);
export const verifyPayment = (gateway: "ZARINPAL" | "AQAYEPARDAKHT", authority: string, status: string) =>
  send<{ outcome: "paid" | "pending" | "failed" | "closed" | "refund"; accessToken: string | null }>("POST", "/api/shop/checkout/payments/verify", { body: { gateway, authority, status } });
/** The gateways' payment pages: Zarinpal (live, sandbox) and Aghaye Pardakht; in development also a loopback fake gateway. */
const GATEWAY_PAGES: ReadonlyArray<{ host: string; path: string }> = [
  { host: "payment.zarinpal.com", path: "/pg/StartPay/" },
  { host: "sandbox.zarinpal.com", path: "/pg/StartPay/" },
  { host: "panel.aqayepardakht.ir", path: "/startpay/" },
];
/**
 * Sends the browser to a gateway's payment page, and only to one. The navigation carries the store's ORIGIN as referrer (never the page
 * path: order pages hold their secret link in the URL): Aghaye Pardakht refuses a payment page opened without the registered domain as
 * Referer (error -16). A link's referrerpolicy attribute overrides the page's own no-referrer policy.
 */
export function goToGateway(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const known = u.protocol === "https:" && GATEWAY_PAGES.some((g) => u.host === g.host && u.pathname.startsWith(g.path));
  const dev = process.env.NODE_ENV !== "production" && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && /^\/(pg\/StartPay|startpay)\//.test(u.pathname);
  if (!known && !dev) return false;
  const a = document.createElement("a");
  a.href = u.toString();
  a.referrerPolicy = "origin";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
export const cancelOrder = (token: string) => send<ShopperOrder>("POST", `/api/shop/checkout/orders/${encodeURIComponent(token)}/cancel`);

/** A Persian sentence for any failure of a shop call (domain errors carry their own Persian message). */
export function problemText(e: unknown): string {
  if (e instanceof ValidationError) return Object.values(e.fieldErrors).flat()[0] ?? "اطلاعات واردشده را بررسی کنید.";
  const known = e instanceof Error ? domainErrorMessage(e.name) : null;
  if (known) return known;
  if (e instanceof Error && /[\u0600-\u06FF]/.test(e.message)) return e.message;
  return "ارتباط با فروشگاه برقرار نشد؛ دوباره تلاش کنید.";
}

// ---- phase 3.3b: the shopper's account in this store (password or SMS code), their orders and saved addresses
export type CustomerProfile = { id: string; phone: string; name: string | null; phoneVerified: boolean };
export type SavedAddress = { id: string; recipientName: string; phone: string; province: string; city: string; line: string; postalCode: string };
export const customerStatus = () => send<{ otpEnabled: boolean }>("GET", "/api/shop/customer/status");
/** null when nobody is signed in to this store on this device. */
export async function me(): Promise<CustomerProfile | null> {
  try {
    return (await send<{ customer: CustomerProfile }>("GET", "/api/shop/customer/me")).customer;
  } catch {
    return null;
  }
}
export const login = (phone: string, password: string) => send<{ customer: CustomerProfile }>("POST", "/api/shop/customer/login", { body: { phone, password } });
export const register = (body: { phone: string; name: string; password: string }) => send<{ customer: CustomerProfile }>("POST", "/api/shop/customer/register", { body });
export const requestCode = (phone: string) => send<{ resendAfterSeconds: number; expiresInSeconds: number }>("POST", "/api/shop/customer/otp/request", { body: { phone } });
export const verifyCode = (phone: string, code: string) => send<{ customer: CustomerProfile }>("POST", "/api/shop/customer/otp/verify", { body: { phone, code } });
export const logout = () => send("POST", "/api/shop/customer/logout");
export const myOrders = () => send<ShopperOrder[]>("GET", "/api/shop/customer/orders");
export const myOrder = (id: string) => send<ShopperOrder>("GET", `/api/shop/customer/orders/${encodeURIComponent(id)}`);
export const cancelMyOrder = (id: string) => send<ShopperOrder>("POST", `/api/shop/customer/orders/${encodeURIComponent(id)}/cancel`);
export const myAddresses = () => send<SavedAddress[]>("GET", "/api/shop/customer/addresses");
export const saveAddress = (body: unknown) => send<SavedAddress>("POST", "/api/shop/customer/addresses", { body });
export const deleteAddress = (id: string) => send("DELETE", `/api/shop/customer/addresses/${encodeURIComponent(id)}`);

/** A same-site path to return to after signing in (never another host). */
export const safeNext = (raw: string | null): string => (raw && /^\/(?!\/)[\w\-/%.?=&]*$/.test(raw) ? raw : "/account");

// ---- product reviews (the customer writes, the merchant approves; only approved ones are listed)
export type ShopReview = { id: string; authorName: string; rating: number; body: string; reply: string | null; createdAt: string };
export type ShopReviews = { summary: { count: number; average: number | null }; reviews: ShopReview[] };
export const productReviews = (slug: string) => send<ShopReviews>("GET", "/api/shop/reviews", { query: { product: slug } });
export const submitReview = (productSlug: string, rating: number, body: string) => send("POST", "/api/shop/reviews", { body: { productSlug, rating, body } });
