import type { ProductDto } from "@store-builder/shared/dto/index";
import type { EditResultDto, PageEditorViewDto, PublishResultDto } from "@store-builder/shared/dto/index";
import type { ThemeRef } from "@store-builder/shared/modules/stores/theme-switch-types";
import { enc, send } from "./http";
import type { z } from "zod";
import type { variantDto, priceLinkDto, currentRatesDto, teamDto, auditEventDto, myInvitationDto, sharedStoreDto, storeAnalyticsDto, storeSetupDto, storeOverviewDto, merchantBankCardsDto, bankCardDto, discountDto, storeSmsSettingsViewDto, orderDto, orderListDto, paymentAttemptDto, paymentSettingsViewDto, receiptDto, shippingMethodDto } from "@store-builder/shared/api/schemas";
import { GATEWAY_SECRETS, type Gateway } from "@store-builder/shared/modules/orders/orders";

/** Every write the dashboard can make, as browser calls (reads are rendered by the server components through `@/gateway`). */
const store = (id: string) => `/api/stores/${enc(id)}`;
const page = (id: string, type: string) => `${store(id)}/pages/${enc(type)}`;

// auth
export const register = (body: unknown) => send("POST", "/api/auth/register", { body });
export const login = (body: unknown) => send<{ user: { id: string } }>("POST", "/api/auth/login", { body });
export const logout = () => send("POST", "/api/auth/logout");
export const changePassword = (body: unknown) => send("POST", "/api/auth/change-password", { body });
/** MVP item 2: a new password through a recovery link from platform support. */
export const recoverAccount = (token: string, newPassword: string) => send("POST", "/api/auth/recover", { body: { token, newPassword } });
export const logoutAll = () => send("POST", "/api/auth/logout-all");

// stores
export const createStore = (input: unknown) => send<{ id: string }>("POST", "/api/stores", { body: input });
export const updateStore = (storeId: string, input: unknown) => send("PATCH", store(storeId), { body: input });
export const updateBusinessCategory = (storeId: string, input: unknown) => send<{ businessCategory: string; changed: boolean }>("PATCH", `${store(storeId)}/business-category`, { body: input });
export const deleteStore = (storeId: string, confirmName: string) => send("POST", `${store(storeId)}/delete`, { body: { confirmName } });
export const switchTheme = (storeId: string, input: unknown) => send<{ changed: boolean; theme: ThemeRef }>("POST", `${store(storeId)}/themes/switch`, { body: input });

// catalog
export const createCategory = (storeId: string, input: unknown) => send<{ id: string }>("POST", `${store(storeId)}/categories`, { body: input });
export const updateCategory = (storeId: string, id: string, input: unknown) => send("PATCH", `${store(storeId)}/categories/${enc(id)}`, { body: input });
export const deleteCategory = (storeId: string, id: string, options: { moveProducts: boolean }) => send<{ movedProducts: number }>("POST", `${store(storeId)}/categories/${enc(id)}/delete`, { body: options });
export const createProduct = (storeId: string, input: unknown) => send<ProductDto>("POST", `${store(storeId)}/products`, { body: input });
export const updateProduct = (storeId: string, id: string, input: unknown) => send<ProductDto>("PATCH", `${store(storeId)}/products/${enc(id)}`, { body: input });
export const changeProductStatus = (storeId: string, id: string, status: string) => send<ProductDto>("POST", `${store(storeId)}/products/${enc(id)}/status`, { body: { status } });
export const deleteProduct = (storeId: string, id: string) => send("POST", `${store(storeId)}/products/${enc(id)}/delete`);

// pages
export const addSection = (storeId: string, type: string, input: { type: unknown }, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections`, { body: { type: input.type, expectedRevision } });
export const updateSection = (storeId: string, type: string, sectionId: string, props: unknown, expectedRevision: unknown) => send<EditResultDto>("PATCH", `${page(storeId, type)}/sections/${enc(sectionId)}`, { body: { props, expectedRevision } });
export const removeSection = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/delete`, { body: { expectedRevision } });
export const removeDormantSection = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/delete-dormant`, { body: { expectedRevision } });
export const moveSection = (storeId: string, type: string, sectionId: string, direction: unknown, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/move`, { body: { direction, expectedRevision } });
export const setPageVisibility = (storeId: string, type: string, visible: unknown, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/visibility`, { body: { visible, expectedRevision } });
export const recoverPage = (storeId: string, type: string, expectedRevision: unknown) => send<EditResultDto>("POST", `${page(storeId, type)}/recover`, { body: { expectedRevision } });
export const getPageEditor = (storeId: string, type: string) => send<PageEditorViewDto>("GET", page(storeId, type));

// media (raw bytes)
export const uploadProductImage = (storeId: string, id: string, bytes: Blob) => send("POST", `${store(storeId)}/products/${enc(id)}/image`, { raw: bytes });
export const removeProductImage = (storeId: string, id: string) => send("POST", `${store(storeId)}/products/${enc(id)}/image/delete`);
// the extra images of a product's gallery
export const uploadProductGalleryImage = (storeId: string, id: string, bytes: Blob) => send("POST", `${store(storeId)}/products/${enc(id)}/gallery`, { raw: bytes });
export const removeProductGalleryImage = (storeId: string, id: string, mediaId: string) => send("POST", `${store(storeId)}/products/${enc(id)}/gallery/${enc(mediaId)}/delete`);
export const makeProductGalleryPrimary = (storeId: string, id: string, mediaId: string) => send("POST", `${store(storeId)}/products/${enc(id)}/gallery/${enc(mediaId)}/primary`);
export const uploadStoreLogo = (storeId: string, bytes: Blob) => send("POST", `${store(storeId)}/logo`, { raw: bytes });
export const removeStoreLogo = (storeId: string) => send("POST", `${store(storeId)}/logo/delete`);
export const uploadSectionImage = (storeId: string, type: string, sectionId: string, expectedRevision: unknown, bytes: Blob) =>
  send("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/image`, { raw: bytes, query: { expectedRevision: String(expectedRevision ?? "") } });
export const removeSectionImage = (storeId: string, type: string, sectionId: string, expectedRevision: unknown) =>
  send<EditResultDto>("POST", `${page(storeId, type)}/sections/${enc(sectionId)}/image/delete`, { body: { expectedRevision } });

// publishing
export const publishStore = (storeId: string, input: unknown) => send<PublishResultDto>("POST", `${store(storeId)}/publish`, { body: input });
export const unpublishStore = (storeId: string) => send("POST", `${store(storeId)}/unpublish`);
export const setLiveVersion = (storeId: string, input: { versionNumber: unknown; mode: "rollback" | "republish" }) => send<{ number: number }>("POST", `${store(storeId)}/versions/live`, { body: input });
export const claimSubdomain = (storeId: string, input: { label: unknown; confirmChange?: unknown }) => send<{ label: string; changed: boolean }>("POST", `${store(storeId)}/subdomain`, { body: input });

// ---- phase 3.4: orders; phase 3.3: shipping methods (the merchant side of checkout)
export type OrderDto = z.infer<typeof orderDto>;
export type OrderListDto = z.infer<typeof orderListDto>;
export type ShippingMethodDto = z.infer<typeof shippingMethodDto>;
export const listOrders = (storeId: string, query: { status?: string; customerId?: string; review?: "receipt"; q?: string; before?: string; limit?: string }) => send<OrderListDto>("GET", `${store(storeId)}/orders`, { query });
// M2: the store overview (orders.view: owner and manager).
export type StoreOverview = z.infer<typeof storeOverviewDto>;
// ---- product variants and prices linked to the dollar or gold (phases 3.2 / 3.2b)
export type VariantView = z.infer<typeof variantDto>;
export type PriceLinkView = z.infer<typeof priceLinkDto>;
export type CurrentRates = z.infer<typeof currentRatesDto>;
export type VariantDraft = { options: { name: string; value: string }[]; price: number; stockQuantity: number; sku?: string };
export const replaceVariants = (storeId: string, productId: string, variants: VariantDraft[]) => send<VariantView[]>("PUT", `${store(storeId)}/products/${enc(productId)}/variants`, { body: { variants } });
export const getRates = (storeId: string) => send<CurrentRates>("GET", `${store(storeId)}/rates`);
export const setPriceLink = (storeId: string, productId: string, variantId: string | null, link: unknown) =>
  send<PriceLinkView>("PUT", `${store(storeId)}/products/${enc(productId)}/price-link`, { body: { variantId, link } });
export const removePriceLink = (storeId: string, productId: string, variantId: string | null) => send("POST", `${store(storeId)}/products/${enc(productId)}/price-link/delete`, { body: { variantId } });

// ---- team, activity log and my invitations (phase 2.3): staff of a store, what happened, and the invitations addressed to me
// (the "me" routes are called on the versioned path: that is the one Caddy routes to the API in production)
export type TeamView = z.infer<typeof teamDto>;
export type AuditEntry = z.infer<typeof auditEventDto>;
export type MyInvitation = z.infer<typeof myInvitationDto>;
export type SharedStore = z.infer<typeof sharedStoreDto>;
export const getTeam = (storeId: string) => send<TeamView>("GET", `${store(storeId)}/team`);
export const inviteStaff = (storeId: string, input: { username: string; role: "MANAGER" | "OPERATOR" }) => send<{ id: string }>("POST", `${store(storeId)}/team/invitations`, { body: input });
export const cancelInvitation = (storeId: string, id: string) => send("POST", `${store(storeId)}/team/invitations/${enc(id)}/cancel`);
export const changeMemberRole = (storeId: string, userId: string, role: "MANAGER" | "OPERATOR") => send("PATCH", `${store(storeId)}/team/members/${enc(userId)}`, { body: { role } });
export const removeMember = (storeId: string, userId: string) => send("POST", `${store(storeId)}/team/members/${enc(userId)}/remove`);
export const getAudit = (storeId: string, before?: string) => send<AuditEntry[]>("GET", `${store(storeId)}/audit`, { query: { before, limit: "50" } });
export const getMyInvitations = () => send<MyInvitation[]>("GET", "/api/v1/me/invitations");
export const acceptInvitation = (id: string) => send<{ storeId: string }>("POST", `/api/v1/me/invitations/${enc(id)}/accept`);
export const declineInvitation = (id: string) => send("POST", `/api/v1/me/invitations/${enc(id)}/decline`);
export const leaveStore = (storeId: string) => send("POST", `/api/v1/me/memberships/${enc(storeId)}/leave`);

// Store trend charts (orders.view: owner and manager).
export type StoreAnalytics = z.infer<typeof storeAnalyticsDto>;
export const getAnalytics = (storeId: string, days: 7 | 30 | 90) => send<StoreAnalytics>("GET", `${store(storeId)}/analytics?days=${days}`);
// MVP item 3: the setup checklist (store.settings: owner and manager).
export type StoreSetup = z.infer<typeof storeSetupDto>;
export const getSetup = (storeId: string) => send<StoreSetup>("GET", `${store(storeId)}/setup`);
export const getOverview = (storeId: string) => send<StoreOverview>("GET", `${store(storeId)}/overview`);
export const getOrder = (storeId: string, orderId: string) => send<OrderDto>("GET", `${store(storeId)}/orders/${enc(orderId)}`);
// phase 3.5: online payment (the merchant id is a write-only store secret)
export type PaymentSettingsView = z.infer<typeof paymentSettingsViewDto>;
export type PaymentAttempt = z.infer<typeof paymentAttemptDto>;
export const getPaymentSettings = (storeId: string) => send<PaymentSettingsView>("GET", `${store(storeId)}/payment-settings`);
/** D35c-1: a gateway's credential is a write-only store secret (Zarinpal merchant id, Aghaye Pardakht pin). */
export const setGatewayCredential = (storeId: string, g: Gateway, value: string) => send("PUT", `${store(storeId)}/secrets/${enc(GATEWAY_SECRETS[g])}`, { body: { value } });
export const deleteGatewayCredential = (storeId: string, g: Gateway) => send("POST", `${store(storeId)}/secrets/${enc(GATEWAY_SECRETS[g])}/delete`);
export const getOrderPayments = (storeId: string, orderId: string) => send<PaymentAttempt[]>("GET", `${store(storeId)}/orders/${enc(orderId)}/payments`);
// phase 5.1: discount codes
export type DiscountDto = z.infer<typeof discountDto>;
export const getDiscounts = (storeId: string) => send<DiscountDto[]>("GET", `${store(storeId)}/discounts`);
export const createDiscount = (storeId: string, body: unknown) => send<DiscountDto>("POST", `${store(storeId)}/discounts`, { body });
export const updateDiscount = (storeId: string, id: string, body: unknown) => send<DiscountDto>("PUT", `${store(storeId)}/discounts/${enc(id)}`, { body });
export const deleteDiscount = (storeId: string, id: string) => send("POST", `${store(storeId)}/discounts/${enc(id)}/delete`);
/** For the discount's product picker: one page of products (search by name). */
export const searchProducts = (storeId: string, q: string) =>
  send<{ items: { id: string; name: string }[] }>("GET", `${store(storeId)}/products`, { query: { q: q || undefined, pageSize: "50" } });
export const getCategories = (storeId: string) => send<{ id: string; name: string }[]>("GET", `${store(storeId)}/categories`);

// phase 3.6: order SMS of the store
export type StoreSmsView = z.infer<typeof storeSmsSettingsViewDto>;
export const getSmsSettings = (storeId: string) => send<StoreSmsView>("GET", `${store(storeId)}/sms-settings`);
export const putSmsSettings = (storeId: string, body: { enabled: boolean; merchantPhone: string }) => send<StoreSmsView>("PUT", `${store(storeId)}/sms-settings`, { body });

// D35b-1: card-to-card (bank cards, receipts and their review)
export type BankCard = z.infer<typeof bankCardDto>;
export type Receipt = z.infer<typeof receiptDto>;
/** D-3 / D-22: `canManage` = the caller is the owner; other roles get masked numbers and cannot save. */
export type MerchantBankCards = z.infer<typeof merchantBankCardsDto>;
export const getBankCards = (storeId: string) => send<MerchantBankCards>("GET", `${store(storeId)}/bank-cards`);
export const putBankCards = (storeId: string, cards: { cardNumber: string; holderName: string; bankName: string }[]) => send<MerchantBankCards>("PUT", `${store(storeId)}/bank-cards`, { body: { cards } });
export const getReceipts = (storeId: string, orderId: string) => send<Receipt[]>("GET", `${store(storeId)}/orders/${enc(orderId)}/receipts`);
export const receiptImageUrl = (storeId: string, orderId: string, receiptId: string) => `${store(storeId)}/orders/${enc(orderId)}/receipts/${enc(receiptId)}/image`;
export const reviewReceipt = (storeId: string, orderId: string, receiptId: string, decision: "approve" | "reject", reason: string) =>
  send<{ result: "approved" | "rejected"; order: OrderDto }>("POST", `${store(storeId)}/orders/${enc(orderId)}/receipts/${enc(receiptId)}/review`, { body: { decision, reason } });
export const changeOrderStatus = (storeId: string, orderId: string, to: string, note: string, trackingCode?: string) =>
  send<OrderDto>("POST", `${store(storeId)}/orders/${enc(orderId)}/status`, { body: { to, note, ...(trackingCode ? { trackingCode } : {}) } });
/** Set, change or clear (empty) the carrier's tracking code of a shipped order. */
export const setOrderTracking = (storeId: string, orderId: string, trackingCode: string) => send<OrderDto>("POST", `${store(storeId)}/orders/${enc(orderId)}/tracking`, { body: { trackingCode } });
export const listShippingMethods = (storeId: string) => send<ShippingMethodDto[]>("GET", `${store(storeId)}/shipping-methods`);
export const replaceShippingMethods = (storeId: string, methods: unknown[]) => send<ShippingMethodDto[]>("PUT", `${store(storeId)}/shipping-methods`, { body: { methods } });

// ---- phase 3.3b: the store's customers (personal data: owner and manager)
export type CustomerRow = { id: string; phone: string; name: string | null; phoneVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string };
export type CustomerStats = { customerId: string; orders: number; spent: number; lastOrderAt: string | null };
export const listCustomers = (storeId: string, before?: string) => send<CustomerRow[]>("GET", `${store(storeId)}/customers`, { query: { before, limit: "50" } });
export const customerStats = (storeId: string, ids: string[]) => send<CustomerStats[]>("GET", `${store(storeId)}/orders/customer-stats`, { query: { ids: ids.join(",") } });
