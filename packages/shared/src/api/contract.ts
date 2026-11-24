import { z } from "zod";
import type { Permission } from "../modules/access/permissions.js";
import { inviteSchema, roleSchema } from "../modules/access/schemas.js";
import { changePasswordSchema, loginSchema, registerSchema } from "../modules/auth/schemas.js";
import { createCategorySchema, deleteCategoryOptionsSchema, updateCategorySchema } from "../modules/categories/schemas.js";
import { createProductSchema, statusSchema, updateProductSchema } from "../modules/products/schemas.js";
import { secretValueSchema } from "../modules/secrets/schemas.js";
import { replaceVariantsSchema } from "../modules/inventory/variants.js";
import { addressInputSchema, cartLineInputSchema, checkoutQuoteSchema, replaceShippingMethodsSchema } from "../modules/checkout/checkout.js";
import { customerLoginSchema, customerRegisterSchema } from "../modules/customers/schemas.js";
import { orderListQuerySchema, orderTransitionSchema, placeOrderSchema, verifyPaymentSchema } from "../modules/orders/orders.js";
import { storeSmsSettingsSchema } from "../modules/notifications/order-sms.js";
import { discountInputSchema } from "../modules/discounts/discounts.js";
import { replaceBankCardsSchema, reviewReceiptSchema } from "../modules/orders/card-transfer.js";
import { RATE_CODES, priceLinkInputSchema } from "../modules/pricing/pricing.js";
import { createStoreSchema, switchThemeSchema, updateBusinessCategorySchema, updateStoreSchema } from "../modules/stores/schemas.js";
import * as S from "./schemas.js";

/**
 * The API contract (phase 2.5, D25-1): every route the API serves, described once. The OpenAPI document is generated from this list
 * (`pnpm --filter @store-builder/api openapi`), and an API test compares it with the routes Nest really registers (method, path,
 * permission, status), so a route cannot exist without being documented, or be documented with the wrong permission.
 * `path` is the HANDLER path; the v1 path is derived from it (`api/routing.ts`). Bodies reuse the validators the API runs wherever a
 * whole-body schema exists; bodies the services parse field by field are described by `doc`-marked schemas.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export interface RouteSpec {
  method: HttpMethod;
  path: string;
  summary: string;
  /** "session" = a signed-in user (cookie); "public" = anyone. */
  auth: "session" | "public";
  /** Store permission required (store routes); the access guard returns 404 to non-members and 403 to members without it. */
  permission?: Permission;
  /** Platform operators only (SUPER_ADMIN, checked in the database on every request). */
  platform?: true;
  status: number;
  body?: z.ZodType | "image";
  /** true when the body schema documents fields the service validates one by one (not the very object the API runs). */
  bodyDoc?: true;
  query?: z.ZodType;
  /** Success body; absent = no body (204) or (see `untyped`) not yet described. */
  response?: z.ZodType;
  /** Response not described yet. The list is pinned by a test: it may only shrink. */
  untyped?: true;
}

const rev = z.number().int().min(1).describe("the page revision the edit was based on (optimistic concurrency)");
const doc = (shape: z.ZodRawShape) => z.object(shape);
const id = z.object({ id: z.string() });
const raw = "image" as const;

const r = (method: HttpMethod, path: string, summary: string, o: Omit<RouteSpec, "method" | "path" | "summary" | "auth" | "status"> & { auth?: RouteSpec["auth"]; status?: number } = {}): RouteSpec => ({
  method,
  path,
  summary,
  auth: o.auth ?? "session",
  status: o.status ?? (method === "POST" ? 201 : 200),
  ...o,
});
const st = (rest: string) => `/api/stores/:storeId${rest}`;

export const ROUTES: readonly RouteSpec[] = [
  // ---- operations (unversioned)
  r("GET", "/api/health", "Liveness", { auth: "public", response: z.object({ status: z.literal("ok") }) }),
  r("GET", "/api/ready", "Readiness (database, storage)", { auth: "public", untyped: true }),

  // ---- auth
  r("POST", "/api/auth/register", "Create an account", { auth: "public", status: 201, body: registerSchema, response: z.object({ ok: z.literal(true) }) }),
  r("POST", "/api/auth/login", "Sign in (sets the session cookie)", { auth: "public", status: 200, body: loginSchema, response: z.object({ user: S.sessionUserDto }) }),
  r("POST", "/api/auth/logout", "Sign out of this session", { status: 204 }),
  r("POST", "/api/auth/logout-all", "Sign out of every session", { status: 204 }),
  r("GET", "/api/auth/me", "The signed-in user", { response: z.object({ user: S.sessionUserDto }) }),
  r("POST", "/api/auth/change-password", "Change the password (other sessions end)", { status: 204, body: changePasswordSchema }),

  // ---- me
  r("GET", "/api/me/invitations", "My pending staff invitations", { response: z.array(S.myInvitationDto) }),
  r("POST", "/api/me/invitations/:invitationId/accept", "Accept an invitation", { status: 200, response: z.object({ storeId: z.string() }) }),
  r("POST", "/api/me/invitations/:invitationId/decline", "Decline an invitation", { status: 204 }),
  r("POST", "/api/me/memberships/:membershipStoreId/leave", "Leave a store I work for", { status: 204 }),
  r("GET", "/api/me/shared-stores", "Stores I work for as staff", { response: z.array(S.sharedStoreDto) }),

  // ---- storefront (shoppers)
  r("GET", "/api/public/stores/:label", "A published store by its subdomain label", { auth: "public", response: S.publicStoreDto }),
  r("GET", "/api/public/stores/:label/product-redirect", "Where an old product slug moved to", { auth: "public", query: z.object({ slug: z.string().min(1).max(200) }), response: z.object({ to: z.string() }) }),

  // ---- admin: stores
  r("GET", "/api/stores", "My stores", { response: z.array(S.storeDto) }),
  r("POST", "/api/stores", "Create a store", { status: 201, body: createStoreSchema, response: id }),
  r("GET", "/api/stores/templates", "Themes offered for a new store", { response: z.array(S.templateOptionDto) }),
  r("GET", "/api/stores/onboarding", "Setup progress of my stores", { response: z.array(S.onboardingFactDto) }),
  r("GET", st(""), "A store", { permission: "store.view", response: S.storeDto }),
  r("PATCH", st(""), "Update store settings", { permission: "store.settings", body: updateStoreSchema, response: S.storeDto }),
  r("PATCH", st("/business-category"), "Change the business category", { permission: "store.settings", body: updateBusinessCategorySchema, response: z.object({ businessCategory: z.string(), changed: z.boolean() }) }),
  r("POST", st("/delete"), "Delete the store (owner)", { permission: "store.delete", status: 204, body: doc({ confirmName: z.string().describe("the store's name, typed again") }), bodyDoc: true }),
  r("GET", st("/themes"), "Themes the store can switch to", { permission: "store.view", untyped: true }),
  r("GET", st("/themes/:key/report"), "What a theme switch would change", { permission: "store.view", untyped: true }),
  r("POST", st("/themes/switch"), "Switch the theme", { permission: "theme.switch", status: 200, body: switchThemeSchema, untyped: true }),
  r("GET", st("/preview"), "Draft storefront data for the preview", { permission: "store.view", query: z.object({ theme: z.string().max(40).optional().describe("candidate theme key") }), response: S.draftPreviewDto }),
  r("POST", st("/logo"), "Upload the logo (raw image bytes)", { permission: "store.settings", status: 200, body: raw, untyped: true }),
  r("POST", st("/logo/delete"), "Remove the logo", { permission: "store.settings", status: 204 }),

  // ---- admin: catalog
  r("GET", st("/categories"), "Categories", { permission: "store.view", response: z.array(S.categoryDto) }),
  r("POST", st("/categories"), "Create a category", { permission: "catalog.write", status: 201, body: createCategorySchema, response: id }),
  r("PATCH", st("/categories/:categoryId"), "Rename a category", { permission: "catalog.write", body: updateCategorySchema }),
  r("POST", st("/categories/:categoryId/delete"), "Delete a category", { permission: "catalog.write", status: 200, body: deleteCategoryOptionsSchema, untyped: true }),
  r("GET", st("/products"), "Products (v1: keyset pages)", {
    permission: "store.view",
    query: z.object({
      q: z.string().max(100).optional(),
      category: z.string().max(64).optional(),
      status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(200).optional().describe("nextCursor of the previous page"),
    }),
    response: S.productCursorListDto,
  }),
  r("POST", st("/products"), "Create a product (as draft)", { permission: "catalog.write", status: 201, body: createProductSchema, response: S.productDto }),
  r("GET", st("/products/:productId"), "A product", { permission: "store.view", response: S.productDto }),
  r("PATCH", st("/products/:productId"), "Update a product", { permission: "catalog.write", body: updateProductSchema, response: S.productDto }),
  r("POST", st("/products/:productId/status"), "Change a product's status", { permission: "catalog.write", status: 200, body: doc({ status: statusSchema }), bodyDoc: true, response: S.productDto }),
  r("POST", st("/products/:productId/delete"), "Delete a product", { permission: "catalog.write", status: 204 }),
  r("POST", st("/products/:productId/image"), "Upload the product image (raw image bytes)", { permission: "media.write", status: 200, body: raw, untyped: true }),
  r("POST", st("/products/:productId/image/delete"), "Remove the product image", { permission: "media.write", status: 204 }),
  r("GET", st("/products/:productId/variants"), "Variants of a product", { permission: "store.view", response: z.array(S.variantDto) }),
  // ---- phase 3.2b: prices linked to the dollar or gold
  r("GET", st("/rates"), "Current dollar and 18k gold rates (toman)", { permission: "store.view", response: S.currentRatesDto }),
  r("GET", st("/products/:productId/price-links"), "Price links of a product and its variants", { permission: "store.view", response: z.array(S.priceLinkDto) }),
  r("PUT", st("/products/:productId/price-link"), "Link the price of a product (or one variant) to the dollar or gold (changes the live price: needs publish)", { permission: "publish", body: doc({ variantId: z.string().nullable().optional().describe("the variant, for a product with variants"), link: priceLinkInputSchema }), bodyDoc: true, response: S.priceLinkDto }),
  r("POST", st("/products/:productId/price-link/delete"), "Remove a price link (the price stays at its last value)", { permission: "publish", status: 204, body: doc({ variantId: z.string().nullable().optional() }), bodyDoc: true }),
  r("PUT", st("/products/:productId/variants"), "Replace the variant set (price and stock of the product follow it)", { permission: "catalog.write", body: replaceVariantsSchema, response: z.array(S.variantDto) }),

  // ---- admin: pages
  r("GET", st("/pages"), "Pages", { permission: "store.view", response: z.object({ supported: z.boolean(), pages: z.array(S.pageSummaryDto) }) }),
  r("GET", st("/pages/:pageType"), "The editor view of a page", { permission: "store.view", response: S.pageEditorViewDto }),
  r("POST", st("/pages/:pageType/sections"), "Add a section", { permission: "pages.write", status: 200, body: doc({ type: z.string().max(80), expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("PATCH", st("/pages/:pageType/sections/:sectionId"), "Edit a section's props", { permission: "pages.write", body: doc({ props: z.record(z.string(), z.unknown()), expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/sections/:sectionId/delete"), "Remove a section", { permission: "pages.write", status: 200, body: doc({ expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/sections/:sectionId/delete-dormant"), "Remove a dormant section", { permission: "pages.write", status: 200, body: doc({ expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/sections/:sectionId/move"), "Move a section", { permission: "pages.write", status: 200, body: doc({ direction: z.enum(["up", "down"]), expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/sections/:sectionId/image"), "Upload a section image (raw image bytes)", { permission: "pages.write", status: 200, body: raw, query: z.object({ expectedRevision: rev }), untyped: true }),
  r("POST", st("/pages/:pageType/sections/:sectionId/image/delete"), "Remove a section image", { permission: "pages.write", status: 200, body: doc({ expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/visibility"), "Show or hide a page", { permission: "pages.write", status: 200, body: doc({ visible: z.boolean(), expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),
  r("POST", st("/pages/:pageType/recover"), "Reset a broken page to the theme's default", { permission: "pages.write", status: 200, body: doc({ expectedRevision: rev }), bodyDoc: true, response: S.editResultDto }),

  // ---- admin: publishing
  r("GET", st("/publish"), "Publish state", { permission: "store.view", response: S.publishStateDto }),
  r("POST", st("/publish"), "Publish the draft", { permission: "publish", status: 200, body: doc({ expectedDraftRevision: z.number().int().min(1) }), bodyDoc: true, response: S.publishResultDto }),
  r("POST", st("/unpublish"), "Take the store offline", { permission: "publish", status: 204 }),
  r("GET", st("/versions"), "Published versions", { permission: "store.view", response: z.array(S.versionDto) }),
  r("POST", st("/versions/live"), "Roll back or re-publish a version", { permission: "publish", status: 200, body: doc({ versionNumber: z.number().int().min(1), mode: z.enum(["rollback", "republish"]).optional() }), bodyDoc: true, response: z.object({ number: z.number() }) }),
  r("GET", st("/subdomain"), "Subdomain state", { permission: "store.view", response: S.subdomainStateDto }),
  r("POST", st("/subdomain"), "Claim or change the subdomain", { permission: "domain.manage", status: 200, body: doc({ label: z.string().max(63), confirmChange: z.boolean().optional() }), bodyDoc: true, response: z.object({ label: z.string(), changed: z.boolean() }) }),

  // ---- admin: staff and audit (2.3), secrets (2.4)
  r("GET", st("/team"), "Members and pending invitations", { permission: "members.manage", response: S.teamDto }),
  r("POST", st("/team/invitations"), "Invite an existing account", { permission: "members.manage", status: 201, body: inviteSchema, response: id }),
  r("POST", st("/team/invitations/:invitationId/cancel"), "Cancel an invitation", { permission: "members.manage", status: 204 }),
  r("PATCH", st("/team/members/:userId"), "Change a member's role", { permission: "members.manage", status: 204, body: roleSchema }),
  r("POST", st("/team/members/:userId/remove"), "Remove a member", { permission: "members.manage", status: 204 }),
  r("GET", st("/audit"), "Audit log, newest first", { permission: "audit.view", query: z.object({ before: z.string().optional().describe("createdAt of the last row seen"), limit: z.number().int().min(1).max(100).optional() }), response: z.array(S.auditEventDto) }),
  r("GET", st("/secrets"), "Secret names and masked hints (never values)", { permission: "secrets.manage", response: S.secretListDto }),
  r("PUT", st("/secrets/:name"), "Set a secret (write-only)", { permission: "secrets.manage", status: 204, body: secretValueSchema }),
  r("POST", st("/secrets/:name/delete"), "Delete a secret", { permission: "secrets.manage", status: 204 }),

  // ---- phase 3.1: customers (shoppers sign in on the store's own host; SMS sign-in is off until configured)
  r("GET", "/api/public/stores/:label/customer/status", "Whether SMS sign-in is available", { auth: "public", response: z.object({ otpEnabled: z.boolean() }) }),
  r("POST", "/api/public/stores/:label/customer/otp/request", "Send a sign-in code by SMS (503 while SMS sign-in is off)", { auth: "public", status: 200, body: doc({ phone: z.string().max(40).describe("Iranian mobile, e.g. 09123456789") }), bodyDoc: true, response: S.otpRequestedDto }),
  r("POST", "/api/public/stores/:label/customer/otp/verify", "Sign in with the code (sets the customer cookie)", { auth: "public", status: 200, body: doc({ phone: z.string().max(40), code: z.string().max(20) }), bodyDoc: true, response: z.object({ customer: S.customerProfileDto }) }),
  r("POST", "/api/public/stores/:label/customer/register", "Create a password account (phase 3.3b; the phone is not verified by this)", { auth: "public", status: 200, body: customerRegisterSchema, response: z.object({ customer: S.customerProfileDto }) }),
  r("POST", "/api/public/stores/:label/customer/login", "Sign in with phone and password (sets the customer cookie)", { auth: "public", status: 200, body: customerLoginSchema, response: z.object({ customer: S.customerProfileDto }) }),
  r("GET", "/api/public/stores/:label/customer/me", "The signed-in customer of this store (customer cookie)", { auth: "public", response: z.object({ customer: S.customerProfileDto }) }),
  r("POST", "/api/public/stores/:label/customer/logout", "Sign out on this device", { auth: "public", status: 204 }),
  r("POST", "/api/public/stores/:label/customer/logout-all", "Sign out on every device", { auth: "public", status: 204 }),
  // ---- phase 3.3: cart, saved addresses, checkout summary (shopper side, on the store's own host) and shipping methods (merchant)
  r("GET", "/api/public/stores/:label/cart", "The shopper's cart with current prices and stock problems (cart cookie; a signed-in customer's guest cart is folded in)", { auth: "public", response: S.cartViewDto }),
  r("POST", "/api/public/stores/:label/cart/items", "Add to a cart line (creates the cart and its cookie on the first add; rate limited per network)", { auth: "public", status: 200, body: cartLineInputSchema, response: S.cartViewDto }),
  r("PUT", "/api/public/stores/:label/cart/items", "Set a cart line's quantity (0 removes it)", { auth: "public", body: cartLineInputSchema, response: S.cartViewDto }),
  r("DELETE", "/api/public/stores/:label/cart", "Empty the cart", { auth: "public", status: 204 }),
  r("POST", "/api/public/stores/:label/checkout/quote", "Checkout summary for an address (typed or saved) and a shipping choice; read-only", { auth: "public", status: 200, body: checkoutQuoteSchema, response: S.checkoutSummaryDto }),
  r("GET", "/api/public/stores/:label/customer/addresses", "The signed-in customer's saved addresses (customer cookie; 401 without)", { auth: "public", response: z.array(S.savedAddressDto) }),
  r("POST", "/api/public/stores/:label/customer/addresses", "Save an address (at most 10)", { auth: "public", body: addressInputSchema, response: S.savedAddressDto }),
  r("PUT", "/api/public/stores/:label/customer/addresses/:addressId", "Change a saved address", { auth: "public", body: addressInputSchema, response: S.savedAddressDto }),
  r("DELETE", "/api/public/stores/:label/customer/addresses/:addressId", "Delete a saved address", { auth: "public", status: 204 }),
  r("GET", st("/shipping-methods"), "The store's shipping methods", { permission: "store.view", response: z.array(S.shippingMethodDto) }),
  r("PUT", st("/shipping-methods"), "Replace the shipping methods (applies to checkout at once, no publish)", { permission: "store.settings", body: replaceShippingMethodsSchema, response: z.array(S.shippingMethodDto) }),
  // ---- phase 3.4: orders (shoppers place and follow them on the store's own host; merchants manage them)
  r("POST", "/api/public/stores/:label/checkout/orders", "Place the order from the cart (cash on delivery, or online: the order then awaits its payment; the same requestKey returns the same order)", { auth: "public", body: placeOrderSchema, response: S.placedOrderDto }),
  r("GET", "/api/public/stores/:label/checkout/orders/:token", "Follow an order with its access token (guests)", { auth: "public", response: S.shopperOrderDto }),
  r("POST", "/api/public/stores/:label/checkout/orders/:token/cancel", "Cancel an order with its access token, until the store confirms it", { auth: "public", status: 200, response: S.shopperOrderDto }),
  r("POST", "/api/public/stores/:label/checkout/orders/:token/pay", "Open a Zarinpal payment for an unpaid online order (phase 3.5); answers where to send the buyer", { auth: "public", status: 200, response: S.paymentStartDto }),
  r("GET", "/api/public/stores/:label/checkout/payment-methods", "Which payment methods the store takes now (phase 3.5)", { auth: "public", response: z.object({ cod: z.boolean(), online: z.boolean(), gateways: z.array(z.enum(["ZARINPAL", "AQAYEPARDAKHT"])), cardTransfer: z.boolean() }) }),
  r("POST", "/api/public/stores/:label/checkout/orders/:token/receipt", "Send a card-to-card receipt (D35b-1): image as application/octet-stream; headers x-receipt-tracking-code and x-receipt-payer-last4 (percent-encoded)", { auth: "public", status: 204 }),
  r("POST", "/api/public/stores/:label/checkout/payments/verify", "The buyer is back from a gateway (Zarinpal: Authority/Status; Aghaye Pardakht: transid/status): verified server-side", { auth: "public", status: 200, body: verifyPaymentSchema, response: S.paymentReturnDto }),
  r("GET", "/api/public/stores/:label/customer/orders", "The signed-in customer's orders in this store, newest first (customer cookie; 401 without)", { auth: "public", response: z.array(S.shopperOrderDto) }),
  r("GET", "/api/public/stores/:label/customer/orders/:orderId", "One of the signed-in customer's orders", { auth: "public", response: S.shopperOrderDto }),
  r("POST", "/api/public/stores/:label/customer/orders/:orderId/cancel", "Cancel one of the signed-in customer's orders, until the store confirms it", { auth: "public", status: 200, response: S.shopperOrderDto }),
  r("POST", "/api/public/stores/:label/customer/orders/:orderId/pay", "Open a Zarinpal payment for one of the signed-in customer's unpaid online orders (phase 3.5)", { auth: "public", status: 200, response: S.paymentStartDto }),
  r("POST", "/api/public/stores/:label/customer/orders/:orderId/receipt", "Send a card-to-card receipt for one of the signed-in customer's orders (D35b-1; same body and headers)", { auth: "public", status: 204 }),
  r("GET", st("/orders"), "The store's orders, newest first (keyset: pass nextCursor as before)", { permission: "orders.view", query: orderListQuerySchema, response: S.orderListDto }),
  r("GET", st("/orders/customer-stats"), "Order count, spending (not cancelled) and last order per customer (phase 3.3b; ids=comma list, at most 100)", { permission: "customers.view", query: z.object({ ids: z.string().max(6600).optional() }), response: z.array(z.object({ customerId: z.string(), orders: z.number(), spent: z.number(), lastOrderAt: z.string().nullable() })) }),
  r("GET", st("/orders/:orderId"), "One order with its items and history", { permission: "orders.view", response: S.orderDto }),
  r("GET", st("/orders/:orderId/receipts"), "The order's card-to-card receipts (D35b-1; images separately)", { permission: "orders.view", response: z.array(S.receiptDto) }),
  r("GET", st("/orders/:orderId/receipts/:receiptId/image"), "One receipt image (image/webp, never cached)", { permission: "orders.view" }),
  r("POST", st("/orders/:orderId/receipts/:receiptId/review"), "Approve (the order is placed) or reject a card-to-card receipt", { permission: "orders.manage", status: 200, body: reviewReceiptSchema, response: z.object({ result: z.enum(["approved", "rejected"]), order: S.orderDto }) }),
  r("GET", st("/discounts"), "The store's discount codes with their use counts (phase 5.1)", { permission: "discounts.manage", response: z.array(S.discountDto) }),
  r("POST", st("/discounts"), "Create a discount code (applies at once)", { permission: "discounts.manage", status: 201, body: discountInputSchema, response: S.discountDto }),
  r("PUT", st("/discounts/:discountId"), "Change a discount code", { permission: "discounts.manage", body: discountInputSchema, response: S.discountDto }),
  r("POST", st("/discounts/:discountId/delete"), "Delete a discount code (orders keep their snapshot)", { permission: "discounts.manage", status: 204 }),
  r("GET", st("/sms-settings"), "Order SMS of the store (phase 3.6): on/off, the merchant's mobile, this month's usage and the cap", { permission: "store.settings", response: S.storeSmsSettingsViewDto }),
  r("PUT", st("/sms-settings"), "Turn order SMS on or off and set the merchant's mobile", { permission: "store.settings", body: storeSmsSettingsSchema, response: S.storeSmsSettingsViewDto }),
  r("GET", st("/bank-cards"), "The store's bank cards for card-to-card payment (D35b-1)", { permission: "store.view", response: z.array(S.bankCardDto) }),
  r("PUT", st("/bank-cards"), "Replace the store's bank cards (at most 5)", { permission: "store.settings", body: replaceBankCardsSchema, response: z.array(S.bankCardDto) }),
  r("GET", st("/payment-settings"), "Online payment state (phase 3.5): platform switch, sandbox, whether the merchant id is set, the return address", { permission: "secrets.manage", response: S.paymentSettingsViewDto }),
  r("GET", st("/orders/:orderId/payments"), "The order's online payment attempts (phase 3.5): status, reference number, masked card", { permission: "orders.view", response: z.array(S.paymentAttemptDto) }),
  r("POST", st("/orders/:orderId/status"), "Confirm, ship, deliver or cancel an order (cancelling gives the stock back)", { permission: "orders.manage", status: 200, body: orderTransitionSchema, response: S.orderDto }),
  r("GET", st("/customers"), "The store's customers, newest first", { permission: "customers.view", query: z.object({ before: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), response: z.array(S.customerListItemDto) }),

  // ---- phase 3.1: platform operators (super admins; the role is checked in the database on every request)
  r("GET", "/api/platform/me", "The signed-in operator", { platform: true, response: z.object({ userId: z.string(), username: z.string(), role: z.enum(["SUPER_ADMIN"]) }) }),
  r("GET", "/api/platform/overview", "Platform counts", { platform: true, response: S.platformOverviewDto }),
  r("GET", "/api/platform/stores", "Every store, newest first", { platform: true, query: z.object({ before: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }), response: z.array(S.platformStoreDto) }),
  r("GET", "/api/platform/admins", "Super admins", { platform: true, response: z.array(S.platformAdminDto) }),
  r("POST", "/api/platform/admins", "Make an existing account a super admin", { platform: true, status: 201, body: doc({ username: z.string().max(64) }), bodyDoc: true, response: z.object({ userId: z.string() }) }),
  r("POST", "/api/platform/admins/:userId/revoke", "Revoke a super admin (never oneself or the last one)", { platform: true, status: 204 }),
  r("GET", "/api/platform/settings", "SMS, payment and AI settings, and which platform secrets are set (never their values)", { platform: true, response: S.platformSettingsViewDto }),
  r("PATCH", "/api/platform/settings/:group", "Update one settings group (sms, payment, ai, rates)", { platform: true, body: doc({ "...": z.unknown().describe("the group's fields (smsSettingsSchema, paymentSettingsSchema, aiSettingsSchema, ratesSettingsSchema)") }), bodyDoc: true, response: S.platformSettingsDto }),
  r("POST", "/api/platform/secrets/:name", "Set a platform secret (write-only; allowlisted names)", { platform: true, status: 204, body: secretValueSchema }),
  r("POST", "/api/platform/secrets/:name/delete", "Delete a platform secret", { platform: true, status: 204 }),

  // ---- phase 3.2b: rates (super admins)
  r("GET", "/api/platform/rates", "Current rates, rates waiting for confirmation, recent history", { platform: true, response: S.platformRatesDto }),
  r("POST", "/api/platform/rates", "Enter a rate by hand (applied at once; linked prices follow)", { platform: true, status: 201, body: doc({ code: z.enum(RATE_CODES), rateToman: z.number().int() }), bodyDoc: true, response: S.rateRowDto }),
  r("POST", "/api/platform/rates/:rateId/confirm", "Apply a held rate", { platform: true, status: 204 }),
  r("POST", "/api/platform/rates/:rateId/reject", "Reject a held rate", { platform: true, status: 204 }),
];

